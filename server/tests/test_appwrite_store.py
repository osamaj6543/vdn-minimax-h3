from server.appwrite import AppwriteClient
from server.appwrite_store import AppwriteJobSink, AppwriteStorage, AppwriteUploads
from server.settings import Settings


class RecordingHTTP:
    def __init__(self):
        self.calls = []

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "body": body})
        return 201, b'{"$id": "x"}'


def make_settings(**kw):
    return Settings(appwrite_enabled=True, appwrite_project="proj",
                    appwrite_key="key", appwrite_db="vdn",
                    **kw)


def test_storage_save_uploads_and_returns_gateway_url(tmp_path):
    src = tmp_path / "video.mp4"
    src.write_bytes(b"MP4DATA")
    http = RecordingHTTP()
    storage = AppwriteStorage(AppwriteClient("https://x/v1", "p", "k", http=http),
                              "artifacts")
    url = storage.save(str(src), "job-1.mp4")
    assert url == "/v1/artifacts/job-1.mp4"
    assert "/storage/buckets/artifacts/files" in http.calls[0]["url"]
    assert b"MP4DATA" in http.calls[0]["body"]
    assert storage.local_path("job-1.mp4") is None


def test_storage_load_downloads(tmp_path):
    http = RecordingHTTP()
    storage = AppwriteStorage(AppwriteClient("https://x/v1", "p", "k", http=http),
                              "artifacts")
    def raw(method, url, headers, body):
        http.calls.append({"url": url})
        return 200, b"BYTES"
    storage.client._http = raw
    assert storage.load("job-1.mp4") == b"BYTES"
    assert "/download" in http.calls[0]["url"]


def test_uploads_mirror_posts_to_bucket(tmp_path):
    http = RecordingHTTP()
    uploads = AppwriteUploads(AppwriteClient("https://x/v1", "p", "k", http=http),
                              "uploads")
    uploads.mirror("abc.png", b"PNG", "image/png")
    assert "/storage/buckets/uploads/files" in http.calls[0]["url"]


def test_job_sink_upserts_flat_record():
    http = RecordingHTTP()
    sink = AppwriteJobSink(AppwriteClient("https://x/v1", "p", "k", http=http),
                           make_settings())
    job = {"job_id": "j1", "pool": "b200", "priority": "high", "task": "t2v",
           "state": "queued", "prompt": "p", "num_frames": 345,
           "step_seconds": [1.0, 2.0], "image_keys": ["a.png"],
           "user_id": "user:user-1", "cancel_requested": False,
           "idempotency_key": None, "seq": 7}
    sink.record(job)
    call = http.calls[0]
    assert "/v1/tablesdb/vdn/tables/jobs/rows/j1" in call["url"]
    assert call["method"] == "PATCH"
    data = __import__("json").loads(call["body"])["data"]
    assert data["user_id"] == "user:user-1" and data["state"] == "queued"
    assert "idempotency_key" not in data and "seq" not in data
