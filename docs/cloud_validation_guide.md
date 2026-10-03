# Cloud validation guide — `deploy/cloud_validate.sh` on a rented H100

This guide walks you from "no GPU" to a recorded validation report using a
single rented H100 80 GB instance. Follow it top to bottom; every command is
copy-pasteable.

**Created:** 2026-09-28 19:45 local. Companion to
[docs/server_plan.md](server_plan.md) (the standing "GPU validation" gate) and
[deploy/cloud_validate.sh](../deploy/cloud_validate.sh).

---

## 0. What you are validating, and what "done" looks like

The script provisions the full pinned stack on a fresh Ubuntu box and then runs
the server's staged validation against the **real VDN-H3 weights**:

```
preflight -> assemble (fp8) -> encode (Qwen3-VL) -> warmup -> render -> store
```

**Done = two report files exist and say `"ok": true`:**

| File | Config |
|---|---|
| `~/vdn-validate/artifacts/validation_quick.mp4.validation.json` | 39 frames, 2 steps (cheap assembly check) |
| `~/vdn-validate/artifacts/validation.mp4.validation.json` | 345 frames (= 14.4 s), 8 steps (the real config) |

You also get `validation.mp4` / `validation_quick.mp4` (playable clips) and a
full console log (`validate.log`).

### Hardware, time, cost

| Item | Value |
|---|---|
| GPU | **H100 80 GB** (sm90) — best default. H200/B200 also work; RTX PRO 6000 Blackwell (96 GB) works too |
| Why ≥ 80 GB | fp8 requires capability ≥ 9.0; the repo's fp8 memory envelope is documented to fit 80 GB |
| Disk | **≥ 200 GB free** (weights are ~82 GB, plus venv/caches) |
| Time | ~1.5–2.5 h total: env 20–40 min · download 10–30 min · validation ~15–25 min |
| Cost | ~$4–10 at ~$2–3/hr. **Stop the instance as soon as you have the reports** |

### Which card? (the answer differs by architecture, not by VRAM)

| Card | Compute cap | FA4 kernels? | What you get |
|---|---|---|---|
| H100 / H200 | sm90 | ✅ yes | The tuned path; the repo's own benchmarks |
| B200 | sm100 | ✅ yes | The tuned path (fastest published) |
| **RTX PRO 6000 Blackwell** (Workstation / Max-Q / Server) | **sm120 / sm122** | ❌ **no** | **Works**, but on the fallback kernels |

The repo gates FlashAttention-4 by **membership**, never by `>=`:

```
FA4_MAJORS = (9, 10, 11)   # sm90, sm100, sm110 only
# "Ampere, Ada and consumer Blackwell (sm120) are not among them,
#  whatever their capability number"        -- src/models/softmax_attention/window.py
```

So on an RTX PRO 6000 Blackwell (compute capability **12.2**, i.e. `sm_122` —
verified against NVIDIA/PyTorch reporting) the window softmax runs on
FlexAttention's **Triton** kernel, or on **PyTorch's `varlen_attn` + SDPA**
under `decomposed` — exactly the documented fallback row in
[docs/inference.md](inference.md). Nothing degrades to dense attention and
fp8 still applies (12 ≥ 9), but:

- **timings are not comparable** to the README/H100 tables — expect a different
  number, and treat your run as a correctness baseline for that card;
- `server.preflight` prints a `fa4-arch` line stating which path you got;
- **the pinned PyTorch must actually have kernels for the card.** sm_122 is
  newer than sm_120, and older torch builds fail *hard* on it:
  `CUDA capability sm_122 is not compatible with the current PyTorch
  installation`. The script installs `torch==2.13.0` and then verifies it with
  a real kernel launch **before** downloading the weights (stage 5b) — but if
  you pin an older torch yourself, that check is what saves your rental.

**Recommendation:** use an H100 for the *comparable* numbers, or an RTX PRO
6000 Blackwell happily for *correctness + memory headroom* (96 GB vs 80 GB).
Either one closes the validation gate.

