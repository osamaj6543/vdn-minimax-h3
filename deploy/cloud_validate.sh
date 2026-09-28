#!/usr/bin/env bash
# Cloud validation runbook: ONE command on a fresh CUDA Linux box (Ubuntu 22.04/24.04).
#
#   bash deploy/cloud_validate.sh 2>&1 | tee validate.log
#
# Hardware: any sm >= 9.0 card with >= 80 GB (H100 / H200 / B200).
# H100 80GB is sufficient and cheapest: fp8 needs capability >= 9.0 and the
# repo's fp8 memory envelope is documented to fit 80 GB (docs/inference.md).
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

say "5/8 pinned stack: torch cu129 first, then the repo (+ flash-attn-4 prerelease)"
uv pip install torch==2.13.0 --index-url https://download.pytorch.org/whl/cu129
uv pip install --prerelease=allow -e .

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
