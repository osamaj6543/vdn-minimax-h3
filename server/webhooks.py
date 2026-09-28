"""Webhook delivery with retries and HMAC signing.

The worker enqueues a delivery on every terminal job state; a daemon thread
POSTs JSON with exponential backoff (1 s, 2 s, 4 s, ... capped; N attempts).
Payloads are signed so a receiver can verify authenticity:

    X-VDN-Signature: sha256=<hex hmac-sha256(webhook_secret, body)>

Set VDN_WEBHOOK_SECRET to enable signing (recommended for production).
Delivery is best-effort: after the final attempt the payload is dropped and
the failure is logged — the job result itself is never affected.
"""
import hashlib
import hmac
import json
import queue
import threading
import time
import urllib.error
import urllib.request

MAX_ATTEMPTS = 5
BACKOFF_CAP = 30.0


class WebhookDispatcher:
    def __init__(self, secret: str = "", attempts: int = MAX_ATTEMPTS,
                 post=None):
        self.secret = secret.encode() if secret else b""
        self.attempts = attempts
        self._post = post or self._post_once
        self._queue: "queue.Queue[dict]" = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    # ---------------- producer (worker side) ----------------

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._drain, daemon=True,
                                            name="webhooks")
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()

    def enqueue(self, job: dict) -> None:
        url = job.get("webhook_url")
        if not url:
            return
        payload = {
            "event": "job.finished",
            "job_id": job["job_id"],
            "task": job.get("task"),
            "state": job["state"],
            "error": job.get("error"),
            "artifact_url": job.get("artifact_url"),
            "num_frames": job.get("num_frames"),
            "num_steps": job.get("num_steps"),
            "seed": job.get("seed"),
            "step_seconds": job.get("step_seconds", []),
            "created_at": job.get("created_at"),
            "finished_at": job.get("finished_at"),
        }
        self._queue.put({"url": url, "payload": payload})

    # ---------------- consumer ----------------

    def _drain(self) -> None:
        while not self._stop.is_set():
            try:
                item = self._queue.get(timeout=0.5)
            except queue.Empty:
                continue
            body = json.dumps(item["payload"]).encode()
            headers = {"Content-Type": "application/json"}
            if self.secret:
                digest = hmac.new(self.secret, body, hashlib.sha256).hexdigest()
                headers["X-VDN-Signature"] = f"sha256={digest}"
            delay = 1.0
            for attempt in range(1, self.attempts + 1):
                try:
                    self._post(item["url"], body, headers)
                    break
                except Exception as exc:
                    if attempt == self.attempts:
                        print(f"[webhooks] giving up on {item['url']} after "
                              f"{self.attempts} attempts: {exc}", flush=True)
                        break
                    time.sleep(delay)
                    delay = min(delay * 2, BACKOFF_CAP)

    @staticmethod
    def _post_once(url: str, body: bytes, headers: dict) -> None:
        request = urllib.request.Request(url, data=body, headers=headers,
                                         method="POST")
        with urllib.request.urlopen(request, timeout=10) as response:
            if response.status >= 300:
                raise RuntimeError(f"webhook returned {response.status}")


def sign_body(secret: str, body: bytes) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
