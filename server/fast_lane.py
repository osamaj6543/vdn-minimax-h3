"""The 8-GPU fast lane: node-exclusive Ulysses renders via torchrun.

Run on a node RESERVED for it (no per-GPU workers there - the whole node is
the job's, per plan doc R-05):

    VDN_BACKEND=redis VDN_REDIS_URL=redis://host:6379/0 python -m server.fast_lane

Per job:
  1. claim from the fast-lane pool (default `node8`)
  2. node lock (stale-aware; a lock from a dead run is reclaimed)
  3. encode the prompt via the repo's encode_* CLIs on cuda:0
     (content-hash cached by the CLI's own output; a repeat prompt still pays
     the encode unless the cache path is kept per request hash)
  4. torchrun --standalone --nproc_per_node=N src/inference/infer_ulysses.py
     with the GPU's tuned config yaml (B200 -> decomposed, H200 -> flex)
  5. save the artifact through the storage layer, fire webhooks, update metrics

The lane reloads the model per job - that is the documented cost of the lane
(plan doc 2.3 #7: eight ranks reading 66 GB each); it buys ~6.9 s denoising on
8xB200 instead of ~51 s on one. The GPU probe and both runners are injectable
for tests; `--engine fake` exercises the whole loop without torchrun.
"""
import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path

from .metrics import REGISTRY
from .schemas import Task, utc_now_iso
from .storage import make_storage
from .store import JobStore, make_store
from .webhooks import WebhookDispatcher

REPO_ROOT = Path(__file__).resolve().parent.parent


class NodeLock:
    """Exclusive, stale-aware node lock (O_CREAT|O_EXCL lockfile)."""

    def __init__(self, path: str, stale_seconds: int = 3600):
        self.path = Path(path)
        self.stale_seconds = stale_seconds
        self._held = False

    def acquire(self) -> bool:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists():
            age = time.time() - self.path.stat().st_mtime
            if age < self.stale_seconds:
                return False
            self.path.unlink(missing_ok=True)      # stale: previous run died
        try:
            fd = os.open(self.path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.write(fd, f"{os.getpid()} {time.time()}".encode())
            os.close(fd)
            self._held = True
            return True
        except FileExistsError:
            return False

    def release(self) -> None:
        if self._held:
            self.path.unlink(missing_ok=True)
            self._held = False

    def __enter__(self):
        return self.acquire()

    def __exit__(self, *_exc):
        self.release()


def default_probe(nproc: int) -> bool:
    """True when every GPU shows ~0% util and little used memory."""
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10, check=True)
    except Exception:
        return False
    rows = [line.strip() for line in out.stdout.splitlines() if line.strip()]
    if len(rows) < nproc:
        return False
    for row in rows[:nproc]:
        util, mem = (int(part.strip().split()[0]) for part in row.split(","))
        if util > 5 or mem > 2000:                 # MiB: desktop + driver residue
            return False
    return True


def gpu_name(probe_name=None) -> str:
    if probe_name:
        return probe_name
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=name", "--format=csv,noheader"],
            capture_output=True, text=True, timeout=10, check=True)
        return out.stdout.splitlines()[0].strip()
    except Exception:
        return "unknown"