> **Reality check on speed:** a single H100 is slower than the numbers in the
> repo's README (those are H200/B200). Expect roughly 12–17 s per model
> evaluation (~2 min of denoising for the 8-step run), so the *full* validation
> takes tens of minutes including the 66 GB model load.

---

## 1. Before you rent

- **Choose an image with the CUDA toolkit already installed** (the provider's
  "PyTorch 2.x + CUDA 12.x" or "CUDA devel" images). A bare Ubuntu image has no
  `nvcc`, and building `flash-attn-4` from source will fail. Ubuntu 22.04 or
  24.04.
- You will run as **root** (typical on Vast.ai / RunPod / Lambda). `sudo` is
  used by the script and is present on the standard images.
- Outbound network access to: `pypi.org`, `download.pytorch.org`,
  `github.com`, `huggingface.co`. No inbound ports needed (you only SSH in).

---

## 2. Step 0 — get *your* repo onto the box (the step that matters)

`deploy/cloud_validate.sh` lives in **your working copy**, together with the
`server/` package it drives. Those are **not in the upstream
`OpenVDN/vdn-minimax-h3` repository**, so a plain clone of upstream will fail at
step 8 (`server/` missing). Pick one of the two paths below.

### Path A — push your working copy to a fork (recommended, repeatable)

On **your local machine** (PowerShell, repo root `D:\WEB\vdn-minimax-h3`):

```powershell
git add -A
git commit -m "vdn: server, deploy runbook, frontend"
# create an empty repo on GitHub first (private is fine), then:
git remote add mine https://github.com/<YOUR-USER>/vdn-minimax-h3.git
git push -u mine main
```

Then on the cloud box you only need `REPO_URL` pointing at your fork — the
script clones it.

> Keep the fork **private** if you prefer; nothing about the public upstream
> license prevents it, but the `server/` + `frontend/` work is yours.

### Path B — no git hosting: ship a tarball

On **your local machine** (`tar` ships with Windows 10+):

```powershell
cd D:\WEB\vdn-minimax-h3
tar -czf vdn-src.tar.gz --exclude=.git --exclude=node_modules `
    --exclude=frontend/.next --exclude=ckpts --exclude=server_data `
    --exclude=results .
```

On the cloud box:

```bash
mkdir -p ~/vdn-validate/vdn-minimax-h3
tar -xzf ~/vdn-src.tar.gz -C ~/vdn-validate/vdn-minimax-h3
```

(Advantage of Path B: it captures your **uncommitted** files exactly.)

---

## 3. Rent the instance and connect

1. Rent a **1× H100 80 GB** instance (Vast.ai / RunPod / Lambda / Fluidstack),
   with the CUDA-toolkit image from Step 1 and ≥ 200 GB disk. Attach an SSH
   key or use the provider's web terminal.
2. Connect:

```bash
ssh root@<INSTANCE-IP> -p <PORT>
```

3. Confirm the GPU is visible and is the right one:

```bash
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv
```

You should see `NVIDIA H100 ... 81559 MiB`.

---

## 4. Run the validation

### 4.1 Start a persistent session FIRST (protects a 2-hour job)

If your SSH connection drops mid-run the job dies. Use `tmux`:

```bash
tmux new -s validate        # or: apt-get install -y tmux && tmux new -s validate
```

Detach with `Ctrl-b` then `d`; reattach later with `tmux attach -t validate`.

### 4.2 Get the repo onto the box

**Path A (fork):**

```bash
mkdir -p ~/vdn-validate && cd ~/vdn-validate
git clone https://github.com/<YOUR-USER>/vdn-minimax-h3.git
cd vdn-minimax-h3
```

**Path B (tarball):**

```bash
cd ~/vdn-validate/vdn-minimax-h3
```

Either way you should now be in a checkout that contains `server/`:

```bash
ls -d server deploy && echo "OK: harness present"
```

### 4.3 Run the script

