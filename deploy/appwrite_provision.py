"""One-shot Appwrite provisioning for the VDN server.

Idempotent: existing resources (409) are skipped, so re-running is safe.

    export VDN_APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
    export VDN_APPWRITE_PROJECT=<project-id>
    export VDN_APPWRITE_KEY=<api-key with tables.*, files.* scopes>
    python deploy/appwrite_provision.py

Creates (matching exactly what server/appwrite_store.py and
server/appwrite_auth.py write):
  database `vdn`
  table `jobs`  - one row per job, row id = job_id
  table `users` - one row per Appwrite user, row id = user id
  bucket `artifacts` - rendered mp4s (private; served via the gateway)
  bucket `uploads`   - mirrored client images (png/jpeg/webp)

Column creation tries the 1.7 TablesDB paths (/columns/...) and falls back to
the legacy attribute paths (/attributes/...) for <=1.6 servers; column status
is polled until available before rows are written.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

ENDPOINT = os.environ.get("VDN_APPWRITE_ENDPOINT", "https://cloud.appwrite.io/v1").rstrip("/")
PROJECT = os.environ.get("VDN_APPWRITE_PROJECT", "")
KEY = os.environ.get("VDN_APPWRITE_KEY", "")
DB = os.environ.get("VDN_APPWRITE_DB", "vdn")
JOBS = os.environ.get("VDN_APPWRITE_JOBS_TABLE", "jobs")
USERS = os.environ.get("VDN_APPWRITE_USERS_TABLE", "users")
STYLE = os.environ.get("VDN_APPWRITE_DB_STYLE", "tablesdb")   # tablesdb | documents

if not PROJECT or not KEY:
    sys.exit("Set VDN_APPWRITE_PROJECT and VDN_APPWRITE_KEY first.")


def call(method: str, path: str, payload: dict | None = None):
    request = urllib.request.Request(
        f"{ENDPOINT}{path}", method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={"X-Appwrite-Project": PROJECT, "X-Appwrite-Key": KEY,
                 "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as exc:
        return exc.code, json.loads(exc.read() or b"{}")


def ensure(method: str, path: str, payload: dict | None, what: str):
    status, body = call(method, path, payload)
    if status in (200, 201):
        print(f"  created  {what}")
    elif status == 409:
        print(f"  exists   {what}")
    else:
        print(f"  SKIP     {what} -> {status}: {json.dumps(body)[:200]}")
    return status


def column_paths(base: str, kind: str):
    if STYLE == "documents":
        return [f"{base}/attributes/{kind}"]
    return [f"{base}/columns/{kind}", f"{base}/attributes/{kind}"]


def create_column(table_base: str, kind: str, payload: dict, label: str):
    last = None
    for path in column_paths(table_base, kind):
        status, body = call("POST", path, payload)
        if status in (200, 201):
            print(f"  column   {label}")
            return payload["key"]
        if status == 409:
            print(f"  exists   {label}")
            return payload["key"]
        last = (status, body)
        if status != 404:
            break
    print(f"  SKIP     {label} -> {last[0]}: {json.dumps(last[1])[:160]}")
    return None


def wait_available(table_base: str, keys: list):
    pending = list(keys)
    for _ in range(120):
        still = []
        for key in pending:
            for path in (f"{table_base}/columns/{key}", f"{table_base}/attributes/{key}"):
                status, body = call("GET", path)
                if status == 200:
                    if body.get("status") != "available":
                        still.append(key)
                    break
            else:
                still.append(key)
        if not still:
            return
        pending = still
        time.sleep(1.0)
    print(f"  WARNING  still not available: {pending}")


def main() -> None:
    print(f"Appwrite {ENDPOINT} project={PROJECT}")

    # database
    db_path = "/tablesdb" if STYLE != "documents" else "/databases"
    ensure("POST", db_path, {"databaseId": DB, "name": "VDN"}, f"database {DB}")

    # tables + row-API bases
    if STYLE == "documents":
        ensure("POST", f"/databases/{DB}/collections",
               {"collectionId": JOBS, "name": "Jobs"}, f"table {JOBS}")
        ensure("POST", f"/databases/{DB}/collections",
               {"collectionId": USERS, "name": "Users"}, f"table {USERS}")
        jobs_base = f"/databases/{DB}/collections/{JOBS}"
        users_base = f"/databases/{DB}/collections/{USERS}"
    else:
        ensure("POST", f"/tablesdb/{DB}/tables",
               {"tableId": JOBS, "name": "Jobs"}, f"table {JOBS}")
        ensure("POST", f"/tablesdb/{DB}/tables",
               {"tableId": USERS, "name": "Users"}, f"table {USERS}")
        jobs_base = f"/tablesdb/{DB}/tables/{JOBS}"
        users_base = f"/tablesdb/{DB}/tables/{USERS}"

    print(f"columns for {JOBS}:")
    jobs_cols = [
        ("string", {"key": "pool", "size": 64}),
        ("string", {"key": "priority", "size": 16}),
        ("string", {"key": "task", "size": 16}),
        ("string", {"key": "state", "size": 16}),
        ("string", {"key": "prompt", "size": 8000}),
        ("integer", {"key": "num_frames"}),
        ("integer", {"key": "num_steps"}),
        ("integer", {"key": "seed"}),
        ("double", {"key": "video_shift"}),
        ("double", {"key": "audio_shift"}),
        ("string", {"key": "image_keys", "size": 64, "array": True}),
        ("string", {"key": "webhook_url", "size": 2048}),
        ("string", {"key": "user_id", "size": 128}),
        ("string", {"key": "auth_source", "size": 16}),
        ("string", {"key": "created_at", "size": 32}),
        ("string", {"key": "started_at", "size": 32}),
        ("string", {"key": "finished_at", "size": 32}),
        ("boolean", {"key": "cancel_requested"}),
        ("string", {"key": "error", "size": 2000}),
        ("string", {"key": "artifact_url", "size": 512}),
        ("double", {"key": "step_seconds", "array": True}),
    ]
    created = []
    for kind, payload in jobs_cols:
        payload = {"required": False, **payload}
        key = create_column(jobs_base, kind, payload, payload["key"])
        if key:
            created.append(key)
    wait_available(jobs_base, created)

    print(f"columns for {USERS}:")
    created = []
    for kind, payload in [
        ("string", {"key": "appwrite_user_id", "size": 64}),
        ("string", {"key": "email", "size": 256}),
        ("string", {"key": "tier", "size": 32}),
        ("string", {"key": "last_seen_at", "size": 32}),
    ]:
        payload = {"required": False, **payload}
        key = create_column(users_base, kind, payload, payload["key"])
        if key:
            created.append(key)
    wait_available(users_base, created)

    # buckets (private: the gateway serves artifacts auth-gated)
    for bucket_id, name, max_mb, extensions in (
        ("artifacts", "VDN rendered videos", 300, ["mp4"]),
        ("uploads", "VDN input images", 20, ["png", "jpg", "jpeg", "webp"]),
    ):
        ensure("POST", "/storage/buckets",
               {"bucketId": bucket_id, "name": name, "permissions": [],
                "fileSecurity": False, "enabled": True,
                "maximumFileSize": max_mb * 1024 * 1024,
                "allowedFileExtensions": extensions},
               f"bucket {bucket_id}")

    print("\nDone. Server env (see server/README.md):")
    print(f"  VDN_APPWRITE_ENABLED=1 VDN_APPWRITE_PROJECT={PROJECT} "
          f"VDN_APPWRITE_KEY=*** VDN_APPWRITE_DB={DB} "
          f"VDN_APPWRITE_ARTIFACTS_BUCKET=artifacts "
          f"VDN_APPWRITE_UPLOADS_BUCKET=uploads")


if __name__ == "__main__":
    main()