class FastLane:
    def __init__(self, store: JobStore, settings, runner=None, probe=None,
                 encoder_runner=None, webhooks: WebhookDispatcher | None = None):
        self.store = store
        self.settings = settings
        self.pool = settings.fast_lane_pool
        self.nproc = settings.fast_lane_nproc
        self.configs = json.loads(settings.fast_lane_configs)
        self.lock = NodeLock(str(Path(settings.lock_dir) / "fast_lane.lock"))
        self.storage = make_storage(settings)
        self.webhooks = webhooks
        self._runner = runner or self._default_runner
        self._encoder_runner = encoder_runner or self._default_runner
        self._stop = False

    def _default_runner(self, cmd, job_id):
        print(f"[fast-lane] running: {cmd[0]} ... ({job_id})", flush=True)
        return subprocess.run(cmd, cwd=str(REPO_ROOT), check=True)

    # ---------------- command builders ----------------

    def config_for(self, job_id: str) -> str:
        name = gpu_name()
        for needle, yaml in self.configs.items():
            if needle.lower() in name.lower():
                return yaml
        raise RuntimeError(f"no tuned Ulysses config for GPU {name!r}; "
                           f"set VDN_FAST_LANE_CONFIGS")

    def _anchor_flags(self, task: Task) -> tuple:
        return {Task.i2v: ("--first",), Task.l2v: ("--last",),
                Task.fl2v: ("--first", "--last")}.get(task, ())

    def encoder_cmd(self, job: dict, cache_path: str) -> list:
        image_paths = [str(Path(self.settings.upload_dir) / Path(k).name)
                       for k in job.get("image_keys", [])]
        if not image_paths:
            return [sys.executable, "src/inference/encode_prompt.py",
                    "--prompt", job["prompt"], "--out", cache_path,
                    "--device", "cuda:0"]
        task = Task(job["task"])
        cmd = [sys.executable, "src/inference/encode_keyframes.py",
               "--prompt", job["prompt"], "--out", cache_path]
        if task is Task.ref2v:
            return cmd + ["--refs", *image_paths]
        for flag, path in zip(self._anchor_flags(task), image_paths):
            cmd += [flag, path]
        return cmd

    def torchrun_cmd(self, job: dict, cache_path: str, out_path: str) -> list:
        cmd = ["torchrun", "--standalone",
               f"--nproc_per_node={self.nproc}",
               "src/inference/infer_ulysses.py",
               f"--config={self.config_for(job['job_id'])}",
               f"checkpoint={self.settings.checkpoint}"]
        if self.settings.base_source:
            cmd.append(f"base_source={self.settings.base_source}")
        cmd += [f"render.prompt_file={cache_path}",
                f"render.out={out_path}",
                f"render.num_frames={job['num_frames']}",
                f"render.num_steps={job['num_steps']}",
                f"render.seed={job['seed']}",
                f"render.video_shift={job.get('video_shift', 12.0)}",
                f"render.audio_shift={job.get('audio_shift', 3.0)}",
                "render.warmup_steps=2"]
        return cmd

    # ---------------- job execution ----------------

    def run_one(self, job: dict) -> None:
        job_id = job["job_id"]
        started = time.monotonic()
        out_path = str(Path(self.settings.artifact_dir) / f"{job_id}.mp4")
        cache_path = str(Path(self.settings.encode_cache_dir)
                         / f"fastlane_{job_id}.pt")
        try:
            self._encoder_runner(self.encoder_cmd(job, cache_path), job_id)
            self._runner(self.torchrun_cmd(job, cache_path, out_path), job_id)
            artifact_url = self.storage.save(out_path, f"{job_id}.mp4")
            self.store.update(job_id, state="succeeded",
                              artifact_url=artifact_url,
                              finished_at=utc_now_iso())
            REGISTRY.observe("vdn_fastlane_seconds", time.monotonic() - started)
        except Exception as exc:
            print(f"[fast-lane] job {job_id} failed: {exc}", flush=True)
            REGISTRY.inc("vdn_jobs_failed_total", 1.0)
            self.store.update(job_id, state="failed", error=str(exc)[:2000],
                              finished_at=utc_now_iso())
        finally:
            if self.webhooks is not None:
                self.webhooks.enqueue(self.store.get(job_id))
            self.store.release(job_id, self.pool)

    def serve_forever(self) -> None:
        print(f"[fast-lane] pool={self.pool} nproc={self.nproc}", flush=True)
        while not self._stop:
            job = self.store.claim(self.pool)
            if job is None:
                time.sleep(1.0)
                continue
            if not self.lock.acquire():
                # another lane on this node holds it: put the job back
                self.store.update(job["job_id"], state="queued",
                                  started_at=None)
                self.store.enqueue(job["job_id"], self.pool,
                                   job.get("priority", "standard"))
                self.store.release(job["job_id"], self.pool)
                time.sleep(2.0)
                continue
            try:
                self.run_one(job)
            finally:
                self.lock.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="VDN-H3 8-GPU fast lane")
    parser.add_argument("--engine", choices=["real", "fake"], default="real",
                        help="'fake' skips torchrun/encode (dev/tests)")
    args = parser.parse_args()

    from .settings import Settings

    settings = Settings()
    settings.validate()
    webhooks = WebhookDispatcher(secret=settings.webhook_secret)
    webhooks.start()
    if args.engine == "fake":
        lane = FastLane(make_store(settings), settings,
                        runner=lambda cmd, job_id: None,
                        encoder_runner=lambda cmd, job_id: None,
                        webhooks=webhooks)
    else:
        lane = FastLane(make_store(settings), settings, webhooks=webhooks)
    lane.serve_forever()


if __name__ == "__main__":
    main()
