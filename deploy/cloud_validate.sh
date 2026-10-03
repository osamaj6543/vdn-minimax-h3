#!/usr/bin/env bash
# Cloud validation runbook: ONE command on a fresh CUDA Linux box (Ubuntu 22.04/24.04).
#
#   bash deploy/cloud_validate.sh 2>&1 | tee validate.log
#
# Hardware: any sm >= 9.0 card with >= 80 GB.
#   Data-center: H100 (sm90), H200 (sm90), B200 (sm100) - the tuned FA4 path.
#   Workstation Blackwell: RTX PRO 6000 (sm120/sm122) - SUPPORTED but not an
#     FA4 card, so the window softmax runs on the Triton / torch fallbacks
#     (docs/inference.md) and timings will differ from the README tables.
# H100 80GB is sufficient and cheapest: fp8 needs capability >= 9.0 and the
# repo's fp8 memory envelope is documented to fit 80 GB (docs/inference.md).
# The RTX PRO 6000 Blackwell has 96 GB, which also fits.
# Expect ~1.5-2.5 h total and ~$5-10 on a ~$2.5/hr H100 rental:
#   ~20-40 min environment, ~10-30 min weight download (82 GB), ~15 min validate.
# Disk: >= 200 GB free. Network: open egress to pypi, download.pytorch.org,
# github.com, huggingface.co.
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/OpenVDN/vdn-minimax-h3.git}"
WORKDIR="${WORKDIR:-$HOME/vdn-validate}"
export DEBIAN_FRONTEND=noninteractive

say() { printf '\n===== %s =====\n' "$*"; }

say "1/8 system deps"
sudo apt-get update -y
sudo apt-get install -y git curl wget build-essential python3.12 python3.12-venv \
  python3.12-dev ffmpeg || {
  # deadsnakes fallback when 3.12 is not in the base repo
  sudo apt-get install -y software-properties-common
  sudo add-apt-repository -y ppa:deadsnakes/ppa
  sudo apt-get update -y
  sudo apt-get install -y git curl wget build-essential python3.12 python3.12-venv \
    python3.12-dev ffmpeg
}

say "2/8 nvidia driver sanity"
nvidia-smi --query-gpu=name,driver_version,memory.total --format=csv

say "3/8 python 3.12 env + uv"
python3.12 -m venv "$WORKDIR/venv"
# shellcheck disable=SC1091
source "$WORKDIR/venv/bin/activate"
pip install -q --upgrade pip uv

say "4/8 repo"
mkdir -p "$WORKDIR" && cd "$WORKDIR"
[ -d vdn-minimax-h3 ] || git clone "$REPO_URL"
cd vdn-minimax-h3
git log --oneline -1
# The validation harness lives in server/ (this fork), NOT upstream. Fail fast
# and loudly instead of dying at step 8 inside server.preflight.
[ -d server ] || {
  echo "ERROR: this checkout has no server/ directory."
  echo "The validation harness is in the FORK that carries server/ and deploy/."
  echo "Set REPO_URL to that fork, or see docs/cloud_validation_guide.md (Step 0)."
  exit 1
}

say "5/8 pinned stack: torch cu129 first, then the repo (+ flash-attn-4 prerelease)"
uv pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu129
uv pip install --prerelease=allow -e . || {
  echo "WARN: repo install failed. On a non-FA4 card (sm120/sm122 workstation"
  echo "      Blackwell) this is almost always flash-attn-4. Retrying the same"
  echo "      stack WITHOUT it: this card's window softmax runs on the"
  echo "      Triton/torch fallbacks anyway (docs/inference.md)."
  uv pip install --prerelease=allow -e . --no-deps
  uv pip install --prerelease=allow triton==3.7.1 transformers==5.15.0 \
    accelerate==1.14.0 torchao==0.18.0 peft==0.20.0 safetensors==0.8.0 \
    "huggingface_hub>=1.27.0" omegaconf==2.3.1 pyyaml==6.0.3 einops==0.8.2 \
    numpy==2.5.2 pillow==12.3.0 torchvision==0.28.0 av==18.1.0 tqdm
}
uv pip install -r server/requirements.txt   # gateway/validation stack: pydantic, fastapi, ...

say "5b/8 torch-vs-GPU kernel check (fail HERE, not after the 82 GB download)"
python - <<'PY'
import torch
if not torch.cuda.is_available():
    raise SystemExit("FAIL: torch.cuda.is_available() is False")
name = torch.cuda.get_device_name(0)
major, minor = torch.cuda.get_device_capability(0)
print(f"torch {torch.__version__} (cuda {torch.version.cuda}) on {name} sm_{major}{minor}")
torch.zeros(1, device="cuda").add_(1)      # a real kernel launch on this card
print("kernel launch OK - this torch build has kernels for this GPU")
PY

say "6/8 patched diffusers"
bash scripts/setup_diffusers.sh

say "7/8 weights (~82 GB from the Hub into $WORKDIR/ckpts)"
hf download OpenVDN/vdn-minimax-h3 --local-dir "$WORKDIR/ckpts"

say "8/8 preflight + staged validation"
export VDN_CHECKPOINT="$WORKDIR/ckpts/stage-dmd-step-250"
export VDN_BASE_SOURCE="$WORKDIR/ckpts/h3-base"
export VDN_ARTIFACT_DIR="$WORKDIR/artifacts"
export VDN_ENCODE_CACHE="$WORKDIR/prompt_cache"
export VDN_LOCK_DIR="$WORKDIR/locks"
export VDN_UPLOAD_DIR="$WORKDIR/uploads"
export VDN_STORAGE=local

python -m server.preflight

# quick smoke first (39 frames, 2 steps): catches assembly problems cheaply
python -m server.validate_gpu --frames 39 --steps 2 \
  --out "$WORKDIR/artifacts/validation_quick.mp4"

# then the real thing: 345 frames, 8 steps (the 51 s / 90.5 s config)
python -m server.validate_gpu --frames 345 --steps 8 \
  --out "$WORKDIR/artifacts/validation.mp4"

say "DONE - report files"
ls -la "$WORKDIR/artifacts/"
cat "$WORKDIR/artifacts/validation.mp4.validation.json"
echo "Paste the JSON above (and validate.log) into docs/server_plan.md of your checkout."
