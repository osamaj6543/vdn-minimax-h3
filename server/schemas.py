"""Wire schemas: request bodies, job records, API views. pydantic v2.

Timestamps are UTC ISO-8601 strings. Job records are stored as plain dicts
(JSON in Redis), so JobRecord round-trips through JobStore.
"""
from datetime import datetime, timezone
from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class Task(str, Enum):
    t2v = "t2v"
    i2v = "i2v"      # first keyframe only
    l2v = "l2v"      # last keyframe only
    fl2v = "fl2v"    # first + last keyframes
    ref2v = "ref2v"  # reference images


class JobState(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def snap_num_frames(requested: int, low: int = 120, high: int = 360) -> int:
    """Snap up to the next 17n+5 within [low, high] (repo rule; 345 = 14.4 s)."""
    for n in range(low, high + 1):
        if (n - 5) % 17 == 0 and n >= requested:
            return n
    raise ValueError(f"no 17n+5 frame count in [{low}, {high}] satisfies {requested}")


# How many images each task expects: exact counts except ref2v (1..MAX_REFS).
IMAGE_COUNTS: Dict[Task, int] = {Task.i2v: 1, Task.l2v: 1, Task.fl2v: 2}
MAX_REFS = 8


class RenderRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)
    num_frames: int = Field(default=345, ge=22, le=360)
    num_steps: int = Field(default=8, ge=1, le=60,
                           description="model evaluations; presets 8 (turbo) and 50")
    seed: int = Field(default=42, ge=0, le=2**32 - 1)
    video_shift: float = Field(default=12.0, gt=0)
    audio_shift: float = Field(default=3.0, gt=0)
    priority: str = Field(default="standard",
                          description="high | standard | low; capped by the tier")
    webhook_url: Optional[str] = Field(default=None, max_length=2048,
                                       description="POSTed the terminal job state")


class T2VRequest(RenderRequest):
    pass


class I2VRequest(RenderRequest):
    first_image: str = "key of a prior POST /v1/uploads image"


class L2VRequest(RenderRequest):
    last_image: str = "key of a prior POST /v1/uploads image"


class FL2VRequest(RenderRequest):
    first_image: str = "key of a prior POST /v1/uploads image"
    last_image: str = "key of a prior POST /v1/uploads image"


class Ref2VRequest(RenderRequest):
    images: List[str] = Field(min_length=1, max_length=MAX_REFS,
                              description="keys of prior POST /v1/uploads images, in prompt order")


class JobView(BaseModel):
    """The public shape of a job — never leaks internal fields."""
    job_id: str
    task: str
    state: JobState
    prompt: str
    num_frames: int
    num_steps: int
    seed: int
    priority: str = "standard"
    pool: str = "default"
    image_keys: List[str] = []
    error: Optional[str] = None
    artifact_url: Optional[str] = None
    created_at: str
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    step_seconds: List[float] = []


class UploadOut(BaseModel):
    key: str
    bytes: int
