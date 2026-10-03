# VDN-H3 Inference Server

FastAPI control plane + GPU workers for the VDN-H3 model. Design, decisions,
and phase status live in [docs/server_plan.md](../docs/server_plan.md) — read
that first.

## Layout

| File | Role |
|---|---|
| `app.py` | FastAPI wiring + `python -m server.app` (gateway) |
| `gateway.py` | Endpoint logic: auth, rate limits, validation, job CRUD, uploads |
| `schemas.py` | pydantic request/job models; frame snapping (17n+5) |
| `store.py` | Job store: `RedisJobStore` (production) / `MemoryJobStore` (dev, tests); priority lanes (high > standard > low), stale-reclaim zsets |
| `rate_limit.py` | Fixed-window per-key rate limiter (Redis or in-process) |
| `tenants.py` | API key → tier (rpm, daily quota, priority ceiling, allowed pools) |
| `storage.py` | Artifact storage: LocalStorage (auth-gated `/v1/artifacts`) / S3 (presigned URLs) |
| `webhooks.py` | Terminal-state webhook delivery: retries with backoff, HMAC-signed |
| `prompt_encoder.py` | In-process conditioning encoder (Qwen3-VL load/unload, content-hash disk cache) |
| `metrics.py` | Prometheus text exposition (`/metrics`) |
| `engine.py` | `VdnEngine` (pool-aware fp8 + softmax backend, lazy `src.*` imports) / `FakeEngine` |
| `worker.py` | Claim -> render -> store loop; heartbeat; stale-job reclaim |
| `settings.py` | Environment-driven settings (`VDN_*` variables) |
| `tests/` | pytest suite (no GPU, no Redis required) |

## Run

```bash
pip install -r server/requirements.txt

# gateway (dev: in-memory store, key "dev-key")
python -m server.app

# worker without a GPU (fake engine, same in-memory store)
python -m server.worker --engine fake

# production: shared Redis, real engine, one worker per GPU
VDN_BACKEND=redis VDN_REDIS_URL=redis://host:6379/0 \
VDN_API_KEYS="key1,key2" python -m server.app
CUDA_VISIBLE_DEVICES=0 VDN_BACKEND=redis VDN_REDIS_URL=redis://host:6379/0 \
  python -m server.worker            # repeat per GPU with a new CUDA_VISIBLE_DEVICES
```

## API sketch

```
POST /v1/uploads                     multipart image -> {key}
POST /v1/video/t2v   {prompt, num_frames?, num_steps?, seed?,
                      priority?, webhook_url?}
POST /v1/video/i2v   {prompt, first_image: key, ...}
POST /v1/video/l2v   {prompt, last_image: key, ...}
POST /v1/video/fl2v  {prompt, first_image, last_image, ...}
POST /v1/video/ref2v {prompt, images: [key, ...], ...}
GET   /v1/jobs/{id}                  job view
DELETE /v1/jobs/{id}                 cancel (queued: immediate; running: cooperative)
GET   /v1/jobs                       recent jobs
GET   /v1/artifacts/{key}            fetch a local-storage mp4 (auth-gated)
GET   /metrics                       Prometheus exposition
GET   /healthz | /readyz
```

All authenticated endpoints take `X-API-Key`; optional `Idempotency-Key`
header deduplicates creates. Creating a job returns `202` with the job view.

## Tenants, tiers, pools (Phase 2)

```bash
VDN_TENANTS="key-a=premium,key-b=default"
VDN_TIERS='{"premium": {"rpm": 120, "daily": 2000, "max_priority": "high",
                        "pools": ["b200", "h200"]},
            "default": {"rpm": 30, "daily": 200, "max_priority": "standard",
                        "pools": ["default"]}}'
```

A tier sets the per-minute rate limit ceiling (rate_limit_per_min caps the
loosest tier), a daily job quota, the highest `priority` its jobs may request
(high > standard > low), and the pools its jobs route to. The worker joins a
pool with `--pool b200`; the engine maps the pool to the tuned softmax
backend (b200 -> decomposed, h200 -> flex, per docs/server_plan.md 2.2).
Queues deeper than `VDN_MAX_QUEUE_DEPTH` shed load with `503 Retry-After`.

## Webhooks

Set `webhook_url` on any create; on the terminal state the worker POSTs a
signed JSON event (`job.finished`) with exponential-backoff retries:

```
X-VDN-Signature: sha256=<hmac_sha256(VDN_WEBHOOK_SECRET, body)>
```

Verify the signature server-side before trusting the payload.

## Appwrite integration (auth, storage, durable records)

When enabled, Appwrite becomes the frontend-facing backend suite; Redis stays
the job queue. Everything is additive — with Appwrite off, the server behaves
exactly as before.

