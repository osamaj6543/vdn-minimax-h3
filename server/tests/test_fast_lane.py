import json
import os
import time

import pytest

from server.fast_lane import FastLane, NodeLock, default_probe
from server.settings import Settings
from server.store import MemoryJobStore, new_job_id, time_iso
from server.webhooks import WebhookDispatcher


def make_settings(tmp_path, **kw):
    defaults = dict(backend="memory", default_pool="test",
                    upload_dir=str(tmp_path / "uploads"),
                    artifact_dir=str(tmp_path / "artifacts"),
                    encode_cache_dir=str(tmp_path / "cache"),
                    lock_dir=str(tmp_path / "locks"),
                    fast_lane_pool="node8",
                    fast_lane_configs='{"B200": "configs/b200.yaml"}')
    defaults.update(kw)
    return Settings(**defaults)


def make_job(store, **kw):
    job = {"job_id": new_job_id(), "idempotency_key": None, "pool": "node8",
           "task": "t2v", "state": "queued", "prompt": "a cat",
           "num_frames": 345, "num_steps": 8, "seed": 42, "image_keys": [],
           "created_at": time_iso(), "priority": "standard",
           "webhook_url": "http://cb.example/hook", "cancel_requested": False}
    job.update(kw)
    store.create(job)
    return job


def test_node_lock_exclusive_and_stale(tmp_path):
    lock = NodeLock(str(tmp_path / "n.lock"))
    assert lock.acquire() is True
    assert NodeLock(str(tmp_path / "n.lock")).acquire() is False
    lock.release()
    assert NodeLock(str(tmp_path / "n.lock")).acquire() is True
    fresh = NodeLock(str(tmp_path / "s.lock"), stale_seconds=60)
    assert fresh.acquire() is True
    old = time.time() - 3600
    os.utime(tmp_path / "s.lock", (old, old))
    assert NodeLock(str(tmp_path / "s.lock"), stale_seconds=60).acquire() is True


def test_default_probe_parses_nvidia_smi(monkeypatch):
    def fake_run(stdout):
        class Out:
            pass
        Out.stdout = stdout
        return Out()

    idle = "0, 10\n0, 15\n0, 12\n0, 11\n"
    busy = "0, 10\n97, 40000\n0, 12\n0, 11\n"
    monkeypatch.setattr("server.fast_lane.subprocess.run",
                        lambda cmd, **kw: fake_run(idle))
    assert default_probe(4) is True
    assert default_probe(8) is False                      # 4 rows < 8 GPUs
    monkeypatch.setattr("server.fast_lane.subprocess.run",
                        lambda cmd, **kw: fake_run(busy))
    assert default_probe(4) is False


def test_torchrun_cmd_uses_tuned_config(tmp_path, monkeypatch):
    monkeypatch.setattr("server.fast_lane.gpu_name",
                        lambda probe_name=None: "NVIDIA B200")
    store = MemoryJobStore()
    job = make_job(store)
    lane = FastLane(store, make_settings(tmp_path), probe=lambda: True,
                    runner=lambda cmd, jid: None,
                    encoder_runner=lambda cmd, jid: None)
    cmd = lane.torchrun_cmd(job, "cache.pt", "out.mp4")
    assert cmd[0] == "torchrun" and "--nproc_per_node=8" in cmd
    assert any("b200.yaml" in part for part in cmd)
    assert "render.num_frames=345" in cmd and "render.seed=42" in cmd
    assert "render.warmup_steps=2" in cmd


def test_unknown_gpu_fails_loudly(tmp_path, monkeypatch):
    monkeypatch.setattr("server.fast_lane.gpu_name",
                        lambda probe_name=None: "NVIDIA A100")
    store = MemoryJobStore()
    job = make_job(store)
    lane = FastLane(store, make_settings(tmp_path), probe=lambda: True,
                    runner=lambda cmd, jid: None,
                    encoder_runner=lambda cmd, jid: None)
    with pytest.raises(RuntimeError, match="A100"):
        lane.torchrun_cmd(job, "cache.pt", "out.mp4")


def test_run_one_success_and_webhook(tmp_path, monkeypatch):
    monkeypatch.setattr("server.fast_lane.gpu_name",
                        lambda probe_name=None: "NVIDIA B200")
    received = []
    webhooks = WebhookDispatcher(post=lambda url, body, headers:
                                 received.append(json.loads(body)))
    store = MemoryJobStore()
    job = make_job(store)
    lane = FastLane(store, make_settings(tmp_path), probe=lambda: True,
                    runner=lambda cmd, jid: None,
                    encoder_runner=lambda cmd, jid: None, webhooks=webhooks)
    webhooks.start()
    store.enqueue(job["job_id"], "node8", "standard")
    lane.run_one(store.claim("node8"))
    time.sleep(0.3)
    done = store.get(job["job_id"])
    assert done["state"] == "succeeded"
    assert done["artifact_url"].endswith(f"{job['job_id']}.mp4")
    assert received and received[0]["job_id"] == job["job_id"]
    webhooks.stop()


def test_run_one_failure_marks_failed(tmp_path, monkeypatch):
    monkeypatch.setattr("server.fast_lane.gpu_name",
                        lambda probe_name=None: "NVIDIA B200")
    store = MemoryJobStore()
    job = make_job(store)

    def boom(cmd, jid):
        raise RuntimeError("torchrun exploded")

    lane = FastLane(store, make_settings(tmp_path), probe=lambda: True,
                    runner=boom, encoder_runner=lambda cmd, jid: None)
    store.enqueue(job["job_id"], "node8", "standard")
    lane.run_one(store.claim("node8"))
    done = store.get(job["job_id"])
    assert done["state"] == "failed"
    assert "torchrun exploded" in done["error"]


def test_serve_forever_defers_when_locked(tmp_path):
    """A second lane on the same node requeues the job instead of rendering."""
    store = MemoryJobStore()
    job = make_job(store)
    settings = make_settings(tmp_path)
    other_lock = NodeLock(str(settings.lock_dir + "/fast_lane.lock"))
    assert other_lock.acquire()                       # simulate the busy lane

    lane = FastLane(store, settings, probe=lambda: True,
                    runner=lambda cmd, jid: pytest.fail("must not run"),
                    encoder_runner=lambda cmd, jid: None)
    store.enqueue(job["job_id"], "node8")
    ticks = {"n": 0}

    def stop_after_two(seconds):
        ticks["n"] += 1
        if ticks["n"] >= 2:
            lane._stop = True

    real_sleep = time.sleep
    time.sleep = stop_after_two
    try:
        lane.serve_forever()
    finally:
        time.sleep = real_sleep
        other_lock.release()
    assert store.get(job["job_id"])["state"] == "queued"   # requeued, unrendered
