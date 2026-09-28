# VDN-H3 Inference Server — Build Plan & Session Log

**Created:** 2026-09-28 00:15 PKT (UTC+05:00, Pakistan Standard Time)
**Status:** PLANNING — no server code written yet as of this revision.
**Owner note:** This document is the single durable reference for building the
FastAPI inference server around the VDN-H3 model in this repository. It exists
so that (a) the decision history is auditable — what was included, excluded, or
changed, and when — and (b) a fresh agent session (or a human) can resume with
full context even after a previous session's context window is exhausted.

## How to use this document in later sessions

1. **Read top-to-bottom before writing any code.** Section 2 lists the repo
   facts every design decision rests on; do not re-derive them, trust the file
   references given.
2. **Never edit history.** The Session Log (Section 1) is append-only. New
   sessions append a new dated entry describing what they did, decided, or
   reversed. Superseded decisions stay in place, marked `[SUPERSEDED by R-xx]`.
3. **Every scope change gets a row.** Additions to or removals from the scope
   tables (Section 4) are recorded with a timestamp and a reason, never by
   silently editing the original row.
4. **Decisions get IDs.** Decisions are `R-01`, `R-02`, …; open questions are
   `Q-01`, … A later session that reverses a decision writes a new decision
   referencing the old one.
5. **Clock convention.** All timestamps are PKT (UTC+05:00) in the format
   `YYYY-MM-DD HH:MM PKT`, matching the machine this project is developed on.

---

## 1. Session Log (append-only)

### 2026-09-28 00:15 PKT — Session 1: analysis and architecture decision

- Analyzed the repository (`vdn-minimax-h3`, branch `main`, commit `64b91c4`):
  Video DeltaNet hybrid attention on MiniMax H3 — architecture, checkpoints,
  inference stack, training recipe, per-GPU (B200/H200) behavior.
- Confirmed the repository contains **no** HTTP/server layer of any kind
  (searched for FastAPI/Flask/uvicorn/aiohttp/gRPC/route handlers: zero hits;
  `pyproject.toml` has no web dependencies). SGLang serving is external to this
  repo.
- Confirmed the repo's internals are cleanly reusable in-process:
  `build_inference_model()` (src/inference/utils/assemble.py),
  `load_prompt()` (src/inference/utils/prompt_cache.py — supports all four
  conditioning modes), `generate_latents()` (src/inference/render.py — the
  sampler with i2va/fl2va/ref2va handling), `decode_and_save()`.
  `infer.py` is a thin one-shot main over these; a worker can call them
  directly and keep the model warm across requests.
- User requirement stated: professional-grade FastAPI server exposing
  text-to-video, image-to-video, reference-to-video, and first+last-frame
  endpoints, with security, rate limits, concurrency handling, queue handling,
  single- and multi-GPU handling, and load balancing.
- Decision made: build a dedicated FastAPI control plane + GPU worker
  architecture (see R-01..R-05, Section 3). Rationale and rejected
  alternatives recorded in Section 3.
- This document created.

### 2026-09-28 01:35 PKT — Session 2: Phase 1 implemented (code complete, GPU-pending)

- Built the `server/` package per Phase 1 (Section 5): `app.py` (FastAPI
  wiring), `gateway.py` (auth, rate limits, validation, job CRUD, uploads),
  `schemas.py`, `store.py` (Redis + in-memory backends behind one interface),
  `rate_limit.py`, `engine.py` (`VdnEngine` with lazy `src.*` imports +
  `FakeEngine`), `worker.py` (claim/heartbeat/stale-reclaim/graceful-shutdown
  loop), `settings.py` (`VDN_*` env), `README.md`, `requirements.txt`.
  `pytest.ini` added at repo root; `.gitignore` gained `server_data/` and
  `.pytest_cache/`.
- All five task endpoints live (`/v1/video/{t2v,i2v,l2v,fl2v,ref2v}`), plus
  `/v1/uploads`, `/v1/jobs`, `/v1/jobs/{id}` GET+DELETE, `/healthz`, `/readyz`.
  Idempotency-Key header deduplicates creates.
- Tests: 26 passed on the dev box (Python 3.11; no torch/Redis needed — the
  engine lazy-imports `src.*`, tests use the memory store + FakeEngine).
  HTTP smoke test through a real uvicorn process also passed.
