import pytest

from server.rate_limit import RateLimiter


def test_allows_up_to_limit_then_blocks():
    rl = RateLimiter(limit_per_min=3)
    keys = [rl.allow("k") for _ in range(5)]
    assert keys == [True, True, True, False, False]


def test_keys_are_isolated():
    rl = RateLimiter(limit_per_min=1)
    assert rl.allow("a") is True
    assert rl.allow("b") is True          # different key, own window
    assert rl.allow("a") is False


def test_window_rollover_via_time(monkeypatch):
    rl = RateLimiter(limit_per_min=1)
    assert rl.allow("k") is True
    assert rl.allow("k") is False
    original_window = rl._window
    monkeypatch.setattr(rl, "_window", lambda: original_window() + 1)
    assert rl.allow("k") is True          # new minute, fresh budget


def test_redis_path(monkeypatch):
    """The Redis branch must behave like the local one (uses a fake client)."""
    class FakeRedis:
        def __init__(self):
            self.counts = {}
            self.expired = []
        def incr(self, cell):
            self.counts[cell] = self.counts.get(cell, 0) + 1
            return self.counts[cell]
        def expire(self, cell, ttl):
            self.expired.append((cell, ttl))

    fake = FakeRedis()
    rl = RateLimiter(limit_per_min=2, redis_client=fake)
    assert [rl.allow("k") for _ in range(3)] == [True, True, False]
    assert fake.expired and fake.expired[0][1] == 120
