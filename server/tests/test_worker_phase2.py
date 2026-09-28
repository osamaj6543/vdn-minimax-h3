import time

from server.engine import FakeEngine
from server.settings import Settings
from server.storage import LocalStorage
from server.store import MemoryJobStore, new_job_id, time_iso
from server.webhooks import WebhookDispatcher
from server.worker import Worker


def make_worker(tmp_path, webhooks=None):
    settings = Settings(
        backend="memory", upload_dir=str(tmp_path / "uploads"),
        artifact_dir=str(tmp_path / "artifacts"),
        encode_cache_dir=str(tmp_path / "cache"))
    store = MemoryJobStore()
    storage = LocalStorage(settings.artifact_dir)
    worker = Worker(store=store, engine=FakeEngine(), pool="test",
                    artifact_dir=settings.artifact_dir,
                    upload_dir=settings.upload_dir,
                    storage=storage, webhooks=webhooks, poll_seconds=0.01)
    return worker, store, settings


def make_job(store):
    job = {"job_id": new_job_id(), "idempotency_key": None, "pool": "test",
           "task": "t2v", "state": "queued", "prompt": "a cat",
           "num_frames": 345, "num_steps": 8, "seed": 42, "image_keys": [],
           "webhook_url": "http://cb.example/hook",
           "created_at": time_iso(), "priority": "standard",
           "cancel_requested": False}
    store.create(job)
    return job


def test_success_moves_artifact_and_fires_webhook(tmp_path):
    received = []
    d = WebhookDispatcher(post=lambda url, body, headers:
                          received.append(__import__("json").loads(body)))
    worker, store, settings = make_worker(tmp_path, webhooks=d)
    d.start()
    job = make_job(store)
    store.enqueue(job["job_id"], "test")
    worker.run_one(store.claim("test"))
    time.sleep(0.3)

    done = store.get(job["job_id"])
    assert done["state"] == "succeeded"
    assert done["artifact_url"] == f"/v1/artifacts/{job['job_id']}.mp4"
    assert (tmp_path / "artifacts" / f"{job['job_id']}.mp4").is_file()
    assert received and received[0]["job_id"] == job["job_id"]
    assert received[0]["artifact_url"] == done["artifact_url"]
    d.stop()


def test_failure_also_fires_webhook(tmp_path):
    received = []
    d = WebhookDispatcher(post=lambda url, body, headers:
                          received.append(__import__("json").loads(body)))
    worker, store, _ = make_worker(tmp_path, webhooks=d)
    worker.engine = FakeEngine(fail_on_prompt="bad")
    d.start()
    job = make_job(store)
    store.update(job["job_id"], prompt="bad")
    store.enqueue(job["job_id"], "test")
    worker.run_one(store.claim("test"))
    time.sleep(0.3)

    done = store.get(job["job_id"])
    assert done["state"] == "failed"
    assert received and received[0]["state"] == "failed"
    assert received[0]["error"]
    d.stop()
