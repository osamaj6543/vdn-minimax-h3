"""Fixed-window per-key rate limiter. Redis when a store is shared across
gateway replicas; a process-local counter otherwise (single gateway, tests).
"""
import threading
import time
from typing import Dict, Tuple


class RateLimiter:
    def __init__(self, limit_per_min: int, redis_client=None):
        self.limit = limit_per_min
        self._redis = redis_client
        self._local: Dict[Tuple[str, int], int] = {}
        self._lock = threading.Lock()

    def _window(self) -> int:
        return int(time.time() // 60)

    def allow(self, key: str) -> bool:
        """True if `key` still has budget in the current minute window."""
        window = self._window()
        if self._redis is not None:
            cell = f"vdn:rl:{key}:{window}"
            count = self._redis.incr(cell)
            if count == 1:
                self._redis.expire(cell, 120)
            return count <= self.limit
        with self._lock:
            count = self._local.get((key, window), 0) + 1
            self._local[(key, window)] = count
            # opportunistic GC of old windows
            if len(self._local) > 10_000:
                self._local = {k: v for k, v in self._local.items()
                               if k[1] >= window}
            return count <= self.limit
