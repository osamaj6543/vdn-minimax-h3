"""Phase 2 gateway behavior: metrics, priority ceiling, quotas, load shedding."""
from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings
from server.store import MemoryJobStore, new_job_id, time_iso

HEAD = {"X-API-Key": "test-key"}


def make_settings(tmp_path, **kw):
    defaults = dict(backend="memory", default_pool="test",
                    api_keys=("test-key",), rate_limit_per_min=100,
                    upload_dir=str(tmp_path / "uploads"),
                    artifact_dir=str(tmp_path / "artifacts"),
                    encode_cache_dir=str(tmp_path / "cache"))
    defaults.update(kw)
    return Settings(**defaults)


def client_with(settings):
    store = MemoryJobStore()
    return TestClient(create_app(store, settings)), store


def fake_job(pool="default", priority="standard"):
    return {"job_id": new_job_id(), "idempotency_key": None, "pool": pool,
            "task": "t2v", "state": "queued", "prompt": "x", "num_frames": 345,
            "num_steps": 8, "seed": 1, "image_keys": [],
            "created_at": time_iso(), "priority": priority,
            "cancel_requested": False}


def _metric_value(body: str, name: str):
    for line in body.splitlines():
        if line.startswith(name + " "):
            return float(line.rsplit(" ", 1)[1])
    return None


def test_metrics_endpoint_gauges_queue(tmp_path):
    c, store = client_with(make_settings(tmp_path))
    before = _metric_value(c.get("/metrics").text, "vdn_jobs_created_total")
    c.post("/v1/video/t2v", json={"prompt": "p"}, headers=HEAD)
    body = c.get("/metrics").text
    after = _metric_value(body, "vdn_jobs_created_total")
    assert before is not None and after == before + 1   # the create counted
    assert _metric_value(body, 'vdn_queue_depth{pool="test"}') is not None


def test_priority_above_tier_cap_is_403(tmp_path):
    c, _ = client_with(make_settings(tmp_path))
    r = c.post("/v1/video/t2v", json={"prompt": "p", "priority": "high"},
               headers=HEAD)
    assert r.status_code == 403                     # default tier caps at standard
    ok = c.post("/v1/video/t2v", json={"prompt": "p", "priority": "low"},
                headers=HEAD)
    assert ok.status_code == 202                    # lower is always allowed


def test_bad_priority_and_webhook_url_422(tmp_path):
    c, _ = client_with(make_settings(tmp_path))
    assert c.post("/v1/video/t2v", json={"prompt": "p", "priority": "urgent"},
                  headers=HEAD).status_code == 422
    assert c.post("/v1/video/t2v", json={"prompt": "p", "webhook_url": "ftp://x"},
                  headers=HEAD).status_code == 422
    assert c.post("/v1/video/t2v",
                  json={"prompt": "p", "webhook_url": "https://cb/x"},
                  headers=HEAD).status_code == 202


def test_daily_quota_429(tmp_path):
    settings = make_settings(
        tmp_path,
        tenants=("test-key=basic",),
        tiers_json='{"basic": {"rpm": 100, "daily": 2, '
                   '"max_priority": "standard", "pools": ["default"]}}')
    c, _ = client_with(settings)
    codes = [c.post("/v1/video/t2v", json={"prompt": f"p{i}"},
                    headers=HEAD).status_code for i in range(4)]
    assert codes == [202, 202, 429, 429]


def test_premium_tier_routes_to_its_pool(tmp_path):
    settings = make_settings(
        tmp_path,
        tenants=("test-key=fast",),
        tiers_json='{"fast": {"rpm": 100, "daily": 100, "max_priority": "high", '
                   '"pools": ["b200"]}}')
    c, _ = client_with(settings)
    r = c.post("/v1/video/t2v", json={"prompt": "p", "priority": "high"},
               headers=HEAD)
    assert r.status_code == 202
    assert r.json()["pool"] == "b200" and r.json()["priority"] == "high"


def test_load_shedding_503_when_pool_saturated(tmp_path):
    settings = make_settings(tmp_path, max_queue_depth=5)
    c, store = client_with(settings)
    for _ in range(5):                              # saturate the tier pool
        job = fake_job(pool="test")
        store.create(job)
        store.enqueue(job["job_id"], "test", "standard")
    r = c.post("/v1/video/t2v", json={"prompt": "p"}, headers=HEAD)
    assert r.status_code == 503
    assert r.headers["Retry-After"] == "30"
