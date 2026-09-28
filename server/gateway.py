"""The FastAPI control plane. CPU-only: it never imports torch or src.*.

Kept as a class so tests can inject the store and settings directly; the
FastAPI wiring lives in app.py.
"""
import secrets
from pathlib import Path
from typing import Optional

from fastapi import Header, HTTPException

from .appwrite_auth import make_auth_backend
from .metrics import REGISTRY
from .principal import Principal
from .rate_limit import RateLimiter
from .schemas import (FL2VRequest, I2VRequest, JobState, JobView, L2VRequest,
                      Ref2VRequest, Task, T2VRequest, UploadOut, snap_num_frames,
                      utc_now_iso)
from .store import PRIORITIES, JobNotFound, JobStore, new_job_id
from .tenants import DailyQuota, TenantRegistry

ALLOWED_IMAGE_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


def job_view(job: dict) -> JobView:
    return JobView(
        job_id=job["job_id"], task=job["task"], state=job["state"],
        prompt=job["prompt"], num_frames=job["num_frames"],
        num_steps=job["num_steps"], seed=job["seed"],
        priority=job.get("priority", "standard"), pool=job.get("pool", "default"),
        image_keys=job.get("image_keys", []), error=job.get("error"),
        artifact_url=job.get("artifact_url"), created_at=job["created_at"],
        started_at=job.get("started_at"), finished_at=job.get("finished_at"),
        step_seconds=job.get("step_seconds", []),
    )


