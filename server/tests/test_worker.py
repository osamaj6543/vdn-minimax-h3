import time

from server.engine import FakeEngine
from server.schemas import Task
from server.settings import Settings
from server.store import MemoryJobStore, new_job_id, time_iso
from server.worker import Worker


def make_worker(tmp_path, engine=None, stale_seconds=600):
    settings = Settings(
        backend="memory", upload_dir=str(tmp_path / "uploads"),
        artifact_dir=str(tmp_path / "artifacts"),
        encode_cache_dir=str(tmp_path / "cache"),
    )
    store = MemoryJobStore()
    return Worker(store=store, engine=engine or FakeEngine(), pool="test",
                  artifact_dir=settings.artifact_dir,
                  upload_dir=settings.upload_dir,
                  stale_seconds=stale_seconds, poll_seconds=0.01), store


def make_job(store, prompt="a cat", state="queued"):
    job = {
        "job_id": new_job_id(), "idempotency_key": None, "pool": "test",
        "task": "t2v", "state": state, "prompt": prompt, "num_frames": 345,
        "num_steps": 8, "seed": 42, "image_keys": [], "created_at": time_iso(),
        "cancel_requested": False,
    }
    store.create(job)
    return job


def test_renders_job_to_succeeded(tmp_path):
    worker, store = make_worker(tmp_path)
    engine = worker.engine
    job = make_job(store)
    store.enqueue(job["job_id"], "test")
    claimed = store.claim("test")
    worker.run_one(claimed)
    done = store.get(job["job_id"])
    assert done["state"] == "succeeded"
    assert done["artifact_url"].endswith(f"{job['job_id']}.mp4")
    assert len(done["step_seconds"]) == 8
    renders = [c for c in engine.calls if c["kind"] == "render"]
    assert renders and renders[0]["task"] is Task.t2v


def test_engine_failure_marks_failed(tmp_path):
    worker, store = make_worker(tmp_path, engine=FakeEngine(fail_on_prompt="bad"))
    job = make_job(store, prompt="bad")
    store.enqueue(job["job_id"], "test")
    worker.run_one(store.claim("test"))
    done = store.get(job["job_id"])
    assert done["state"] == "failed"
    assert "injected failure" in done["error"]


def test_cancel_requested_discards_result(tmp_path):
    worker, store = make_worker(tmp_path)
    job = make_job(store)
    store.enqueue(job["job_id"], "test")
    claimed = store.claim("test")
    store.update(job["job_id"], cancel_requested=True)   # cancelled mid-render
    worker.run_one(claimed)
    done = store.get(job["job_id"])
    assert done["state"] == "cancelled"
    assert done.get("artifact_url") is None


def test_stale_running_job_is_requeued(tmp_path):
    worker, store = make_worker(tmp_path, stale_seconds=600)
    job = make_job(store)
    store.update(job["job_id"], state="running")
    store._processing["test"] = {job["job_id"]: time.time() - 3600}
    assert worker.reclaim_stale() == [job["job_id"]]
    assert store.get(job["job_id"])["state"] == "queued"


def test_cancelled_while_queued_is_never_rendered(tmp_path):
    worker, store = make_worker(tmp_path)
    job = make_job(store)
    store.enqueue(job["job_id"], "test")
    store.cancel(job["job_id"])
    assert store.claim("test") is None          # claim skips the cancelled job
    assert worker.engine.calls == []            # after warmup only; no renders