- Decisions taken during implementation (amendments to Section 4):
  - S-07 amendment: image keys are validated at SUBMISSION time (unknown key
    -> 400), not at render time; fail fast beat render-time failure.
  - Ordering: jobs carry a monotonic `seq` (Redis INCR / process counter) so
    "recent jobs" is deterministic even for same-second creates.
  - Worker adopts the repo's lifecycle rules verbatim: startup reclaims
    stale renders (heartbeat zset), SIGTERM finishes the current render,
    `cancel_requested` discards the finished artifact (K-01 retry semantics).
  - Engine warmup = a real tiny render (22 frames, 2 steps), absorbing the
    compile + 2nd-timestep re-specialisation (plan doc 2.3 #4).
- Phase 1 compromises, to resolve in Phase 2:
  - S-06 partial: t2v prompts encode in-process (replicating
    encode_prompt.py); image-conditioned prompts (i2v/l2v/fl2v/ref2v) shell
    out to src/inference/encode_keyframes.py as a subprocess. Both go through
    a content-hash disk cache (server_data/prompt_cache/<sha256>.pt) so
    repeats never re-load the 63 GB Qwen3-VL encoder. Q-01 (dedicated
    encoder service) remains open.
  - Artifacts are local files (`server_data/artifacts/<job_id>.mp4`,
    `artifact_url` holds the path); object storage + signed URLs is Phase 2.
  - Cancel of a RUNNING render is cooperative (GPU work completes, artifact
    discarded); hard preemption is Phase 2.
  - Rate limiting is one global tier per key; per-tenant tiers (Q-03) open.
- NOT yet verified on a GPU: VdnEngine against real weights. The dev box has
  no CUDA; first run must be on a B200/H200 with `ckpts/` present
  (`VDN_CHECKPOINT`, `VDN_BASE_SOURCE` env; fp8 on by default, off with
  `VDN_FP8=0`). Until then, exercise the full loop with
  `python -m server.worker --engine fake`.
- Phase 1 acceptance status: t2v-through-HTTP + concurrent-queueing +
  worker-restart-reclaim + per-NFE timings stored: covered by tests; real
  render pending the GPU validation above.

### 2026-09-28 02:05 PKT — Session 3: Phase 2 (hardening) implemented

- Tests: 48 passed (was 26). HTTP smoke through a real uvicorn process
  verified tier routing (free -> default pool/standard; premium -> high
  priority accepted) and the Prometheus exposition.
- **Q-01 RESOLVED (in-process encoder service).** `server/prompt_encoder.py`:
  one PromptEncoder per worker; imports the repo's encode_keyframes.py
  building blocks (put_on_canvas, normalize_references, build_presentation,
  qwen3vl_prompt_embeds, encode_vae_condition) IN-PROCESS — not re-implemented,
  not shelled out (Phase 1's subprocess compromise removed). Qwen3-VL loads on
  demand and unloads after each encode; the conditioning VAE is the model's
  own resident copy, not a second load. Content-hash disk cache unchanged.
- **Q-02 RESOLVED (Redis).** Priority lanes landed in both stores:
  high > standard > low per pool (Redis: one list per lane; requeue-on-reclaim
  keeps the job's lane). `queue_depth(pool)` added for shedding + metrics.
- **Q-03 RESOLVED (tiered keys).** `server/tenants.py`: VDN_TENANTS maps keys
  to tiers; a tier = rpm ceiling, daily job quota, max priority, allowed
  pools. Custom tier tables EXTEND the built-in default (no need to redefine
  "default"); the built-in routes to settings.default_pool via the
  "@default" placeholder (found by smoke test: an unlisted key had routed to
  a literal "default" pool, ignoring VDN_POOL).
- New Phase 2 subsystems:
  - `storage.py`: LocalStorage (auth-gated GET /v1/artifacts/{key}) and S3
    (lazy boto3, presigned GET). Worker saves through the abstraction;
    `artifact_url` in the job view is now a fetchable URL.
  - `webhooks.py`: terminal-state POST with exponential-backoff retries
    (5 attempts, 30 s cap), optional HMAC signing
    (X-VDN-Signature: sha256=..., VDN_WEBHOOK_SECRET). Delivery is
    best-effort and never affects job state.
  - `metrics.py` + GET /metrics: Prometheus counters (jobs created/failed),
    render-seconds summary, queue-depth gauges per pool. No client dependency.
  - Load shedding: creates beyond VDN_MAX_QUEUE_DEPTH per pool return
    503 + Retry-After: 30.
  - Gateway accepts `priority` and `webhook_url` on every create; priority
    above the tier cap is 403.
  - Pool-aware engine: VdnEngine(pool=...) maps b200 -> softmax_backend
    "decomposed", h200 -> "flex", else "auto" (plan doc 2.2).
- Ops: `.github/workflows/ci.yml` (GPU-free pytest on push/PR);
  `deploy/Dockerfile.gateway` (slim, CPU-only), `deploy/Dockerfile.worker`
  (CUDA base; NOTE in-file: align torch to the repo's 2.13 cu129 pin before
  production traffic), `deploy/docker-compose.yml` (redis + gateway +
  fake-engine worker for local dev).
- Still open / next:
  - Real-weights GPU validation of VdnEngine remains THE gate (K-04 pinning:
    worker images should pin the repo commit).
  - Cancellation of a RUNNING render is still cooperative (generate_latents
    has no cancellation hook; hard preemption would need a process-level
    kill design).

### 2026-09-28 02:21 PKT — Session 4: Phase 3 (scale lanes) implemented

- Tests: 60 passed (was 48). All new modules import cleanly; subprocess,
  nvidia-smi probe and SGLang transport are injectable, so everything here is
  test-verified without a GPU.
- **X-01 UN-EXCLUDED (8-GPU fast lane).** `server/fast_lane.py` +
  `python -m server.fast_lane`:
  - claims from pool `node8` (VDN_FAST_LANE_POOL, VDN_FAST_LANE_NPROC=8);
  - stale-aware NodeLock (O_CREAT|O_EXCL + mtime reclaim) so two lane
    processes on one node defer rather than double-render;
  - `nvidia-smi` idle probe (util <= 5%, mem <= 2000 MiB on all N GPUs);
  - prompt encoded through the repo's encode_prompt.py / encode_keyframes.py
    CLIs on cuda:0 (subprocess; per-job 63 GB encoder load is the lane's
    accepted cost — the in-process Phase 2 encoder is single-GPU-worker bound);
  - torchrun --standalone --nproc_per_node=N infer_ulysses.py with the GPU's
    tuned config (VDN_FAST_LANE_CONFIGS name-match; unknown GPU fails loudly
    rather than guessing); render.warmup_steps=2 baked in;
  - artifact through the storage layer, webhook + metrics on terminal state;
  - `--engine fake` runs the whole loop without torchrun for CI.
  - Deployment constraint (R-05, restated in README): the lane runs on a node
    with NO per-GPU workers; it is a latency lane, not throughput.
- **X-02 UN-EXCLUDED (SGLang lane).** `server/sglang_engine.py`, wired as
  `python -m server.worker --engine sglang --pool sglang`
  (VDN_SGLANG_URL/API_KEY/MODEL). API verified against sglang's
  multimodal_gen entrypoints: POST /v1/videos (multipart, async, returns
  {id, status}), GET /v1/videos/{id} (queued -> in_progress -> completed|
  failed), GET /v1/videos/{id}/content (or `url` when cloud storage). ref2v
  refused (SGLang supports T2VA/FL2VA only); their API has no abort
  (their own TODO), so running-render cancel stays cooperative here too.
  NOT yet exercised against a live sglang serve deployment — first contact
  belongs to the GPU validation visit.
- **GPU validation is now turnkey** (the standing gate): `server/preflight.py`
  (torch pin, CUDA + capability, fp8 eligibility, patched-diffusers H3 classes,
  flash-attn-4, weights on disk) and `server/validate_gpu.py` (staged:
  preflight -> assemble -> encode -> warmup -> render -> store, JSON report
  next to the artifact). Instructions in server/README.
- Scope bookkeeping: X-01/X-02 resolution rows appended to Section 4.
- Remaining after this session: run preflight + validate_gpu on a real GPU box
  and record the report here; live-fire the fast lane and the SGLang adapter;
  everything else (Phase 1-3) is code-complete and test-verified.

### 2026-09-28 02:25 PKT — Session 5: cloud validation runbook (no local CUDA)

- User confirmed: no CUDA hardware available. Response: made GPU validation a
  one-command cloud job instead of leaving it as a manual exercise.
- `deploy/cloud_validate.sh`: fresh-Ubuntu runbook that provisions the pinned
  stack in the repo's documented order (python 3.12 venv -> torch 2.13.0
  cu129 -> `uv pip install --prerelease=allow -e .` -> scripts/setup_diffusers.sh
  -> `hf download` the 82 GB weights), then runs `server.preflight`, the
  quick validation (39f x 2 steps) and the full one (345f x 8 steps), and
  prints the validation JSON to paste back into this document.
- Hardware guidance recorded: any sm >= 9.0 card with >= 80 GB works
  (H100 80GB is the cheapest qualifying rental; fp8 per-row scales are the
  sm90 path and the 80 GB envelope is repo-documented). B200/H200 NOT
  required for the validation gate.
- Estimated cost/time on a ~$2.5/hr H100: ~1.5-2.5 h total, ~$5-10
  (~20-40 min env, ~10-30 min download, ~15 min validation), >= 200 GB disk.
- The fast lane (8 GPUs) and any SGLang live-fire stay deferred until real
  hardware is in the picture; nothing else blocks on them.

### 2026-09-28 03:06 PKT — Session 6: Appwrite integration (auth + storage + database)

- User decision: use **Appwrite** as the single suite for the frontend's
  server-side needs (authentication, storage, database) instead of growing
  custom equivalents. Architecture decision recorded: **Redis stays the job
  queue** (claim/heartbeat semantics are its job); **Appwrite becomes the
  durable system of record and the frontend-facing backend**. Everything is
  additive behind VDN_APPWRITE_ENABLED; with it off, behavior is unchanged
  (81/81 pre-existing tests untouched in behavior).
- API contracts verified against Appwrite 1.7 server REST docs (2026-09-28):
  headers X-Appwrite-Project / X-Appwrite-Key / X-Appwrite-JWT; JWT verified
  via GET /v1/account under X-Appwrite-JWT (JWTs = 15-min session-bound
  tokens); TablesDB rows at /v1/tablesdb/{db}/tables/{t}/rows[/{id}]
  (legacy /databases/{db}/collections/{c}/documents selectable);
  storage files at /v1/storage/buckets/{b}/files (multipart fileId/file/
  permissions) with /download and /view reads.
- New modules:
  - `server/appwrite.py` - thin REST client (urllib, injectable transport).
    Found + fixed a real auth pitfall during testing: the server API key must
    NOT ride along a JWT verification request, or Appwrite authenticates the
    call as the key and /account stops identifying the user.
  - `server/principal.py` - Principal (id, tier_name, source, email, labels)
    shared by both auth paths.
  - `server/appwrite_auth.py` - JWT verification with a 60 s TTL cache (never
    extends the 15-min JWT validity), tier from user LABELS (label naming a
    VDN_TIERS tier), best-effort `users` row upsert for console management.
  - `server/appwrite_store.py` - AppwriteStorage (artifacts bucket; client
    fetch stays the auth-gated /v1/artifacts/{key} so permission policy has
    one home), AppwriteUploads (gateway upload mirror, best-effort),
    AppwriteJobSink (best-effort durable job records: creates + terminal
    updates; flattens to Appwrite-primitive fields).
  - Gateway: auth() now resolves BOTH paths - Authorization: Bearer <jwt>
    (Appwrite) or X-API-Key (legacy) - into a Principal; rate limits, daily
    quotas, priority ceilings and pool routing key off the Principal
    uniformly; job records gain user_id + auth_source.
  - Wiring: app.build_appwrite() assembles storage/uploads/sink when
    configured; the worker records terminal states through the sink;
    /v1/artifacts/{key} now streams from any backend via Storage.load().
- Tests: 81 passed (was 60). New coverage: client paths/payloads/headers for
  tablesdb + legacy styles, upsert fallback, multipart file upload, JWT
  verification incl. the no-API-key rule, TTL cache, label-to-tier mapping,
  user-row best-effort, storage save/load, sink flattening, gateway Bearer
  auth end-to-end with a stubbed backend, bad-token 401, api-key coexistence,
  upload mirroring.
- NOT yet verified against a live Appwrite instance (none configured here) -
  first contact needs the project/buckets/tables created and the env vars
  set; the setup checklist is in server/README. Everything else about the
  integration is test-verified offline.

### 2026-09-28 19:03 local — Session 7: professional frontend (Next.js + Tailwind + ShadCN)

- User decision: stay with **Appwrite** (Better Auth + Appwrite Postgres was
  evaluated and declined for now; the BetterAuthBackend swap remains cheap
  thanks to the Principal seam). Build the frontend on
  **Next.js + Tailwind + ShadCN**.
- `frontend/` scaffolded: Next 16.3.6 (App Router, Turbopack) + React 19.2 +
  Tailwind v4 + shadcn v4 (Base-UI based), appwrite web SDK 28.1, lucide
  icons. 19 shadcn components added.
- Screens: landing redirect; login; register; (app) route group with auth
  guard + top nav (Create / History / Settings, user email, tier badge from
  Appwrite labels, logout); dashboard = create form covering ALL FIVE modes
  (t2v/i2v/l2v/fl2v/ref2v) with mode-specific image pickers, 17n+5 duration
  options shown as seconds, Fast/Quality steps, seed, priority; jobs list
  with 5 s auto-refresh and status badges; job detail with poll-until-
  terminal, cancel, blob-streamed auth-gated video playback (the artifact
  endpoint needs a Bearer header, so the player fetches a blob rather than
  using src), per-NFE timing; settings (account + connection).
- Auth wiring: Appwrite cookie session in the browser; src/lib/api.ts mints
  gateway JWTs on demand (10-min client cache, one 401-retry with a fresh
  token). The gateway remains the enforcement point for tiers/quotas; the
  frontend is presentation only.
- Framework-version fixes applied: Next 16 LayoutProps is "/"-only for
  non-root layouts (plain children props); shadcn v4 Select onValueChange is
  `string | null` (Base UI); appwrite SDK 28 deleteSessions() takes no args.
- Verification: `npm run build` passes (typecheck + 8 routes); live smoke -
  production server on :3001 returned 200 for /login and /jobs.
- STRUCTURE FIX: sessions 4-6 in this log had drifted out of chronological
  order (S4 landed after S6, split mid-section) because three appends anchored
  on S3's/S4's tail bullets. Reordered mechanically to S1..S6 and removed the
  resulting duplicate S4 block; no entry content was altered.
- Next: real-Appwrite live-fire (create project + web platform origin + env
  vars, same gate as Session 6); GPU validation gate (cloud_validate.sh)
  unchanged; polish candidates - Appwrite Realtime subscriptions over polling
  (jobs table already sinks to Appwrite), landing-page hero, Playwright e2e.

### 2026-09-28 19:30 local — Session 8: Appwrite provisioning script

- Added `deploy/appwrite_provision.py`: idempotent one-shot provisioning of
  everything the Appwrite integration needs - database `vdn`, tables `jobs`
  and `users` (with every column the sink/auth code writes, incl. types,
  sizes, arrays, nullability), and the private `artifacts`/`uploads` buckets.
  Column creation tries 1.7 TablesDB paths (/columns/...) with legacy
  (/attributes/...) fallback; column status polled to available; 409 = skip,
  so re-running is safe. API contract per Appwrite 1.7 docs (2026-09-28);
  syntax-checked, guard-tested (exits without env), NOT yet live-fired -
  same first-contact gate as the integration itself.
- Live-fire checklist written into the answer (Console: project, web platform
  origin, API key scopes tables/files; then the script; then env vars).


---

## 2. Repository facts this plan relies on (verified 2026-09-28)

These are the load-bearing facts. File references are given so a later session
can re-verify without re-analyzing the whole repo.

### 2.1 Performance envelope (README Results tables; docs/inference.md)

| Card config | s/NFE | 8-step render | 50-step render |
|---|---:|---:|---:|
| B200 x1, FP8 | 6.41 | 51 s | 5.3 min |
| H200 x1, FP8 | 11.2 | 90.5 s | 9.4 min |
| B200 x8 (repo stack), FP8 | 1.40 | 11.23 s | 1.2 min |
| H200 x8 (repo stack), FP8 | 2.29 | 18.3 s | 1.9 min |
| B200 x8, SGLang MXFP8 | 0.88 | 6.9 s | 44.0 s |

- Numbers **exclude** model loading, warm-up, VAE decoding, and mp4 encoding.
- SGLang MXFP8 scaling on B200: 47.6 / 25.9 / 13.1 / 6.9 s on 1/2/4/8 GPUs.
- Implied service throughput: ~1 render per minute per GPU (8-step, fp8,
  B200), before decode/mux time. Size the fleet from this.
- Memory, measured on an H200 with the allocator capped at 78 GiB
  (docs/inference.md "Memory"): load 61.7 GiB; assembly->fp8 65.9; denoise
  71.4 (1 GPU) / 55.9-60.4 (8-GPU per rank); decode 67.8-68.5 (rank 0 only).
  bf16 configs do NOT fit 80 GB on one GPU. fp8 weights: 62 GB -> 45 GB
  (363 quantized Linears, skip_end_blocks: 0).

### 2.2 Per-card kernel behavior (matters for pool routing)

- `softmax_backend: auto` resolves to `decomposed` on every CUDA device. It is
  markedly faster than `flex` on B200 (sm100), only equal on H200 (sm90).
- Tuned 8-GPU configs: B200 -> `decomposed` + 5+3 Ulysses split
  (configs/inference/8nfe_tuned_fp8_ulysses_b200.yaml); H200 -> `flex` + 6+2
  (..._h200.yaml). B200 is bandwidth-bound (5+3 = 1.425 vs 6+2 = 1.629 s/NFE);
  H200 stays compute-bound on NVLink4 (6+2 wins by ~4%).
- fp8 scale granularity follows the card: per-row on sm90, per-tensor on
  sm100+ (src/models/ops/fp8_linear.py docstring). Not a knob.
- 80 GB-card caveat: with conditioning rows (FL2VA/Ref2VA), `decomposed`
  gathers global rows per window group and can OOM under an 80 GB cap;
  `flex` does not. On 141/192 GB cards this is not a concern.

### 2.3 Hard constraints for any server built on this repo

1. **Batch size 1 is architectural** (src/models/hybrid_attention.py: "Batch
   must be 1 - H3 packs one request per document"). Concurrency = one render
   per GPU; queueing provides the rest.
2. **num_frames must be 17n+5** (345 frames = 14.4 s at 24 fps; canvas
   1344x768). In diffusers, num_inference_steps counts sigma grid points =
   model evaluations + 1; the repo's `--steps` takes model evaluations.
3. **fp8 swap is one-way** (fp8_linear.py): bf16 weights are released during
   conversion; you cannot de-quantize in place. A dead worker restarts from a
   fresh `build_inference_model()`.
4. **First evaluation compiles** (Triton + torch.compile, several minutes);
   fp8 configs run render.warmup_steps: 2 to reach steady state. A warm
   worker MUST warm up once at startup.
5. **One-GPU renders are bit-reproducible** (same config+seed+cache+GPU model
   -> same mp4 bytes). **Multi-GPU renders are not reproducible run-to-run.**
6. **infer.py refuses `parallel.*` fields**; multi-GPU is only reachable via
   infer_ulysses.py under torchrun (a subprocess job, not in-process).
7. **Setup reads 66 GB per rank** - "keep ckpts/ on a local disk"
   (8-GPU note, docs/inference.md).
8. **torch.load security**: prompt caches are `.pt` (pickle). Never accept
   `.pt` from clients; the server encodes uploaded images itself.
9. **Decoders wait on the CPU** during denoise and load when it ends; mp4 is
   written as `.partial.mp4` then renamed (atomic) (src/inference/render.py).
10. **Conditioning modes** (prompt_cache / render): T2VA [text|audio|video];
    I2VA/L2VA/FL2VA via --first/--last keyframes; Ref2VA-like via --refs
    blocks. Keyframes/refs are noised to t=0.999 and pinned.
11. **SGLang Diffusion** serves T2VA and FL2VA only (external project, README
    "Inference with SGLang"); i2v/l2v/ref2v require this repo's stack.

---

## 3. Decisions (R = resolved, Q = open)

All decisions dated 2026-09-28 unless re-dated by a later entry.

**R-01: Build a dedicated FastAPI server; do not use the repo's batch scheme
as the product surface.** The repo is one-shot CLI by design, with no HTTP
layer, no scheduler reuse, batch=1, and local mp4 output. It stays the
*engine*; the server is a new layer on top.

**R-02: Split control plane from GPU workers.** FastAPI gateway (CPU-only,
stateless) + job queue + one warm worker process per GPU pinned via
CUDA_VISIBLE_DEVICES. Generation never runs inside the API process: a render
holds the GPU 51-90 s (8-step) to 5-9 min (50-step).

**R-03: Workers call the repo's Python API in-process, not subprocess
infer.py.** `build_inference_model()` once at startup + a warmup render
(absorbs compilation), then per job:
`load_prompt() -> generate_latents() -> decode_and_save()`. This avoids the
per-request 66 GB load + multi-minute compile and reaches the measured
steady-state s/NFE.

**R-04: Queue-based load balancing, pools per GPU model.** Workers pull from
per-pool queues (B200 pool, H200 pool) because the card families take
different configs and backends (Section 2.2). Round-robin excluded: a busy
GPU cannot accept work anyway (batch=1).

**R-05: Multi-GPU (8x Ulysses) is a node-exclusive "fast lane," not the
default path.** It is a torchrun subprocess job with per-job model reload,
non-reproducible, holding the whole node. Use only for latency SLOs;
single-GPU parallel workers give comparable aggregate throughput
(8 videos/51 s vs 1 video/9 s per node) with far less complexity.
Gang-schedule the lane: dispatch only when all 8 GPUs are free.

**Q-01 (RESOLVED 2026-09-28, Session 3):** Prompt-encoder placement - resolved
as an in-process per-worker encoder (server/prompt_encoder.py) importing the
repo's encode_keyframes building blocks, load/unload managed, content-hash
disk cache; the conditioning VAE is the model's own resident copy.

**Q-02 (RESOLVED 2026-09-28, Session 3):** Redis, with priority lanes per pool
and stale-reclaim zsets; the in-memory backend mirrors the semantics for
dev/tests.

**Q-03 (RESOLVED 2026-09-28, Session 3):** Static API keys mapped to tiers
(VDN_TENANTS / VDN_TIERS); a tier carries rpm, a daily quota, a priority
ceiling, and its pools. JWT/multi-tenant admin remains future work if needed.

---

## 4. Scope (2026-09-28) — additions/removals are appended as new rows, never edited

### 4.1 In scope

| # | Item | Added | Reason |
|---|---|---|---|
| S-01 | FastAPI gateway: POST /v1/video/{t2v,i2v,fl2v,ref2v}, GET /v1/jobs/{id}, DELETE /v1/jobs/{id} (cancel), webhooks | 2026-09-28 | User requirement: one endpoint per conditioning mode |
| S-02 | Auth (API keys minimum) + per-key rate limiting | 2026-09-28 | User requirement: security, rate limits |
| S-03 | Redis-backed job queue; job states queued/running/succeeded/failed/cancelled; idempotency keys | 2026-09-28 | User requirement: queue + concurrency handling |
| S-04 | Warm GPU worker (1 process/GPU): resident fp8 model, startup warmup, pull-loop over `build_inference_model/load_prompt/generate_latents/decode_and_save` | 2026-09-28 | R-02/R-03 |
| S-05 | Object-storage output + signed URLs; jobs carry prompt/image references, not payloads | 2026-09-28 | mp4 outputs are 10s of MB; never stream through the API |
| S-06 | Server-side prompt/image encoding (reuse encode_prompt/encode_keyframes logic) with a persistent embedding cache keyed by hashes | 2026-09-28 | 63 GB encoder must not load per request; torch.load security (2.3 #8) |
| S-07 | Request validation: num_frames snapped to 17n+5, bounded steps (8/50 presets), image count/size/type checks | 2026-09-28 | Repo constraint 2.3 #2; abuse prevention |
| S-08 | Per-job timeout + cancellation (kill worker task; worker restarts clean due to one-way fp8 swap) | 2026-09-28 | 50-step renders hold a GPU 5-9 min |
| S-09 | Observability: export the repo's per-NFE timings (render.record JSON) as Prometheus metrics; queue depth, GPU occupancy | 2026-09-28 | Professional-grade operation |

### 4.2 Out of scope (v1) — revisit only via a logged decision

| # | Item | Excluded | Reason |
|---|---|---|---|
| X-01 | 8-GPU Ulysses fast lane as a served endpoint | 2026-09-28 | R-05: latency-lane only; deferred to phase 3 |
| X-01-R | 8-GPU Ulysses fast lane **delivered** (server/fast_lane.py, pool `node8`, node lock + idle probe + torchrun) | 2026-09-28 | Resolved by Session 4; live-fire pending GPU node |
| X-02 | SGLang Diffusion as an engine lane | 2026-09-28 | Covers T2VA/FL2VA only; one engine path for v1 (repo Python API covers all four modes) |
| X-02-R | SGLang lane **delivered** (server/sglang_engine.py, `--engine sglang`); ref2v routes to repo-stack pools | 2026-09-28 | Resolved by Session 4; API verified against sglang source, live-fire pending |
| X-03 | Batching multiple requests into one model call | 2026-09-28 | batch=1 is architectural in the model (2.3 #1) |
| X-04 | Training/fine-tuning endpoints | 2026-09-28 | Out of product scope |
| X-05 | Multi-node (cross-node) distribution | 2026-09-28 | Repo's multi-GPU path is single-node torchrun |
| X-06 | Streaming/progressive video output | 2026-09-28 | Sampler produces the clip atomically; partial frames are not consumable |

---

## 5. Phased build plan (2026-09-28)

**Phase 1 — Minimal production path (single node, single-GPU workers).**
- `server/` package in this repo: gateway app, worker entrypoint, shared
  job/queue models.
- Queue: Redis (Q-02 default). One worker per GPU; pool tag = GPU model.
- Worker: resident fp8 model per GPU model type; startup warmup; all four
  endpoints served from one engine (R-03).
- Gateway: auth + rate limits + validation + job CRUD + object-storage upload.
- Acceptance: end-to-end t2v render through HTTP; a second concurrent request
  queues (not errors); worker restart survives a killed render; p95
  queue-wait + render time visible in metrics.

**Phase 2 — Hardening.**
- Embedding cache service (Q-01 resolved); webhook delivery with retries;
  multi-tenant quotas; per-pool routing (B200 vs H200 configs per 2.2);
  load-shedding and priority lanes; cancellation UX; CI + integration tests
  against a GPU runner; docs + deployment manifests.

**Phase 3 — Scale lanes.**
- 8-GPU Ulysses fast lane (un-X-01) with node gang scheduling, if latency
  SLAs demand; optional SGLang lane for high-volume t2v/fl2v (un-X-02) behind
  the same gateway.

---

## 6. Engine API surface the worker builds on (verified 2026-09-28)

- `src.inference.utils.assemble.build_inference_model(cfg, device)` — spec ->
  base -> hybrid transform -> linear branch -> LoRA merge -> inference kernels
  -> fp8, in that fixed order. Returns the model bundle (transformer + both
  VAEs).
- `src.inference.utils.prompt_cache.load_prompt(path, device)` — returns
  `(prompt_embeds, text_token_tags, conditions)`; conditions carry keyframe
  anchors / reference latents and select the conditioning mode.
- `src.inference.render.generate_latents(transformer, prompt_embeds,
  text_token_tags, num_frames, num_steps, seed, device, video_shift,
  audio_shift, runtime=None, step_seconds=None, conditions=None)` — the
  sampler; runtime = Ulysses runtime (multi-GPU only).
- `src.inference.render.decode_and_save(latents, audio_latents, vae,
  audio_vae, out, device)` — decode + atomic mp4 mux.
- Config: `src.config.load_config(InferenceConfig, ...)`; worker should
  bypass YAML and construct config objects directly per request knobs
  (steps/seed/frames), keeping kernels/precision fixed per worker.

---

## 7. Known risks / watch items (living list)

| # | Risk | Mitigation direction | Added |
|---|---|---|---|
| K-01 | Worker crash mid-render wastes up to a full render's GPU time; fp8 swap makes in-place recovery impossible | Restart worker; job re-queued with same seed yields identical output (single-GPU reproducibility, 2.3 #5) — treat crashes as retryable | 2026-09-28 |
| K-02 | Kernel cache is per-machine (Triton/compile artifacts); new worker nodes pay minutes of compile at first warmup | Bake warmup into node startup / bake Triton cache into the image | 2026-09-28 |
| K-03 | Long renders (50-step) can starve the queue | Priority lanes + separate queues per step preset (Phase 2) | 2026-09-28 |
| K-04 | Upstream repo (`src/`) may change under us | Pin the engine to a repo commit / version tag in the worker image; engine-touching PRs must update this doc | 2026-09-28 |

---

*End of plan document. Append new session entries to Section 1; date every
change. Do not rewrite history above this line.*