class Gateway:
    def __init__(self, store: JobStore, settings, job_sink=None,
                 uploads_client=None):
        self.store = store
        self.settings = settings
        self.limiter = RateLimiter(settings.rate_limit_per_min)
        self.registry = TenantRegistry(settings)
        self.quota = DailyQuota()
        self.auth_backend = make_auth_backend(settings, self.registry)
        self.job_sink = job_sink
        self.uploads_client = uploads_client      # optional Appwrite mirror
        self._priority_rank = {p: i for i, p in enumerate(PRIORITIES)}

    # ---------------- auth / rate limit ----------------

    def auth(self,
             authorization: Optional[str] = Header(default=None,
                                                   alias="Authorization"),
             x_api_key: Optional[str] = Header(default=None, alias="X-API-Key")
             ) -> Principal:
        """Two paths: Appwrite JWT (Authorization: Bearer ...) when enabled, or
        a static X-API-Key. Both resolve to a Principal carrying a Tier."""
        if authorization and authorization.startswith("Bearer ") \
                and self.auth_backend is not None:
            jwt = authorization[len("Bearer "):].strip()
            if jwt:
                try:
                    return self.auth_backend.verify(jwt)
                except Exception as exc:
                    raise HTTPException(401, f"invalid Appwrite token: {exc}")
        if x_api_key:
            for accepted in self.settings.api_keys:
                if secrets.compare_digest(x_api_key, accepted):
                    tier = self.registry.by_key.get(x_api_key,
                                                    self.registry.default)
                    return Principal(id=x_api_key, tier_name=tier.name,
                                     source="api-key")
        raise HTTPException(401, "missing or invalid credentials "
                                 "(Authorization: Bearer <appwrite-jwt> or "
                                 "X-API-Key)")

    def gated(self, principal: Principal) -> None:
        if not self.limiter.allow(principal.id):
            raise HTTPException(429, "rate limit exceeded; retry in ~60 s")

    # ---------------- job creation ----------------

    def create(self, task: Task, body: T2VRequest, image_keys: list,
               idempotency_key: Optional[str], principal: Principal) -> JobView:
        self.gated(principal)
        if not body.prompt.strip():
            raise HTTPException(422, "prompt must not be empty")
        for key in image_keys:                      # fail fast, not at render time
            self.resolve_image(key)

        tier = self.registry.tiers.get(principal.tier_name,
                                       self.registry.default)
        priority = body.priority or "standard"
        if priority not in self._priority_rank:
            raise HTTPException(422, f"priority must be one of {list(PRIORITIES)}")
        if self._priority_rank[priority] < self._priority_rank[tier.max_priority]:
            raise HTTPException(403, f"tier {tier.name!r} caps priority at "
                                     f"{tier.max_priority!r}")
        pool = self.registry.pools_of(tier)[0]
        if self.store.queue_depth(pool) >= self.settings.max_queue_depth:
            raise HTTPException(503, f"pool {pool!r} is saturated; retry later",
                                headers={"Retry-After": "30"})
        if not self.quota.spent_and_allow(principal.id, tier.daily):
            raise HTTPException(429, f"daily quota of {tier.daily} jobs exhausted")
        if body.webhook_url and not body.webhook_url.startswith(("http://", "https://")):
            raise HTTPException(422, "webhook_url must be an http(s) URL")

        record = {
            "job_id": new_job_id(),
            "idempotency_key": idempotency_key,
            "pool": pool,
            "priority": priority,
            "task": task.value,
            "state": JobState.queued.value,
            "prompt": body.prompt,
            "num_frames": snap_num_frames(body.num_frames),
            "num_steps": body.num_steps,
            "seed": body.seed,
            "video_shift": body.video_shift,
            "audio_shift": body.audio_shift,
            "image_keys": image_keys,
            "webhook_url": body.webhook_url,
            "user_id": principal.id,
            "auth_source": principal.source,
            "created_at": utc_now_iso(),
            "cancel_requested": False,
        }
        job = self.store.create(record)
        if job["job_id"] == record["job_id"]:          # fresh, not an idem replay
            self.store.enqueue(record["job_id"], pool, priority)
            REGISTRY.inc("vdn_jobs_created_total", 1.0,
                         "jobs accepted, by task")
            if self.job_sink is not None:
                try:
                    self.job_sink.record(job)
                except Exception as exc:               # durable copy is best-effort
                    print(f"[gateway] job sink failed: {exc}", flush=True)
        else:
            job["idempotent_replay"] = True
        return job_view(job)

    def t2v(self, body: T2VRequest, idempotency_key, principal: Principal):
        return self.create(Task.t2v, body, [], idempotency_key, principal)

    def i2v(self, body: I2VRequest, idempotency_key, principal):
        return self.create(Task.i2v, body, [body.first_image], idempotency_key,
                           principal)

    def l2v(self, body: L2VRequest, idempotency_key, principal):
        return self.create(Task.l2v, body, [body.last_image], idempotency_key,
                           principal)

    def fl2v(self, body: FL2VRequest, idempotency_key, principal):
        return self.create(Task.fl2v, body,
                           [body.first_image, body.last_image], idempotency_key,
                           principal)

    def ref2v(self, body: Ref2VRequest, idempotency_key, principal):
        return self.create(Task.ref2v, body, list(body.images), idempotency_key,
                           principal)

    # ---------------- uploads ----------------

    def upload(self, file) -> UploadOut:
        ext = ALLOWED_IMAGE_TYPES.get(file.content_type)
        if ext is None:
            raise HTTPException(415, f"unsupported content type {file.content_type!r}; "
                                     f"expected one of {sorted(ALLOWED_IMAGE_TYPES)}")
        limit = self.settings.max_upload_mb * 1024 * 1024
        data = file.file.read(limit + 1)
        if len(data) > limit:
            raise HTTPException(413, f"upload exceeds {self.settings.max_upload_mb} MB")
        if len(data) < 8:
            raise HTTPException(422, "file is too small to be an image")
        key = secrets.token_hex(12) + ext
        path = Path(self.settings.upload_dir) / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        if self.uploads_client is not None:       # Appwrite mirror, best-effort
            try:
                self.uploads_client.mirror(key, data, file.content_type)
            except Exception as exc:
                print(f"[gateway] upload mirror failed: {exc}", flush=True)
        return UploadOut(key=key, bytes=len(data))

    def resolve_image(self, key: str) -> Path:
        """Server-side path for an uploaded image key; refuses traversal."""
        safe = Path(key).name
        path = Path(self.settings.upload_dir) / safe
        if not path.is_file():
            raise HTTPException(400, f"unknown image key {key!r}; "
                                     f"upload it first via POST /v1/uploads")
        return path

    # ---------------- job lifecycle ----------------

    def get_job(self, job_id: str) -> JobView:
        job = self.store.get(job_id)
        if job is None:
            raise HTTPException(404, f"no job {job_id}")
        return job_view(job)

    def cancel_job(self, job_id: str) -> JobView:
        try:
            return job_view(self.store.cancel(job_id))
        except JobNotFound:
            raise HTTPException(404, f"no job {job_id}")

    def recent_jobs(self, limit: int = 50) -> dict:
        pools = {self.settings.default_pool}
        for tier in self.registry.tiers.values():
            pools.update(self.registry.pools_of(tier))
        jobs = []
        for pool in pools:
            jobs.extend(self.store.recent(pool, limit))
        jobs.sort(key=lambda j: j.get("seq", 0), reverse=True)
        return {"jobs": [job_view(j).model_dump() for j in jobs[:limit]]}
