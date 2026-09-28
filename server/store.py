"""Job store: one interface, two backends.

- RedisJobStore: production. Jobs are JSON hashes; each pool has a FIFO list
  and a "processing" zset scored by claim/heartbeat time, so a worker that
  dies mid-render leaves a stale entry another worker (or its own restart)
  can reclaim.
- MemoryJobStore: dev and tests. Same semantics under a lock; state is lost
  on process exit.

Only the worker claims; the gateway creates, enqueues, reads and cancels.

Phase 2: each pool has PRIORITY LANES (high > standard > low), claimed in that
order, and reports `queue_depth(pool)` for load shedding and metrics.
"""
import json
import itertools
import threading
import time
import uuid
from abc import ABC, abstractmethod
from collections import deque
from typing import Dict, List, Optional

_SEQ = itertools.count(1)          # process-local monotonic creation order
PRIORITIES = ("high", "standard", "low")   # claim order; lanes, not a knob soup


class JobNotFound(KeyError):
    pass


def new_job_id() -> str:
    return uuid.uuid4().hex


class JobStore(ABC):
    @abstractmethod
    def create(self, record: Dict) -> Dict:
        """Store a new job. record must carry job_id, idempotency_key, state."""

    @abstractmethod
    def get(self, job_id: str) -> Optional[Dict]:
        ...

    @abstractmethod
    def update(self, job_id: str, **fields) -> None:
        ...

    @abstractmethod
    def enqueue(self, job_id: str, pool: str, priority: str = "standard") -> None:
        ...

    @abstractmethod
    def claim(self, pool: str) -> Optional[Dict]:
        """Atomically pop the next QUEUED job (high priority lanes first) and
        mark it running."""

    @abstractmethod
    def queue_depth(self, pool: str) -> int:
        """Queued (not yet claimed) jobs in the pool, all lanes."""

    @abstractmethod
    def heartbeat(self, job_id: str, pool: str) -> None:
        ...

    @abstractmethod
    def release(self, job_id: str, pool: str) -> None:
        ...

    @abstractmethod
    def reclaim_stale(self, pool: str, older_than_s: int) -> List[str]:
        """Requeue running jobs whose last heartbeat is older than the cutoff."""

    @abstractmethod
    def recent(self, pool: str, limit: int = 50) -> List[Dict]:
        ...

    def cancel(self, job_id: str) -> Optional[Dict]:
        """Cooperative cancel (Phase 1): queued -> cancelled now; running ->
        cancel_requested, honoured when the render returns. Returns the job."""
        job = self.get(job_id)
        if job is None:
            raise JobNotFound(job_id)
        if job["state"] == "queued":
            self.update(job_id, state="cancelled", finished_at=time_iso())
        elif job["state"] == "running":
            self.update(job_id, cancel_requested=True)
        return self.get(job_id)


def time_iso() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


class MemoryJobStore(JobStore):
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: Dict[str, Dict] = {}
        self._queues: Dict[str, deque] = {}
        self._processing: Dict[str, Dict[str, float]] = {}

    def create(self, record):
        with self._lock:
            for job in self._jobs.values():
                if (record.get("idempotency_key")
                        and job["state"] != "cancelled"
                        and job.get("idempotency_key") == record["idempotency_key"]):
                    return job
            stored = dict(record)
            stored["seq"] = next(_SEQ)          # stable "newest first" ordering
            self._jobs[record["job_id"]] = stored
            return dict(stored)

    def get(self, job_id):
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None

    def update(self, job_id, **fields):
        with self._lock:
            if job_id not in self._jobs:
                raise JobNotFound(job_id)
            self._jobs[job_id].update(fields)

    def enqueue(self, job_id, pool, priority="standard"):
        with self._lock:
            lane = self._queues.setdefault((pool, priority), deque())
            lane.append(job_id)

    def claim(self, pool):
        with self._lock:
            for priority in PRIORITIES:            # high lanes drain first
                queue = self._queues.get((pool, priority))
                while queue:
                    job_id = queue.popleft()
                    job = self._jobs.get(job_id)
                    if job is None or job["state"] != "queued":
                        continue          # cancelled while queued
                    job["state"] = "running"
                    job["started_at"] = time_iso()
                    self._processing.setdefault(pool, {})[job_id] = time.time()
                    return dict(job)
            return None

    def queue_depth(self, pool):
        with self._lock:
            return sum(len(self._queues.get((pool, p), ())) for p in PRIORITIES)

    def heartbeat(self, job_id, pool):
        with self._lock:
            self._processing.setdefault(pool, {})[job_id] = time.time()

    def release(self, job_id, pool):
        with self._lock:
            self._processing.get(pool, {}).pop(job_id, None)

    def reclaim_stale(self, pool, older_than_s):
        cutoff = time.time() - older_than_s
        requeued = []
        with self._lock:
            processing = self._processing.get(pool, {})
            for job_id in [j for j, t in processing.items() if t < cutoff]:
                job = self._jobs.get(job_id)
                processing.pop(job_id, None)
                if job and job["state"] == "running":
                    job["state"] = "queued"
                    job["started_at"] = None
                    lane = self._queues.setdefault((pool, job.get("priority", "standard")), deque())
                    lane.append(job_id)
                    requeued.append(job_id)
        return requeued

    def recent(self, pool, limit=50):
        with self._lock:
            jobs = [j for j in self._jobs.values()
                    if j.get("pool") == pool or pool == "*"]
            jobs.sort(key=lambda j: j.get("seq", 0), reverse=True)
            return [dict(j) for j in jobs[:limit]]


