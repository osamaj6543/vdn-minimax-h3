"""Appwrite-backed auth: verify frontend JWTs, cache briefly, keep a user row.

The JWT (account.createJWT() on the client) is verified by GET /account with
X-Appwrite-JWT: 200 = live session. JWTs live 15 minutes; the cache here only
absorbs bursts (default TTL 60 s), never extends validity. Tier comes from
the user's Appwrite LABELS: the first label that names a configured tier wins,
otherwise the default tier. A users-table row is upserted best-effort so the
Appwrite console stays the system of record for users.
"""
import time
from typing import Dict, Optional

from .appwrite import AppwriteClient
from .principal import Principal


class AppwriteAuthBackend:
    def __init__(self, client: AppwriteClient, settings, registry):
        self.client = client
        self.registry = registry
        self.settings = settings
        self.ttl = settings.appwrite_auth_cache_ttl
        self._cache: Dict[str, tuple] = {}

    def verify(self, jwt: str) -> Principal:
        cached = self._cache.get(jwt)
        if cached and cached[1] > time.time():
            return cached[0]
        user = self.client.verify_jwt(jwt)
        tier = next((self.registry.tiers[label]
                     for label in user.labels if label in self.registry.tiers),
                    self.registry.default)
        principal = Principal(id=f"user:{user.id}", tier_name=tier.name,
                              source="appwrite", email=user.email,
                              name=user.name, labels=user.labels)
        self._cache[jwt] = (principal, time.time() + self.ttl)
        self._ensure_user_row(user.id, user.email, tier.name)
        return principal

    def _ensure_user_row(self, user_id: str, email: str, tier_name: str) -> None:
        try:
            self.client.upsert_row(
                self.settings.appwrite_db, self.settings.appwrite_users_table,
                user_id,
                {"appwrite_user_id": user_id, "email": email,
                 "tier": tier_name, "last_seen_at": _utc_now()},
                style=self.settings.appwrite_db_style)
        except Exception as exc:          # user bookkeeping never blocks auth
            print(f"[appwrite-auth] user row upsert failed: {exc}", flush=True)


def _utc_now() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def make_auth_backend(settings, registry) -> Optional[AppwriteAuthBackend]:
    """None when Appwrite auth is off or misconfigured (legacy keys still work)."""
    if not settings.appwrite_enabled:
        return None
    if not settings.appwrite_project or not settings.appwrite_key:
        print("[appwrite-auth] enabled but VDN_APPWRITE_PROJECT/"
              "VDN_APPWRITE_KEY missing; JWT auth disabled", flush=True)
        return None
    client = AppwriteClient(settings.appwrite_endpoint, settings.appwrite_project,
                            settings.appwrite_key)
    return AppwriteAuthBackend(client, settings, registry)
