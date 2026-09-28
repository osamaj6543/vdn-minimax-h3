import json

import pytest

from server.appwrite import AppwriteClient, AppwriteError


class FakeHTTP:
    """Records calls; routes by (method, path-contains)."""

    def __init__(self):
        self.calls = []
        self.routes = {}            # (method, substring) -> (status, obj)

    def add(self, method, substring, status, obj):
        self.routes[(method, substring)] = (status, obj)

    def __call__(self, method, url, headers, body):
        self.calls.append({"method": method, "url": url, "headers": headers,
                           "body": body})
        for (m, sub), (status, obj) in self.routes.items():
            if m == method and sub in url:
                return status, json.dumps(obj).encode()
        return 200, b"{}"


def make_client(http=None):
    http = http or FakeHTTP()
    client = AppwriteClient("https://cloud.appwrite.io/v1", "proj", "key",
                            http=http)
    return client, http


ACCOUNT = {"$id": "user-1", "email": "u@x.io", "name": "User One",
           "labels": ["premium"]}


def test_verify_jwt_sends_jwt_header_and_parses_account():
    client, http = make_client()
    http.add("GET", "/account", 200, ACCOUNT)
    user = client.verify_jwt("tok-123")
    assert user.id == "user-1" and user.labels == ["premium"]
    sent = http.calls[0]
    assert sent["headers"]["X-Appwrite-JWT"] == "tok-123"
    assert sent["headers"]["X-Appwrite-Project"] == "proj"
    # the API key must NOT ride along a JWT request: it would take over auth
    assert "X-Appwrite-Key" not in sent["headers"]


def test_verify_jwt_401_raises():
    client, http = make_client()
    http.add("GET", "/account", 401, {"message": "expired"})
    with pytest.raises(AppwriteError) as exc_info:
        client.verify_jwt("dead")
    assert exc_info.value.status == 401


def test_tablesdb_row_paths_and_payload():
    client, http = make_client()
    http.add("POST", "/tablesdb", 201, {"$id": "job-1"})
    client.create_row("vdn", "jobs", "job-1", {"state": "queued"})
    method, url, headers, body = (http.calls[0][k] for k in
                                  ("method", "url", "headers", "body"))
    assert method == "POST"
    assert url.endswith("/v1/tablesdb/vdn/tables/jobs/rows")
    payload = json.loads(body)
    assert payload["rowId"] == "job-1" and payload["data"]["state"] == "queued"


def test_legacy_documents_style():
    client, http = make_client()
    http.add("POST", "/databases", 201, {"$id": "doc-1"})
    client.create_row("vdn", "jobs", "doc-1", {"a": 1}, style="documents")
    payload = json.loads(http.calls[0]["body"])
    assert "/v1/databases/vdn/collections/jobs/documents" in http.calls[0]["url"]
    assert payload["documentId"] == "doc-1"


def test_upsert_updates_then_creates_on_404():
    client, http = make_client()
    http.add("PATCH", "/rows/job-9", 404, {"message": "not found"})
    http.add("POST", "/rows", 201, {"$id": "job-9"})
    client.upsert_row("vdn", "jobs", "job-9", {"state": "running"})
    methods = [c["method"] for c in http.calls]
    assert methods == ["PATCH", "POST"]


def test_get_row_404_is_none():
    client, http = make_client()
    http.add("GET", "/rows/nope", 404, {"message": "not found"})
    assert client.get_row("vdn", "jobs", "nope") is None


def test_create_file_is_multipart_with_fields():
    client, http = make_client()
    http.add("POST", "/storage/buckets", 201, {"$id": "f1"})
    client.create_file("artifacts", "a.mp4", "a.mp4", b"MP4", "video/mp4")
    sent = http.calls[0]
    assert "/v1/storage/buckets/artifacts/files" in sent["url"]
    body = sent["body"].decode()
    assert 'name="fileId"' in body and "a.mp4" in body
    assert 'name="file"' in body and b"MP4".decode() in body


def test_file_download_bytes():
    client, http = make_client()
    http.add("GET", "/download", 200, {})       # body ignored; raw wins
    def raw_http(method, url, headers, body):
        http.calls.append({"url": url, "method": method})
        return 200, b"MP4BYTES"
    client._http = raw_http
    assert client.file_download_bytes("artifacts", "a.mp4") == b"MP4BYTES"
    assert "/files/a.mp4/download" in http.calls[0]["url"]