```bash
VDN_APPWRITE_ENABLED=1
VDN_APPWRITE_ENDPOINT=https://<REGION>.cloud.appwrite.io/v1   # or your self-hosted host
VDN_APPWRITE_PROJECT=<project-id>
VDN_APPWRITE_KEY=<server-api-key>          # scopes: tables/rows + files + users
VDN_APPWRITE_DB=vdn
VDN_APPWRITE_JOBS_TABLE=jobs               # TableDB table (or legacy collection)
VDN_APPWRITE_USERS_TABLE=users
VDN_APPWRITE_ARTIFACTS_BUCKET=artifacts    # optional; mp4s land here
VDN_APPWRITE_UPLOADS_BUCKET=uploads        # optional; gateway uploads mirrored here
VDN_APPWRITE_DB_STYLE=tablesdb             # or "documents" for <=1.6 layouts
```

**Auth (1).** The frontend signs users in through its own server (a Next.js
auth BFF): the browser posts credentials to `/api/auth/login`, the Next server
exchanges them with Appwrite using a server API key, and keeps the session in an
httpOnly sealed cookie. The server then mints the Appwrite JWT
(`Users.createJWT`, 15 min) and calls this API with
`Authorization: Bearer <jwt>` on the browser's behalf. The gateway side is
unchanged: it verifies that JWT against Appwrite (`GET /account` with
`X-Appwrite-JWT`; JWTs expire in 15 min), caches the result for 60 s, and derives
the tier from the user's **labels** (a label
matching a `VDN_TIERS` name; otherwise the default tier). A `users` row is
kept in Appwrite for console-side management. Static `X-API-Key` access keeps
working for ops/scripts.

**Storage (2).** Rendered mp4s upload to the artifacts bucket; `GET
/v1/artifacts/{key}` streams them auth-gated so permission policy stays in
this one place. Gateway image uploads are mirrored to the uploads bucket
(best-effort) so the frontend can manage images through Appwrite too.

**Database (3).** Job records (creates + terminal updates) are copied into the
`jobs` table keyed by job_id — the history the frontend queries; Redis remains
the live queue. Record fields: job identity, task, state, user_id, timings.
All Appwrite writes are best-effort: an Appwrite outage never blocks a render.

Setup checklist: create the project, the two tables (attributes per
`server/appwrite_store.py` record fields), both buckets, and a server API key;
then set the env vars above. Tests: `pytest server/tests/test_appwrite*.py`.

## Phase 3: scale lanes

**GPU validation (run once per GPU box before serving traffic):**

```bash
python -m server.preflight                 # environment checks only
python -m server.validate_gpu              # staged: preflight -> assemble (fp8)
                                           # -> encode -> warmup -> render -> store
python -m server.validate_gpu --frames 39 --steps 2    # quick smoke
```

The report lands in `server_data/artifacts/validation.mp4.validation.json`;
paste it into docs/server_plan.md.

**On a rented cloud GPU**, use the turnkey runbook instead:
[deploy/cloud_validate.sh](../deploy/cloud_validate.sh) with its step-by-step
guide [docs/cloud_validation_guide.md](../docs/cloud_validation_guide.md)
(covers getting this fork onto the box, the pinned stack, the 82 GB weights,
the staged validation, troubleshooting, and an optional live-fire of the
gateway + real-engine worker on the same instance).

**8-GPU fast lane** (node-exclusive torchrun; run on a node with NO per-GPU
workers):

```bash
VDN_REDIS_URL=redis://host:6379/0 python -m server.fast_lane            # real
python -m server.fast_lane --engine fake                                # dry-run
```

Claims from pool `node8` (VDN_FAST_LANE_POOL), takes a stale-aware node lock,
picks the tuned Ulysses config by GPU name (B200 -> decomposed,
H200 -> flex; override via VDN_FAST_LANE_CONFIGS), encodes the prompt with the
repo's encode_* CLIs, then runs infer_ulysses.py with 2 warm-up steps. The
model reloads per job — that is the lane's documented cost.

**SGLang lane** (in front of an `sglang serve` deployment, t2v/i2v/l2v/fl2v):

```bash
VDN_SGLANG_URL=http://sglang-host:30010 python -m server.worker \
  --engine sglang --pool sglang
```

Speaks SGLang's OpenAI Videos API (POST /v1/videos -> poll -> /content).
ref2v is refused there — route it to a repo-stack pool.

## Tests

```bash
python -m pytest        # 60 tests: store, lanes, rate limit, tenants,
                        # storage, webhooks, gateway, worker, metrics,
                        # fast lane, sglang adapter
```
