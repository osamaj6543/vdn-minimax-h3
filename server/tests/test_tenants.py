import pytest

from server.settings import Settings
from server.store import PRIORITIES
from server.tenants import DailyQuota, TenantRegistry


def make_settings(tenants=(), tiers_json=""):
    return Settings(backend="memory", tenants=tuple(tenants),
                    tiers_json=tiers_json)


def test_default_tier_when_no_tenants():
    reg = TenantRegistry(make_settings())
    tenant = reg.resolve("any-key")
    assert tenant.tier.name == "default"
    assert tenant.tier.max_priority == "standard"


def test_tenant_key_maps_to_tier():
    s = make_settings(tenants=["vip=premium"],
                      tiers_json='{"default": {"rpm": 1, "daily": 1, '
                                 '"max_priority": "standard", "pools": ["default"]}, '
                                 '"premium": {"rpm": 9, "daily": 9, '
                                 '"max_priority": "high", "pools": ["b200"]}}')
    reg = TenantRegistry(s)
    assert reg.resolve("vip").tier.pools == ["b200"]
    assert reg.resolve("other").tier.name == "default"


def test_unknown_tier_in_tenants_raises():
    with pytest.raises(ValueError, match="unknown tier"):
        TenantRegistry(make_settings(tenants=["k=nope"]))


def test_invalid_max_priority_raises():
    with pytest.raises(ValueError, match="max_priority"):
        TenantRegistry(make_settings(tiers_json='{"t": {"rpm": 1, "daily": 1, '
                                   '"max_priority": "urgent", "pools": ["p"]}}'))


def test_priority_ceiling_order():
    """high < standard < low in rank terms: high is the most privileged."""
    rank = {p: i for i, p in enumerate(PRIORITIES)}
    assert rank["high"] < rank["standard"] < rank["low"]


def test_quota_counts_per_key_and_resets_by_day():
    quota = DailyQuota()
    assert [quota.spent_and_allow("a", 2) for _ in range(3)] == \
        [True, True, False]
    assert quota.spent_and_allow("b", 2) is True     # other key unaffected
