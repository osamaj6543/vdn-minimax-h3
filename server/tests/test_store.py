import time

import pytest

from server.store import JobNotFound, MemoryJobStore, new_job_id, time_iso


def make_job(state="queued", idem=None):
    return {
        "job_id": new_job_id(), "idempotency_key": idem, "pool": "default",
        "task": "t2v", "state": state, "prompt": "p", "num_frames": 345,
        "num_steps": 8, "seed": 42, "image_keys": [], "created_at": time_iso(),
        "cancel_requested": False,
    }


def test_create_and_get():
    store = MemoryJobStore()
    job = make_job()
    stored = store.create(job)
    assert stored["job_id"] == job["job_id"]
    assert store.get(job["job_id"])["state"] == "queued"
    assert store.get("missing") is None


def test_idempotency_returns_same_job():
    store = MemoryJobStore()
    first = store.create(make_job(idem="abc"))
    second = store.create(make_job(idem="abc"))
    assert first["job_id"] == second["job_id"]


def test_claim_fifo_and_skip_cancelled():
    store = MemoryJobStore()
    a, b = make_job(), make_job()
    for j in (a, b):
        store.create(j)
        store.enqueue(j["job_id"], "default")
    store.cancel(b["job_id"])                      # b cancelled while queued
    claimed = store.claim("default")
    assert claimed["job_id"] == a["job_id"]
    assert claimed["state"] == "running"
    assert store.claim("default") is None          # b skipped, queue empty


def test_cancel_running_sets_request_flag():
    store = MemoryJobStore()
    job = make_job(state="running")
    store.create(job)
    updated = store.cancel(job["job_id"])
    assert updated["state"] == "running"
    assert updated["cancel_requested"] is True


def test_reclaim_stale_requeues_running_only():
    store = MemoryJobStore()
    stale_job, fresh_job = make_job(), make_job()
    for j in (stale_job, fresh_job):
        store.create(j)
    store.update(stale_job["job_id"], state="running")
    store.update(fresh_job["job_id"], state="running")
    store._processing["default"] = {
        stale_job["job_id"]: time.time() - 3600,   # stale
        fresh_job["job_id"]: time.time(),          # fresh heartbeat
    }
    requeued = store.reclaim_stale("default", older_than_s=600)
    assert requeued == [stale_job["job_id"]]
    assert store.get(stale_job["job_id"])["state"] == "queued"
    assert store.get(fresh_job["job_id"])["state"] == "running"


def test_update_missing_raises():
    store = MemoryJobStore()
    with pytest.raises(JobNotFound):
        store.update("nope", state="failed")


def test_recent_orders_newest_first():
    store = MemoryJobStore()
    ids = []
    for _ in range(3):
        job = make_job()
        store.create(job)
        ids.append(job["job_id"])
    recent = store.recent("default")
    assert [j["job_id"] for j in recent] == ids[::-1]