```bash
export WORKDIR=$HOME/vdn-validate          # MUST be the PARENT of the checkout
export REPO_URL=https://github.com/<YOUR-USER>/vdn-minimax-h3.git   # Path A only
bash deploy/cloud_validate.sh 2>&1 | tee validate.log
```

**Why `WORKDIR` must be the parent:** the script does
`mkdir -p $WORKDIR && cd $WORKDIR` then `[ -d vdn-minimax-h3 ] || git clone`.
With `WORKDIR=$HOME/vdn-validate` and the checkout already at
`$HOME/vdn-validate/vdn-minimax-h3`, the clone is skipped and every later path
(`$WORKDIR/venv`, `$WORKDIR/ckpts`, `$WORKDIR/artifacts`) lines up around it.

The script is **re-runnable**: completed pip installs and an existing clone are
skipped, and an already-downloaded `ckpts/` is reused.

### 4.4 Optional knobs

| Variable | Effect |
|---|---|
| `WORKDIR` | parent dir for venv/ckpts/artifacts (must be the checkout's parent) |
| `REPO_URL` | which repo to clone when the checkout is absent (Path A) |
| `HF_TOKEN` | optional; raises Hugging Face download rate limits |
| `VDN_FP8=0` | disable fp8 (not recommended on 80 GB — bf16 does not fit) |

---

## 5. What the 8 stages do

| Stage | What it does | Typical time |
|---|---|---|
| 1/8 system deps | apt: git, build tools, python3.12 (+deadsnakes fallback), ffmpeg | 2–8 min |
| 2/8 nvidia driver sanity | `nvidia-smi` | seconds |
| 3/8 python env | venv + `uv` | < 1 min |
| 4/8 repo | clone + **`server/` presence guard** | seconds–1 min |
| 5/8 pinned stack | `torch==2.13.0` (cu129), `-e .` with `--prerelease=allow`, `server/requirements.txt` | 10–25 min |
| 6/8 patched diffusers | `scripts/setup_diffusers.sh` | 1–5 min |
| 7/8 weights | ~82 GB from the Hub into `$WORKDIR/ckpts` | 10–30 min |
| 8/8 preflight + validation | `server.preflight`, then quick (39f×2) and full (345f×8) | 15–25 min |

Stage 8 prints the preflight table first — every line must read `[PASS]`
(torch pin, cuda, cuda-fp8, diffusers-h3, flash-attn-4, weights). If one reads
`[FAIL]`, stop and see §7.

Then each validation stage is timed and printed, e.g.:

```
[validate] stage assemble...
[validate]   PASS (212.4s) fp8 model resident
[validate] stage warmup...
[validate]   PASS (188.0s) compile absorbed
[validate] stage render...
[validate]   PASS (142.9s) 8 NFEs, avg 15.1 s/NFE: [17.2, 15.6, ...]
[validate] stage store...
[validate]   PASS (0.1s) artifact at /v1/artifacts/validation.mp4
```

---

## 6. Collect the results

```bash
cd ~/vdn-validate

# the two machine-readable reports (this is the deliverable)
cat artifacts/validation_quick.mp4.validation.json
cat artifacts/validation.mp4.validation.json

# the timing line and any stage failures from the console log
grep -E "timing:|FAIL|PASS|error" validate.log | tail -40

# inventory
ls -la artifacts/
```

Every report ends with `"ok": true` when all six stages passed. The whole JSON
(plus `validate.log`) is what gets recorded as the evidence for the validation
gate.

**Optional — pull the clips back to watch them** (on your local machine):

```powershell
scp -P <PORT> root@<INSTANCE-IP>:~/vdn-validate/artifacts/validation.mp4 .
```

---

## 7. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ERROR: this checkout has no server/ directory` | You cloned upstream instead of your fork, or used Path B without the tarball. Redo §2 / §4.2 |
| `python3.12: command not found` | The deadsnakes fallback inside the script handles it; if it still fails, use an image with Python 3.12 |
| `flash-attn-4` build errors / `nvcc not found` | The instance image lacks the CUDA toolkit. Re-rent with a CUDA-devel image, or `apt-get install -y cuda-toolkit-12-*` and re-run |
| Stage 5 very slow | Building flash-attn-4 from source; 20+ min is normal on a slow image |
| Stage 7 stalls | Hub rate limit — set `HF_TOKEN`, or re-run (the download resumes/keeps what it has) |
| `[FAIL] diffusers-h3` in preflight | `scripts/setup_diffusers.sh` did not finish, or its tree is not first on `sys.path`. Re-run that script |
| `[FAIL] weights:checkpoint` / `base_source` | `ckpts/` layout is wrong; it must contain `h3-base/` and `stage-dmd-step-250/` |
| Stage 5b: `CUDA capability sm_122 is not compatible with the current PyTorch installation` | Your torch build has no kernels for a workstation Blackwell card. Stage 5b catches it **before** the 82 GB download. Install a newer torch/cu index, or use an H100/better-supported card |
| Stage 5: `-e .` fails, then the script prints `WARN: ... retrying without` | Normal on sm120/sm122: `flash-attn-4` has no kernels for that arch. The fallback installs the same stack minus FA4, which is unused on that card anyway |
| Preflight `fa4-arch` says "NOT an FA4 card" | Expected on RTX PRO 6000 Blackwell. Supported fallback path (Triton / torch kernels); do not treat it as a failure — only the timings change |
| RTX PRO 6000 Blackwell: wanting GPU-GPU performance numbers | Not available from this card. Use H200/B200 for the repo's published table; the Blackwell workstation card gives correctness + fits fp8 comfortably in 96 GB |
| CUDA out of memory during `render` | Try the quick config only (`--frames 39 --steps 2`) and record that; a full 345-frame run needs the 80 GB envelope. Do not disable fp8 (bf16 needs more) |
| Script exits non-zero with everything else green | Look at the last `[validate] FAIL` line and the `"stages"` array in the JSON — it names the failing stage and its error |
| SSH session dropped mid-run | Reattach (`tmux attach -t validate`) if you used tmux; otherwise re-run — completed steps are skipped |

---

## 8. Record the result, then tear down

1. Paste the two JSON reports (or at least the full one) and the `timing:` line
   from `validate.log` into `docs/server_plan.md`, appending a new dated Session
   entry that marks the GPU-validation gate resolved.
2. Optional but valuable — **live-fire the actual server on the same box**
   (no extra cost, ~10 min): see Appendix B.
3. **Stop/destroy the instance** to stop billing.

```bash
# last thing on the box, if you are done:
exit
# then destroy the instance in your provider's console
```

---

## Appendix A — the manual equivalent (if you prefer step-by-step)

Run these on the box instead of the script; each maps to one script stage.

```bash
# --- 1. system deps ---
apt-get update -y
apt-get install -y git curl wget build-essential python3.12 python3.12-venv \
  python3.12-dev ffmpeg

# --- 2. GPU sanity ---
nvidia-smi --query-gpu=name,memory.total --format=csv

# --- 3. python env ---
mkdir -p ~/vdn-validate
python3.12 -m venv ~/vdn-validate/venv
source ~/vdn-validate/venv/bin/activate
pip install -q --upgrade pip uv

# --- 4. repo (already present via §2/§4.2) ---
cd ~/vdn-validate/vdn-minimax-h3

# --- 5. pinned stack (order matters: torch cu129 FIRST) ---
uv pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu129
uv pip install --prerelease=allow -e .
uv pip install -r server/requirements.txt

# --- 6. patched diffusers ---
bash scripts/setup_diffusers.sh

# --- 7. weights (~82 GB) ---
hf download OpenVDN/vdn-minimax-h3 --local-dir ~/vdn-validate/ckpts

# --- 8. environment for the validator ---
export VDN_CHECKPOINT=~/vdn-validate/ckpts/stage-dmd-step-250
export VDN_BASE_SOURCE=~/vdn-validate/ckpts/h3-base
export VDN_ARTIFACT_DIR=~/vdn-validate/artifacts
export VDN_ENCODE_CACHE=~/vdn-validate/prompt_cache
export VDN_UPLOAD_DIR=~/vdn-validate/uploads
export VDN_LOCK_DIR=~/vdn-validate/locks
export VDN_STORAGE=local

# --- 9. validate ---
python -m server.preflight
python -m server.validate_gpu --frames 39  --steps 2 \
  --out ~/vdn-validate/artifacts/validation_quick.mp4
python -m server.validate_gpu --frames 345 --steps 8 \
  --out ~/vdn-validate/artifacts/validation.mp4
```

---

## Appendix B — live-fire the actual server on the same box

You have real weights and a real GPU loaded for only this session — spend the
extra ~10 minutes proving the **gateway + worker** path works end to end with
the real engine (not just `FakeEngine`). This closes the second standing gate
in `docs/server_plan.md`.

```bash
cd ~/vdn-validate/vdn-minimax-h3
source ~/vdn-validate/venv/bin/activate

# shared job store: the gateway and the worker are separate processes, so they
# need Redis (the in-memory backend is per-process and would NOT be shared)
apt-get install -y redis-server
redis-server --daemonize yes
export VDN_BACKEND=redis VDN_REDIS_URL=redis://127.0.0.1:6379/0

export VDN_CHECKPOINT=~/vdn-validate/ckpts/stage-dmd-step-250
export VDN_BASE_SOURCE=~/vdn-validate/ckpts/h3-base
export VDN_ARTIFACT_DIR=~/vdn-validate/artifacts
export VDN_ENCODE_CACHE=~/vdn-validate/prompt_cache
export VDN_UPLOAD_DIR=~/vdn-validate/uploads
export VDN_STORAGE=local
export VDN_API_KEYS=dev-key        # no Appwrite needed for this smoke test
```

Start the two processes (separate tmux windows, or background them):

```bash
python -m server.app &                 # gateway on :8000 (CPU only)
python -m server.worker --pool default &   # worker: assembles 66 GB, then warms up
```

Wait for the worker to print `[worker] warm` (several minutes: load + compile),
then queue a real job and poll it:

```bash
JOB=$(curl -s -X POST localhost:8000/v1/video/t2v \
  -H "X-API-Key: dev-key" -H "Content-Type: application/json" \
  -d '{"prompt":"a cinematic establishing shot of Cologne Cathedral at golden hour","num_frames":345,"num_steps":8,"seed":42}' \
  | python -c "import sys,json;print(json.load(sys.stdin)['job_id'])")
echo "job: $JOB"

# poll until state is succeeded (queued -> running -> succeeded)
watch -n 10 "curl -s localhost:8000/v1/jobs/$JOB -H 'X-API-Key: dev-key'"

# download the artifact through the auth-gated endpoint
curl -s -H "X-API-Key: dev-key" "localhost:8000/v1/artifacts/$JOB.mp4" -o live.mp4
ls -la live.mp4
```

What to record from this run (append to the same Session entry):

- the `POST` returned `202` with a job id;
- the job reached `succeeded` with non-empty `step_seconds`;
- `live.mp4` is a playable ~14.4 s clip;
- the worker log line `[engine] assembling ... pool=default softmax_backend=auto`.

That is Phase 1's acceptance criterion ("end-to-end t2v render through HTTP")
executed against real weights — the last unverified claim in the plan doc.

---

## Appendix C — one-screen TL;DR

```bash
# on the box (H100 80GB, CUDA image), inside a tmux session:
export WORKDIR=$HOME/vdn-validate
mkdir -p "$WORKDIR" && cd "$WORKDIR"
git clone https://github.com/<YOUR-USER>/vdn-minimax-h3.git   # your fork, has server/
cd vdn-minimax-h3
bash deploy/cloud_validate.sh 2>&1 | tee validate.log
cat "$WORKDIR"/artifacts/*.validation.json
```