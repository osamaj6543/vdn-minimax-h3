"""GPU worker: claim -> render -> store, with heartbeat and stale reclaim.

One process per GPU. Pin the GPU with CUDA_VISIBLE_DEVICES (e.g.
`CUDA_VISIBLE_DEVICES=3 python -m server.worker`).

Lifecycle guarantees (Phase 1 acceptance):
- Startup reclaims jobs whose worker died mid-render (stale heartbeat) and
  requeues them; a requeued job renders identically thanks to the seed
  (one-GPU renders are bit-reproducible, plan doc 2.3 #5).
- While rendering, a background thread heartbeats every 10 s, so a healthy
  long render (50 steps ~ 9 min) is never reclaimed.
- SIGTERM/SIGINT finish the current render, then exit; queued jobs are left
  for the next worker.
- Cooperative cancel: a `cancel_requested` job's result is discarded and the
  job ends cancelled.
"""
import argparse
import signal
import threading
import time
from pathlib import Path

from .engine import FakeEngine, VdnEngine
from .metrics import REGISTRY
from .schemas import Task, utc_now_iso
from .storage import make_storage
from .store import JobStore, make_store
from .webhooks import WebhookDispatcher


class Worker:
    def __init__(self, store: JobStore, engine, pool: str, artifact_dir: str,
                 upload_dir: str, poll_seconds: float = 1.0,
                 stale_seconds: int = 600, heartbeat_seconds: float = 10.0,
                 storage=None, webhooks: WebhookDispatcher | None = None,
                 job_sink=None):
        self.store = store
        self.engine = engine
        self.pool = pool
        self.artifact_dir = Path(artifact_dir)
        self.upload_dir = Path(upload_dir)
        self.poll_seconds = poll_seconds
        self.stale_seconds = stale_seconds
        self.heartbeat_seconds = heartbeat_seconds
        self.storage = storage
        self.webhooks = webhooks
        self.job_sink = job_sink
        self._stop = threading.Event()
        self._current = None

    # ---------------- signals ----------------

    def request_stop(self, signum, _frame) -> None:
        print(f"[worker] signal {signum}: finishing current work, then exiting",
              flush=True)
        self._stop.set()

    # ---------------- heartbeat ----------------

    def _beat_forever(self) -> None:
        while not self._stop.wait(self.heartbeat_seconds):
            job = self._current
            if job is not None:
                try:
                    self.store.heartbeat(job["job_id"], self.pool)
                except Exception as exc:            # heartbeat must never kill a render
                    print(f"[worker] heartbeat failed: {exc}", flush=True)

    # ---------------- main loop ----------------

    def serve_forever(self) -> None:
        signal.signal(signal.SIGTERM, self.request_stop)
        signal.signal(signal.SIGINT, self.request_stop)
        threading.Thread(target=self._beat_forever, daemon=True).start()

        print(f"[worker] pool={self.pool} engine={type(self.engine).__name__}",
              flush=True)
        self.engine.warmup()
        print("[worker] warm", flush=True)

        while not self._stop.is_set():
            self.reclaim_stale()
            job = self.store.claim(self.pool)
            if job is None:
                self._stop.wait(self.poll_seconds)
                continue
            self.run_one(job)

    def reclaim_stale(self) -> list:
        requeued = self.store.reclaim_stale(self.pool, self.stale_seconds)
        for job_id in requeued:
            print(f"[worker] reclaimed stale render {job_id}; requeued", flush=True)
        return requeued

    def run_one(self, job: dict) -> None:
        self._current = job
        job_id = job["job_id"]
        if job.get("cancel_requested"):
            self.store.release(job_id, self.pool)
            self.store.update(job_id, state="cancelled", finished_at=utc_now_iso())
            return
        print(f"[worker] rendering {job_id} ({job['task']}, "
              f"{job['num_frames']}f x {job['num_steps']} steps)", flush=True)
        out_path = str(self.artifact_dir / f"{job_id}.mp4")
        image_paths = [str(self.upload_dir / Path(k).name)
                       for k in job.get("image_keys", [])]
        try:
            started = time.monotonic()
            result = self.engine.render(
                Task(job["task"]), job["prompt"], image_paths,
                job["num_frames"], job["num_steps"], job["seed"],
                job.get("video_shift", 12.0), job.get("audio_shift", 3.0),
                out_path)
            REGISTRY.observe("vdn_render_seconds", time.monotonic() - started,
                             "wall time of a full render, by pool")
            current = self.store.get(job_id) or {}
            if current.get("cancel_requested"):
                self._finish(job, state="cancelled")
                Path(out_path).unlink(missing_ok=True)
            else:
                artifact_url = (self.storage.save(out_path, f"{job_id}.mp4")
                                if self.storage else out_path)
                self._finish(job, state="succeeded", artifact_url=artifact_url,
                             step_seconds=result.step_seconds)
        except Exception as exc:
            print(f"[worker] job {job_id} failed: {exc}", flush=True)
            REGISTRY.inc("vdn_jobs_failed_total", 1.0, "renders that raised")
            self._finish(job, state="failed", error=str(exc)[:2000])
        finally:
            self.store.release(job_id, self.pool)
            self._current = None

    def _finish(self, job: dict, state: str, **fields) -> None:
        self.store.update(job["job_id"], state=state, finished_at=utc_now_iso(),
                          **fields)
        updated = self.store.get(job["job_id"])
        if self.job_sink is not None:
            try:
                self.job_sink.record(updated)
            except Exception as exc:            # durable copy never blocks work
                print(f"[worker] job sink failed: {exc}", flush=True)
        if self.webhooks is not None:
            try:
                self.webhooks.enqueue(updated)
            except Exception as exc:            # a broken webhook never breaks a job
                print(f"[worker] webhook enqueue failed: {exc}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="VDN-H3 GPU worker (one process per GPU)")
    parser.add_argument("--pool", default=None,
                        help="queue to serve (default VDN_POOL / 'default')")
    parser.add_argument("--engine", choices=["vdn", "sglang", "fake"], default="vdn",
                        help="'fake' renders instantly without a GPU (dev/tests); "
                             "'sglang' proxies a SGLang Diffusion server")
    args = parser.parse_args()

    from .app import build_appwrite
    from .settings import Settings

    settings = Settings()
    settings.validate()
    pool = args.pool or settings.default_pool
    if args.engine == "fake":
        engine = FakeEngine()
    elif args.engine == "sglang":
        from .sglang_engine import SglangEngine

        if not settings.sglang_url:
            raise SystemExit("--engine sglang needs VDN_SGLANG_URL")
        engine = SglangEngine(settings)
    else:
        engine = VdnEngine(settings, pool=pool)
    webhooks = WebhookDispatcher(secret=settings.webhook_secret)
    webhooks.start()
    _, _, job_sink = build_appwrite(settings)
    worker = Worker(
        store=make_store(settings),
        engine=engine,
        pool=pool,
        artifact_dir=settings.artifact_dir,
        upload_dir=settings.upload_dir,
        stale_seconds=settings.stale_seconds,
        storage=make_storage(settings),
        webhooks=webhooks,
    )
    worker.serve_forever()


if __name__ == "__main__":
    main()
