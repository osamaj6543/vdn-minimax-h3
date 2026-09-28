import pytest

from server.storage import LocalStorage, make_storage
from server.store import MemoryJobStore


def test_local_storage_moves_and_serves_path(tmp_path):
    src = tmp_path / "incoming.mp4"
    src.write_bytes(b"MP4DATA")
    storage = LocalStorage(str(tmp_path / "artifacts"))
    url = storage.save(str(src), "job-1.mp4")
    assert url == "/v1/artifacts/job-1.mp4"
    assert src.exists() is False                    # moved, not copied
    assert storage.local_path("job-1.mp4").endswith("job-1.mp4")
    assert storage.local_path("nope.mp4") is None


def test_make_storage_defaults_to_local(tmp_path):
    from server.settings import Settings
    s = Settings(artifact_dir=str(tmp_path / "a"))
    assert isinstance(make_storage(s), LocalStorage)


def test_claim_drains_high_lane_first():
    store = MemoryJobStore()

    def job(name):
        return {"job_id": name, "idempotency_key": None, "pool": "p",
                "task": "t2v", "state": "queued", "prompt": "x",
                "num_frames": 345, "num_steps": 8, "seed": 1,
                "image_keys": [], "created_at": "2026-01-01T00:00:00+00:00",
                "priority": "standard", "cancel_requested": False}

    for name, prio in (("low1", "low"), ("std1", "standard"),
                       ("high1", "high"), ("std2", "standard")):
        j = job(name)
        j["priority"] = prio
        store.create(j)
        store.enqueue(j["job_id"], "p", prio)
    order = [store.claim("p")["job_id"] for _ in range(4)]
    assert order == ["high1", "std1", "std2", "low1"]
    assert store.queue_depth("p") == 0


def test_requeue_keeps_priority_lane():
    store = MemoryJobStore()
    j = job = {"job_id": "x", "idempotency_key": None, "pool": "p",
               "task": "t2v", "state": "running", "prompt": "x",
               "num_frames": 345, "num_steps": 8, "seed": 1, "image_keys": [],
               "created_at": "2026-01-01T00:00:00+00:00", "priority": "low",
               "cancel_requested": False}
    store.create(j)
    store._processing["p"] = {"x": 0.0}             # ancient heartbeat
    assert store.reclaim_stale("p", older_than_s=600) == ["x"]
    claimed = store.claim("p")
    assert claimed["job_id"] == "x"                 # requeued into the low lane
