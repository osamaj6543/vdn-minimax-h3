"""Artifact storage: where a finished mp4 goes and how a client fetches it.

LocalStorage (default): files stay on the gateway host under
settings.artifact_dir; URLs are /v1/artifacts/{key} served auth-gated.
S3Storage (lazy boto3): uploads and returns a presigned GET URL.
AppwriteStorage (server/appwrite_store.py): uploads to a bucket; served
auth-gated through /v1/artifacts too.

The worker calls save(); the gateway serves /v1/artifacts. One instance per
process; both implementations are safe to share across threads for save().
"""
import os
import shutil
from pathlib import Path
from typing import Optional, Protocol


class Storage(Protocol):
    def save(self, local_path: str, key: str) -> str:
        """Persist the file under `key`; return a fetchable URL."""
    def local_path(self, key: str) -> Optional[str]:
        """Local file path when the artifact is on this host, else None."""
    def load(self, key: str) -> Optional[bytes]:
        """File bytes when this backend can serve them, else None."""


class LocalStorage:
    """Artifacts are already written into artifact_dir by the worker; save()
    just registers the key and returns its URL shape."""

    def __init__(self, artifact_dir: str):
        self.artifact_dir = Path(artifact_dir)

    def save(self, local_path: str, key: str) -> str:
        src, dst = Path(local_path), self.artifact_dir / Path(key).name
        dst.parent.mkdir(parents=True, exist_ok=True)
        if src.resolve() != dst.resolve():
            shutil.move(str(src), str(dst))       # same disk: atomic-ish rename
        return f"/v1/artifacts/{dst.name}"

    def local_path(self, key: str) -> Optional[str]:
        path = self.artifact_dir / Path(key).name
        return str(path) if path.is_file() else None

    def load(self, key: str) -> Optional[bytes]:
        path = self.artifact_dir / Path(key).name
        return path.read_bytes() if path.is_file() else None


class S3Storage:
    """save() uploads and returns a presigned GET URL (default 24 h)."""

    def __init__(self, bucket: str, prefix: str = "vdn-artifacts",
                 expires: int = 24 * 3600):
        import boto3                               # lazy: gateway runs without it

        self._s3 = boto3.client("s3")
        self.bucket = bucket
        self.prefix = prefix.strip("/")
        self.expires = expires

    def save(self, local_path: str, key: str) -> str:
        object_key = f"{self.prefix}/{Path(key).name}"
        extra = {"ContentType": "video/mp4"}
        self._s3.upload_file(local_path, self.bucket, object_key, ExtraArgs=extra)
        return self._s3.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": object_key},
            ExpiresIn=self.expires)

    def local_path(self, key: str) -> Optional[str]:
        return None


def make_storage(settings) -> Storage:
    scheme = os.environ.get("VDN_STORAGE", "local")
    if scheme == "s3":
        return S3Storage(bucket=os.environ["VDN_S3_BUCKET"],
                         prefix=os.environ.get("VDN_S3_PREFIX", "vdn-artifacts"))
    return LocalStorage(settings.artifact_dir)