REDIS_PREFIX = "vdn"


class RedisJobStore(JobStore):
    def __init__(self, url: str):
        import redis  # lazy: the gateway is importable without redis-py

        self._r = redis.Redis.from_url(url, decode_responses=True)

    def _job_key(self, job_id: str) -> str:
        return f"{REDIS_PREFIX}:job:{job_id}"

    def _queue_key(self, pool: str, priority: str = "standard") -> str:
        return f"{REDIS_PREFIX}:queue:{pool}:{priority}"

    def _proc_key(self, pool: str) -> str:
        return f"{REDIS_PREFIX}:processing:{pool}"

    def create(self, record):
        if record.get("idempotency_key"):
            idem = f"{REDIS_PREFIX}:idem:{record['idempotency_key']}"
            existing = self._r.get(idem)
            if existing:
                return json.loads(self._r.get(self._job_key(existing)))
        stored = dict(record)
        stored["seq"] = self._r.incr(f"{REDIS_PREFIX}:seq")   # stable ordering
        self._r.set(self._job_key(record["job_id"]), json.dumps(stored))
        if record.get("idempotency_key"):
            self._r.set(f"{REDIS_PREFIX}:idem:{record['idempotency_key']}",
                        record["job_id"])
        return stored

    def get(self, job_id):
        raw = self._r.get(self._job_key(job_id))
        return json.loads(raw) if raw else None

    def update(self, job_id, **fields):
        raw = self._r.get(self._job_key(job_id))
        if raw is None:
            raise JobNotFound(job_id)
        job = json.loads(raw)
        job.update(fields)
        self._r.set(self._job_key(job_id), json.dumps(job))

    def enqueue(self, job_id, pool, priority="standard"):
        self._r.rpush(self._queue_key(pool, priority), job_id)

    def claim(self, pool):
        """RPOP across the priority lanes (high first) until a QUEUED job is
        found (cancelled-while-queued entries are skipped). Mark running +
        record the claim time atomically."""
        for priority in PRIORITIES:
            while True:
                job_id = self._r.rpop(self._queue_key(pool, priority))
                if job_id is None:
                    break
                raw = self._r.get(self._job_key(job_id))
                if raw is None:
                    continue
                job = json.loads(raw)
                if job["state"] != "queued":
                    continue
                job["state"] = "running"
                job["started_at"] = time_iso()
                pipe = self._r.pipeline()
                pipe.set(self._job_key(job_id), json.dumps(job))
                pipe.zadd(self._proc_key(pool), {job_id: time.time()})
                pipe.execute()
                return job
        return None

    def queue_depth(self, pool):
        return sum(self._r.llen(self._queue_key(pool, p)) for p in PRIORITIES)

    def heartbeat(self, job_id, pool):
        self._r.zadd(self._proc_key(pool), {job_id: time.time()})

    def release(self, job_id, pool):
        self._r.zrem(self._proc_key(pool), job_id)

    def reclaim_stale(self, pool, older_than_s):
        cutoff = time.time() - older_than_s
        stale = self._r.zrangebyscore(self._proc_key(pool), "-inf", cutoff)
        requeued = []
        for job_id in stale:
            raw = self._r.get(self._job_key(job_id))
            self._r.zrem(self._proc_key(pool), job_id)
            if raw is None:
                continue
            job = json.loads(raw)
            if job["state"] == "running":
                job["state"] = "queued"
                job["started_at"] = None
                self._r.set(self._job_key(job_id), json.dumps(job))
                self._r.rpush(self._queue_key(pool, job.get("priority", "standard")), job_id)
                requeued.append(job_id)
        return requeued

    def recent(self, pool, limit=50):
        out = []
        seen = set()
        for priority in PRIORITIES:                 # queued first (lane order)
            for job_id in self._r.lrange(self._queue_key(pool, priority), 0, -1):
                raw = self._r.get(self._job_key(job_id))
                if raw:
                    out.append(json.loads(raw))
                    seen.add(job_id)
        # running/finished jobs live only in the keyspace; scan them too
        for key in self._r.scan_iter(f"{REDIS_PREFIX}:job:*", count=500):
            job_id = key.split(":", 2)[2]
            if job_id in seen:
                continue
            raw = self._r.get(key)
            if raw and json.loads(raw).get("pool") == pool:
                out.append(json.loads(raw))
        out.sort(key=lambda j: j.get("seq", 0), reverse=True)
        return out[:limit]


def make_store(settings) -> JobStore:
    if settings.backend == "redis":
        return RedisJobStore(settings.redis_url)
    return MemoryJobStore()
