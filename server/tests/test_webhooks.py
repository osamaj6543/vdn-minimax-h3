import hashlib
import hmac
import json
import threading
import time

from server.webhooks import WebhookDispatcher, sign_body


def run_dispatcher(dispatcher, wait=0.4):
    dispatcher.start()
    time.sleep(wait)


def test_delivers_signed_payload_once():
    received = []

    def fake_post(url, body, headers):
        received.append((url, json.loads(body), headers))

    d = WebhookDispatcher(secret="s3cret", post=fake_post)
    job = {"job_id": "j1", "task": "t2v", "state": "succeeded",
           "webhook_url": "http://cb.example/hook", "step_seconds": [1.0]}
    run_dispatcher(d)
    d.enqueue(job)
    time.sleep(0.4)
    assert len(received) == 1
    url, payload, headers = received[0]
    assert payload["event"] == "job.finished" and payload["job_id"] == "j1"
    expected = sign_body("s3cret", json.dumps(payload).encode())
    assert headers["X-VDN-Signature"] == expected


def test_retries_then_gives_up():
    attempts = []

    def failing_post(url, body, headers):
        attempts.append(1)
        raise RuntimeError("down")

    # one-shot dispatcher with fast backoff: patch sleep via tiny waits
    d = WebhookDispatcher(post=failing_post, attempts=3)
    import server.webhooks as w
    old_sleep = w.time.sleep
    w.time.sleep = lambda s: None                 # no real waiting in the test
    try:
        run_dispatcher(d)
        d.enqueue({"job_id": "j", "state": "failed", "webhook_url": "http://x/"})
        deadline = time.time() + 2
        while len(attempts) < 3 and time.time() < deadline:
            time.sleep(0.02)
        assert len(attempts) == 3                 # retried to the cap, then dropped
    finally:
        w.time.sleep = old_sleep
        d.stop()


def test_no_webhook_url_is_a_noop():
    d = WebhookDispatcher(post=lambda *a: 1 / 0)  # would explode if called
    run_dispatcher(d)
    d.enqueue({"job_id": "j", "state": "succeeded"})   # no webhook_url
    time.sleep(0.2)                                    # nothing delivered, nothing raised
    d.stop()


def test_sign_body_is_deterministic_hmac():
    body = b'{"a": 1}'
    assert sign_body("k", body) == sign_body("k", body)
    assert sign_body("k", body) == "sha256=" + hmac.new(
        b"k", body, hashlib.sha256).hexdigest()
