import pytest

from server.appwrite import AppwriteClient
from server.appwrite_auth import AppwriteAuthBackend
from server.settings import Settings
from server.store import PRIORITIES


class FakeHTTP:
    def __init__(self, account_status=200):
        self.account_calls = 0
        self.rows = []
        self.account_status = account_status

    def __call__(self, method, url, headers, body):
        if "/account" in url:
            self.account_calls += 1
            if self.account_status != 200:
                return self.account_status, b'{"message": "expired"}'
            import json
            return 200, json.dumps(
                {"$id": "user-1", "email": "u@x.io", "name": "User One",
                 "labels": ["premium"]}).encode()
        if "/tables/" in url:
            self.rows.append({"method": method, "url": url,
                              "body": body.decode() if body else ""})
            return 201, b'{"$id": "row"}'
        return 200, b"{}"


def make_backend(http=None, **settings_kw):
    if http is None:
        http = FakeHTTP()
    settings = Settings(
        appwrite_enabled=True, appwrite_project="proj", appwrite_key="key",
        tenants=("dev-key=premium",),
        tiers_json='{"premium": {"rpm": 10, "daily": 10, '
                   '"max_priority": "high", "pools": ["b200"]}}', **settings_kw)
    from server.tenants import TenantRegistry
    client = AppwriteClient(settings.appwrite_endpoint, "proj", "key", http=http)
    return AppwriteAuthBackend(client, settings, TenantRegistry(settings)), http, settings


def test_verify_maps_labels_to_tier():
    backend, http, _ = make_backend()
    principal = backend.verify("tok")
    assert principal.id == "user:user-1"
    assert principal.tier_name == "premium"
    assert principal.source == "appwrite"
    assert principal.email == "u@x.io"


def test_verify_is_cached_within_ttl():
    backend, http, _ = make_backend()
    backend.verify("tok")
    backend.verify("tok")
    assert http.account_calls == 1              # one round-trip, two auths
    assert backend.verify("other").id == "user:user-1"
    assert http.account_calls == 2              # different token -> fresh verify


def test_invalid_jwt_raises():
    backend, http, _ = make_backend(http=FakeHTTP(account_status=401))
    with pytest.raises(Exception):
        backend.verify("dead-token")


def test_user_row_upserted_best_effort():
    backend, http, _ = make_backend()
    backend.verify("tok")
    row_calls = [r for r in http.rows if "/users" in r["url"]]
    assert row_calls and "user-1" in row_calls[-1]["url"]
    # a failing sink must not break auth
    def broken(*a, **kw):
        raise RuntimeError("db down")
    backend.client.upsert_row = broken
    assert backend.verify("tok2").id == "user:user-1"


def test_priority_ceiling_ranks():
    rank = {p: i for i, p in enumerate(PRIORITIES)}
    assert rank["high"] < rank["standard"]
