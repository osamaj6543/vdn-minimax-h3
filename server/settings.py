"""Server settings: environment-driven, one frozen dataclass.

Nothing here is required: defaults give a working dev setup (in-memory store,
single API key). Production sets VDN_REDIS_URL and VDN_API_KEYS.
"""
import os
from dataclasses import dataclass
from typing import Tuple


def _csv(name: str, default: str) -> Tuple[str, ...]:
    raw = os.environ.get(name, default)
    return tuple(part.strip() for part in raw.split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    # "redis" store backend, or "memory" (dev/tests; jobs are lost on restart)
    backend: str = os.environ.get("VDN_BACKEND", "memory")
    redis_url: str = os.environ.get("VDN_REDIS_URL", "redis://localhost:6379/0")
    # Queue/pool jobs are submitted to. One worker per GPU joins a pool;
    # per-GPU-model pools arrive in Phase 2.
    default_pool: str = os.environ.get("VDN_POOL", "default")
    # Accepted API keys (comma-separated). Phase 1: one global rate limit tier.
    api_keys: Tuple[str, ...] = _csv("VDN_API_KEYS", "dev-key")
    rate_limit_per_min: int = int(os.environ.get("VDN_RATE_LIMIT_PER_MIN", "30"))
    # Uploads
    upload_dir: str = os.environ.get("VDN_UPLOAD_DIR", "server_data/uploads")
    max_upload_mb: int = int(os.environ.get("VDN_MAX_UPLOAD_MB", "20"))
    # Rendered mp4s land here (LocalStorage); object storage is Phase 2.
    artifact_dir: str = os.environ.get("VDN_ARTIFACT_DIR", "server_data/artifacts")
    # Load shedding: refuse creates when a pool's queue exceeds this (503).
    max_queue_depth: int = int(os.environ.get("VDN_MAX_QUEUE_DEPTH", "500"))
    # Tenants: VDN_TENANTS="key=tier,..."; VDN_TIERS is a JSON tier table.
    tenants: Tuple[str, ...] = _csv("VDN_TENANTS", "")
    tiers_json: str = os.environ.get("VDN_TIERS", "")
    # Webhook signing secret (empty = unsigned; signing recommended).
    webhook_secret: str = os.environ.get("VDN_WEBHOOK_SECRET", "")
    # --- Phase 3: 8-GPU fast lane (node-exclusive torchrun jobs) ---
    fast_lane_pool: str = os.environ.get("VDN_FAST_LANE_POOL", "node8")
    fast_lane_nproc: int = int(os.environ.get("VDN_FAST_LANE_NPROC", "8"))
    # GPU name substring -> tuned Ulysses config yaml (plan doc 2.2).
    fast_lane_configs: str = os.environ.get(
        "VDN_FAST_LANE_CONFIGS",
        '{"B200": "configs/inference/8nfe_tuned_fp8_ulysses_b200.yaml",'
        ' "H200": "configs/inference/8nfe_tuned_fp8_ulysses_h200.yaml"}')
    lock_dir: str = os.environ.get("VDN_LOCK_DIR", "server_data/locks")
    # --- Phase 3: SGLang lane ---
    sglang_url: str = os.environ.get("VDN_SGLANG_URL", "") or None
    sglang_api_key: str = os.environ.get("VDN_SGLANG_API_KEY", "")
    sglang_model: str = os.environ.get("VDN_SGLANG_MODEL", "OpenVDN/vdn-minimax-h3")
    sglang_poll_seconds: float = float(os.environ.get("VDN_SGLANG_POLL_S", "2"))
    sglang_timeout_s: int = int(os.environ.get("VDN_SGLANG_TIMEOUT_S", "1800"))
    # --- Appwrite (auth + storage + durable records for the frontend) ---
    appwrite_enabled: bool = os.environ.get("VDN_APPWRITE_ENABLED", "") in ("1", "true", "True")
    appwrite_endpoint: str = os.environ.get("VDN_APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1")
    appwrite_project: str = os.environ.get("VDN_APPWRITE_PROJECT", "")
    appwrite_key: str = os.environ.get("VDN_APPWRITE_KEY", "")          # server API key
    appwrite_db: str = os.environ.get("VDN_APPWRITE_DB", "vdn")
    appwrite_jobs_table: str = os.environ.get("VDN_APPWRITE_JOBS_TABLE", "jobs")
    appwrite_users_table: str = os.environ.get("VDN_APPWRITE_USERS_TABLE", "users")
    appwrite_artifacts_bucket: str = os.environ.get("VDN_APPWRITE_ARTIFACTS_BUCKET", "")
    appwrite_uploads_bucket: str = os.environ.get("VDN_APPWRITE_UPLOADS_BUCKET", "")
    # "tablesdb" (v1.7+ /v1/tablesdb/{db}/tables/{t}/rows) or "documents" (legacy
    # /v1/databases/{db}/collections/{c}/documents)
    appwrite_db_style: str = os.environ.get("VDN_APPWRITE_DB_STYLE", "tablesdb")
    appwrite_auth_cache_ttl: int = int(os.environ.get("VDN_APPWRITE_AUTH_TTL", "60"))
    # Engine (worker side)
    checkpoint: str = os.environ.get("VDN_CHECKPOINT", "ckpts/stage-dmd-step-250")
    base_source: str = os.environ.get("VDN_BASE_SOURCE", "") or None
    device: str = os.environ.get("VDN_DEVICE", "cuda:0")
    fp8: bool = os.environ.get("VDN_FP8", "1") not in ("0", "false", "False")
    encode_cache_dir: str = os.environ.get("VDN_ENCODE_CACHE", "server_data/prompt_cache")
    # A claimed job silent for longer than this is dead and gets requeued.
    stale_seconds: int = int(os.environ.get("VDN_STALE_SECONDS", "600"))

    def validate(self) -> None:
        if self.backend not in ("memory", "redis"):
            raise ValueError(f"VDN_BACKEND must be 'memory' or 'redis', got {self.backend!r}")
        if not self.api_keys:
            raise ValueError("VDN_API_KEYS must name at least one key")
