import io

import pytest
from fastapi.testclient import TestClient

from server.app import create_app
from server.settings import Settings
from server.store import MemoryJobStore

PNG = (b"\x89PNG\r\n\x1a\n" + b"0" * 32)     # 8-byte magic + payload
HEAD = {"X-API-Key": "test-key"}


def make_settings(tmp_path, api_keys=("test-key",), limit=100):
    return Settings(
        backend="memory", default_pool="test",
        api_keys=tuple(api_keys), rate_limit_per_min=limit,
        upload_dir=str(tmp_path / "uploads"),
        artifact_dir=str(tmp_path / "artifacts"),
        encode_cache_dir=str(tmp_path / "cache"),
    )


@pytest.fixture()
def client(tmp_path):
    settings = make_settings(tmp_path)
    store = MemoryJobStore()
    return TestClient(create_app(store, settings)), store


def test_health(client):
    c, _ = client
    assert c.get("/healthz").json() == {"ok": True}


def test_auth_required(client):
    c, _ = client
    assert c.get("/v1/jobs/x").status_code == 401
    assert c.post("/v1/video/t2v", json={"prompt": "p"}).status_code == 401
    bad = dict(HEAD, **{"X-API-Key": "wrong"})
    assert c.post("/v1/video/t2v", json={"prompt": "p"}, headers=bad).status_code == 401


def test_t2v_create_returns_202_queued(client):
    c, _ = client
    r = c.post("/v1/video/t2v", json={"prompt": "a cat", "num_steps": 8},
               headers=HEAD)
    assert r.status_code == 202
    view = r.json()
    assert view["state"] == "queued" and view["task"] == "t2v"
    assert view["num_frames"] == 345 and view["num_steps"] == 8


def test_num_frames_snaps_up_to_17n5(client):
    c, _ = client
    r = c.post("/v1/video/t2v", json={"prompt": "p", "num_frames": 300},
               headers=HEAD)
    assert r.json()["num_frames"] == 311          # 17*18+5, the first >= 300


def test_idempotency_header_dedupes(client):
    c, _ = client
    body = {"prompt": "p"}
    h = dict(HEAD, **{"Idempotency-Key": "same-1"})
    r1 = c.post("/v1/video/t2v", json=body, headers=h)
    r2 = c.post("/v1/video/t2v", json=body, headers=h)
    assert r1.json()["job_id"] == r2.json()["job_id"]
    other = c.post("/v1/video/t2v", json=body, headers=HEAD)
    assert other.json()["job_id"] != r1.json()["job_id"]


def test_upload_then_image_endpoints(tmp_path):
    settings = make_settings(tmp_path)
    c = TestClient(create_app(MemoryJobStore(), settings))
    up = c.post("/v1/uploads", files={"file": ("a.png", io.BytesIO(PNG), "image/png")},
                headers=HEAD)
    assert up.status_code == 200, up.text
    key = up.json()["key"]

    r = c.post("/v1/video/i2v", json={"prompt": "p", "first_image": key}, headers=HEAD)
    assert r.status_code == 202 and r.json()["image_keys"] == [key]

    r = c.post("/v1/video/i2v", json={"prompt": "p", "first_image": "bogus"},
               headers=HEAD)
    assert r.status_code == 400

    r = c.post("/v1/video/fl2v",
               json={"prompt": "p", "first_image": key, "last_image": key},
               headers=HEAD)
    assert r.status_code == 202

    r = c.post("/v1/video/ref2v",
               json={"prompt": "p", "images": [key, key, key]}, headers=HEAD)
    assert r.status_code == 202 and len(r.json()["image_keys"]) == 3


def test_upload_rejects_bad_type_and_size(tmp_path):
    settings = make_settings(tmp_path)
    c = TestClient(create_app(MemoryJobStore(), settings))
    r = c.post("/v1/uploads", files={"file": ("a.txt", io.BytesIO(b"hello"), "text/plain")},
               headers=HEAD)
    assert r.status_code == 415
    r = c.post("/v1/uploads",
               files={"file": ("a.png", io.BytesIO(b"x"), "image/png")}, headers=HEAD)
    assert r.status_code == 422


def test_rate_limit_429(tmp_path):
    settings = make_settings(tmp_path, limit=2)
    c = TestClient(create_app(MemoryJobStore(), settings))
    codes = [c.post("/v1/video/t2v", json={"prompt": f"p{i}"},
                    headers=HEAD).status_code for i in range(3)]
    assert codes == [202, 202, 429]


def test_get_and_cancel(client):
    c, store = client
    job_id = c.post("/v1/video/t2v", json={"prompt": "p"}, headers=HEAD).json()["job_id"]
    assert c.get(f"/v1/jobs/{job_id}", headers=HEAD).json()["state"] == "queued"
    assert c.get("/v1/jobs/nope", headers=HEAD).status_code == 404
    r = c.delete(f"/v1/jobs/{job_id}", headers=HEAD)
    assert r.json()["state"] == "cancelled"
    # a cancelled job must not render: the worker's claim skips it
    assert store.claim("test") is None


def test_recent_lists_jobs(client):
    c, _ = client
    for i in range(2):
        c.post("/v1/video/t2v", json={"prompt": f"p{i}"}, headers=HEAD)
    r = c.get("/v1/jobs", headers=HEAD)
    assert r.status_code == 200 and len(r.json()["jobs"]) == 2
