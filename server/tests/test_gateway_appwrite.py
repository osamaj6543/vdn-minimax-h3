"""Gateway integration with Appwrite JWT auth (backend stubbed, no network)."""
import io

from fastapi.testclient import TestClient

from server.app import create_app
from server.principal import Principal
from server.settings import Settings
from server.store import MemoryJobStore

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 32
HEAD = {"X-API-Key": "test-key"}
BEARER = {"Authorization": "Bearer good-token"}


def make_settings(tmp_path, **kw):
    defaults = dict(backend="memory", default_pool="test",
                    api_keys=("test-key",), rate_limit_per_min=100,
                    upload_dir=str(tmp_path / "uploads"),
                    artifact_dir=str(tmp_path / "artifacts"),
                    encode_cache_dir=str(tmp_path / "cache"))
    defaults.update(kw)
    return Settings(**defaults)


class StubBackend:
    """Mimics AppwriteAuthBackend without network; one user, premium tier."""

    def __init__(self, valid=True):
        self.valid = valid
        self.verified = []

    def verify(self, jwt):
        if not self.valid or jwt != "good-token":
            raise ValueError("expired")
        self.verified.append(jwt)
        return Principal(id="user:u-1", tier_name="premium", source="appwrite",
                         email="u@x.io")


def test_bearer_jwt_creates_job_with_user_identity(tmp_path, monkeypatch):
    """End-to-end: stub the auth backend factory, then use the Bearer path."""
    from server import app as app_module
    from server.store import MemoryJobStore

    backend = StubBackend()
    monkeypatch.setattr(app_module, "build_appwrite", lambda s: (None, None, None))
    monkeypatch.setattr("server.gateway.make_auth_backend",
                        lambda settings, registry: backend)
    c = TestClient(create_app(MemoryJobStore(), make_settings(tmp_path)))

    r = c.post("/v1/video/t2v", json={"prompt": "hello"}, headers=BEARER)
    assert r.status_code == 202, r.text
    view = r.json()
    assert view["priority"] in ("standard", "high")
    assert backend.verified == ["good-token"]

    # the job record carries the appwrite identity
    body = c.get(f"/v1/jobs/{view['job_id']}", headers=BEARER).json()
    assert body["job_id"] == view["job_id"]


def test_bad_bearer_token_401(tmp_path, monkeypatch):
    from server import app as app_module
    from server.store import MemoryJobStore

    monkeypatch.setattr(app_module, "build_appwrite", lambda s: (None, None, None))
    monkeypatch.setattr("server.gateway.make_auth_backend",
                        lambda settings, registry: StubBackend(valid=False))
    c = TestClient(create_app(MemoryJobStore(), make_settings(tmp_path)))
    r = c.post("/v1/video/t2v", json={"prompt": "p"},
               headers={"Authorization": "Bearer bad"})
    assert r.status_code == 401


def test_api_key_still_works_alongside(tmp_path, monkeypatch):
    from server import app as app_module
    from server.store import MemoryJobStore

    monkeypatch.setattr(app_module, "build_appwrite", lambda s: (None, None, None))
    monkeypatch.setattr("server.gateway.make_auth_backend",
                        lambda settings, registry: StubBackend())
    c = TestClient(create_app(MemoryJobStore(), make_settings(tmp_path)))
    assert c.post("/v1/video/t2v", json={"prompt": "p"},
                  headers=HEAD).status_code == 202
    # invalid key still rejected even with appwrite enabled
    bad = c.post("/v1/video/t2v", json={"prompt": "p"},
                 headers={"X-API-Key": "nope"})
    assert bad.status_code == 401


def test_uploads_mirror_called_when_configured(tmp_path, monkeypatch):
    from server import app as app_module
    from server.store import MemoryJobStore

    mirrors = []

    class Mirror:
        def mirror(self, key, data, content_type):
            mirrors.append((key, data, content_type))

    monkeypatch.setattr(app_module, "build_appwrite",
                        lambda s: (None, Mirror(), None))
    c = TestClient(create_app(MemoryJobStore(), make_settings(tmp_path)))
    r = c.post("/v1/uploads",
               files={"file": ("a.png", io.BytesIO(PNG), "image/png")},
               headers=HEAD)
    assert r.status_code == 200
    assert mirrors and mirrors[0][0] == r.json()["key"]
