"""Tenants: API keys map to a TIER; a tier carries a rate limit, a daily job
quota, an allowed priority ceiling, and the pools its jobs may target.

Configuration (both optional; defaults give every key the "default" tier):

    VDN_TENANTS=key-abc=premium,key-xyz=default
    VDN_TIERS={"default": {"rpm": 30, "daily": 200, "max_priority": "standard",
                            "pools": ["default"]},
               "premium": {"rpm": 120, "daily": 2000, "max_priority": "high",
                           "pools": ["b200", "h200", "default"]}}
"""
import json
import os
from dataclasses import dataclass, field
from typing import Dict, List

from .store import PRIORITIES

DEFAULT_TIERS = {
    "default": {"rpm": 30, "daily": 200, "max_priority": "standard",
                "pools": ["@default"]},   # resolved to settings.default_pool
}
DEFAULT_POOL_TOKEN = "@default"


@dataclass(frozen=True)
class Tier:
    name: str
    rpm: int
    daily: int
    max_priority: str
    pools: List[str]


@dataclass(frozen=True)
class Tenant:
    key: str
    tier: Tier


def _parse_tiers(raw: str) -> Dict[str, Tier]:
    """Provided tiers EXTEND/override the built-in defaults, so a custom table
    need not redefine "default"."""
    raw = raw or os.environ.get("VDN_TIERS", "")
    spec = dict(DEFAULT_TIERS)
    if raw.strip():
        spec.update(json.loads(raw))
    out = {}
    for name, t in spec.items():
        max_priority = t.get("max_priority", "standard")
        if max_priority not in PRIORITIES:
            raise ValueError(f"tier {name!r}: max_priority {max_priority!r} "
                             f"not in {PRIORITIES}")
        out[name] = Tier(name=name, rpm=int(t["rpm"]), daily=int(t["daily"]),
                         max_priority=max_priority, pools=list(t["pools"]))
    return out


class TenantRegistry:
    def __init__(self, settings):
        self.tiers = _parse_tiers(getattr(settings, "tiers_json", "") or "")
        self._default_pool = settings.default_pool
        default_name = os.environ.get("VDN_DEFAULT_TIER", "default")
        self.default = self.tiers[default_name]
        # VDN_TENANTS="key=tier,key2=tier"; unparsed keys fall back to default
        self.by_key: Dict[str, Tier] = {}
        for pair in getattr(settings, "tenants", ()):
            key, _, tier_name = pair.partition("=")
            if tier_name not in self.tiers:
                raise ValueError(f"tenant key {key[:4]}... names unknown tier "
                                 f"{tier_name!r}; have {sorted(self.tiers)}")
            self.by_key[key] = self.tiers[tier_name]

    def resolve(self, api_key: str) -> Tenant:
        return Tenant(api_key, self.by_key.get(api_key, self.default))

    def pools_of(self, tier: Tier) -> List[str]:
        """The tier's pools with the @default placeholder resolved."""
        return [self._default_pool if p == DEFAULT_POOL_TOKEN else p
                for p in tier.pools]


class DailyQuota:
    """Jobs per key per UTC day. Redis INCR with expiry at midnight when a
    client is given; in-process otherwise (single gateway)."""

    def __init__(self, redis_client=None):
        self._redis = redis_client
        self._local: Dict[str, tuple] = {}

    def _cell(self, key: str, day: str) -> str:
        return f"vdn:quota:{key}:{day}"

    def spent_and_allow(self, key: str, daily: int) -> bool:
        import datetime

        day = datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d")
        if self._redis is not None:
            cell = self._cell(key, day)
            spent = self._redis.incr(cell)
            if spent == 1:
                self._redis.expire(cell, 90000)     # ~25 h: covers the day's end
            return spent <= daily
        spent, current = self._local.get(key, (0, None))
        if current != day:
            spent, current = 0, day
        spent += 1
        self._local[key] = (spent, current)
        return spent <= daily
