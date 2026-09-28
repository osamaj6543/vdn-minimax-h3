"""Appwrite-backed storage and durable job records.

AppwriteStorage: artifacts go to a bucket via the server API key; the client
URL stays our auth-gated GET /v1/artifacts/{key} (the endpoint streams from
Appwrite), so permission policy lives in exactly one place.

AppwriteUploads: mirrors gateway uploads into a bucket so the frontend can
also list/manage images through Appwrite's own SDK/permissions; the worker
still reads the local copy.

AppwriteJobSink: best-effort durable copies of job records (creates + terminal
updates) into a tables/collections row keyed by job_id. The Redis store stays
the live queue truth; Appwrite is the history the frontend queries.
"""
from pathlib import Path

from .appwrite import AppwriteClient
from .storage import Storage


class AppwriteStorage(Storage):
    def __init__(self, client: AppwriteClient, bucket: str):
        self.client = client
        self.bucket = bucket

    def save(self, local_path: str, key: str) -> str:
        name = Path(key).name
        data = Path(local_path).read_bytes()
        self.client.create_file(self.bucket, name, name, data, "video/mp4")
        return f"/v1/artifacts/{name}"

    def local_path(self, key: str) -> str | None:
        return None

    def load(self, key: str) -> bytes | None:
        try:
            return self.client.file_download_bytes(self.bucket, Path(key).name)
        except Exception as exc:
            status = getattr(exc, "status", None)
            if status == 404:
                return None
            raise


class AppwriteUploads:
    """Mirror of gateway uploads into an Appwrite bucket (best-effort)."""

    def __init__(self, client: AppwriteClient, bucket: str):
        self.client = client
        self.bucket = bucket

    def mirror(self, key: str, data: bytes, content_type: str) -> None:
        self.client.create_file(self.bucket, Path(key).name, Path(key).name,
                                data, content_type)


class AppwriteJobSink:
    def __init__(self, client: AppwriteClient, settings):
        self.client = client
        self.settings = settings

    def record(self, job: dict) -> None:
        """Only JSON-primitive fields travel (strings, numbers, bools, and the
        string/number lists Appwrite rows accept)."""
        data = {k: v for k, v in job.items()
                if not k.startswith("$") and k not in ("idempotency_key", "seq")
                and isinstance(v, (str, int, float, bool, list, type(None)))}
        self.client.upsert_row(self.settings.appwrite_db,
                               self.settings.appwrite_jobs_table,
                               job["job_id"], data,
                               style=self.settings.appwrite_db_style)
