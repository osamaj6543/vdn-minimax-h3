"""Thin Appwrite REST client - plain urllib, injectable transport.

Verified against Appwrite 1.7 server REST (2026-09-28):
  headers     X-Appwrite-Project, X-Appwrite-Key (server), X-Appwrite-JWT
              (JWT acts as a session; account.createJWT() tokens expire in
              15 minutes or when their session dies)
  tables      POST   /v1/tablesdb/{db}/tables/{table}/rows            create
              PATCH  /v1/tablesdb/{db}/tables/{table}/rows/{id}      update
              GET    /v1/tablesdb/{db}/tables/{table}/rows/{id}      read
              (legacy style: /v1/databases/{db}/collections/{c}/documents)
  storage     POST   /v1/storage/buckets/{bucket}/files (multipart: fileId,
              file, permissions) / GET .../files/{id} / .../files/{id}/download
  auth        GET    /v1/account with X-Appwrite-JWT -> 200 = valid JWT, the
              account body carries $id, email, name, labels

No official SDK dependency: the surface used here is small and the transport
is injectable, so every behavior is unit-testable offline.
"""
import json
import uuid
from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass(frozen=True)
class AppwriteUser:
    id: str
    email: str
    name: str
    labels: List[str]


class AppwriteError(RuntimeError):
    def __init__(self, status: int, message: str):
        super().__init__(f"appwrite {status}: {message}")
        self.status = status


class AppwriteClient:
    def __init__(self, endpoint: str, project: str, key: str, http=None):
        self.endpoint = endpoint.rstrip("/")
        self.project = project
        self.key = key
        self._http = http or self._http_impl      # (method, url, headers, body) -> (status, bytes)

    @staticmethod
    def _http_impl(method: str, url: str, headers: Dict[str, str],
                   body: Optional[bytes]) -> tuple:
        import urllib.error
        import urllib.request

        request = urllib.request.Request(url, data=body, headers=headers,
                                         method=method)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    def _request(self, method: str, path: str, payload=None,
                 jwt: Optional[str] = None) -> Dict[str, Any]:
        url = f"{self.endpoint}{path}"
        headers = {
            "X-Appwrite-Project": self.project,
            "Content-Type": "application/json",
            "X-Appwrite-Response-Format": "1.7.0",
        }
        if jwt:
            # NEVER send the API key alongside a JWT: the key would take over
            # authentication and /account would stop identifying the user.
            headers["X-Appwrite-JWT"] = jwt
        else:
            headers["X-Appwrite-Key"] = self.key
        body = json.dumps(payload).encode() if payload is not None else None
        status, raw = self._http(method, url, headers, body)
        if status >= 300:
            raise AppwriteError(status, raw.decode(errors="replace")[:500])
        return json.loads(raw) if raw else {}

    def verify_jwt(self, jwt: str) -> AppwriteUser:
        """200 from GET /account under X-Appwrite-JWT = the JWT is live."""
        account = self._request("GET", "/account", jwt=jwt)
        return AppwriteUser(id=account.get("$id", ""),
                            email=account.get("email", ""),
                            name=account.get("name", ""),
                            labels=list(account.get("labels", [])))

    def _rows_base(self, db: str, table: str, style: str) -> str:
        if style == "documents":
            return f"/databases/{db}/collections/{table}/documents"
        return f"/tablesdb/{db}/tables/{table}/rows"

    def create_row(self, db: str, table: str, row_id: str, data: Dict,
                   permissions: Optional[List[str]] = None,
                   style: str = "tablesdb") -> Dict:
        id_key = "documentId" if style == "documents" else "rowId"
        payload: Dict[str, Any] = {id_key: row_id, "data": data}
        if permissions:
            payload["permissions"] = permissions
        return self._request("POST", self._rows_base(db, table, style), payload)

    def update_row(self, db: str, table: str, row_id: str, data: Dict,
                   style: str = "tablesdb") -> Dict:
        return self._request("PATCH",
                             f"{self._rows_base(db, table, style)}/{row_id}",
                             {"data": data})

    def get_row(self, db: str, table: str, row_id: str,
                style: str = "tablesdb") -> Optional[Dict]:
        try:
            return self._request("GET",
                                 f"{self._rows_base(db, table, style)}/{row_id}")
        except AppwriteError as exc:
            if exc.status == 404:
                return None
            raise

    def upsert_row(self, db: str, table: str, row_id: str, data: Dict,
                   style: str = "tablesdb") -> Dict:
        try:
            return self.update_row(db, table, row_id, data, style)
        except AppwriteError as exc:
            if exc.status != 404:
                raise
            return self.create_row(db, table, row_id, data, style=style)

    # ---------------- storage ----------------

    def create_file(self, bucket: str, file_id: str, filename: str,
                    data: bytes, content_type: str,
                    permissions: Optional[List[str]] = None) -> Dict:
        """POST /storage/buckets/{bucket}/files as multipart/form-data."""
        import urllib.request

        boundary = uuid.uuid4().hex
        body = b""
        fields = {"fileId": file_id}
        if permissions:
            fields["permissions"] = json.dumps(permissions)
        for name, value in fields.items():
            body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                     f"name=\"{name}\"\r\n\r\n{value}\r\n").encode()
        body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                 f"name=\"file\"; filename=\"{filename}\"\r\n"
                 f"Content-Type: {content_type}\r\n\r\n").encode()
        body += data + b"\r\n"
        body += f"--{boundary}--\r\n".encode()

        url = f"{self.endpoint}/storage/buckets/{bucket}/files"
        headers = {"X-Appwrite-Project": self.project, "X-Appwrite-Key": self.key,
                   "Content-Type": f"multipart/form-data; boundary={boundary}",
                   "X-Appwrite-Response-Format": "1.7.0"}
        status, raw = self._http("POST", url, headers, body)
        if status >= 300:
            raise AppwriteError(status, raw.decode(errors="replace")[:500])
        return json.loads(raw)

    def file_download_bytes(self, bucket: str, file_id: str) -> bytes:
        status, raw = self._http(
            "GET",
            f"{self.endpoint}/storage/buckets/{bucket}/files/{file_id}/download",
            {"X-Appwrite-Project": self.project, "X-Appwrite-Key": self.key},
            None)
        if status >= 300:
            raise AppwriteError(status, raw.decode(errors="replace")[:500])
        return raw

    def file_meta(self, bucket: str, file_id: str) -> Optional[Dict]:
        try:
            return self._request("GET",
                                 f"/storage/buckets/{bucket}/files/{file_id}")
        except AppwriteError as exc:
            if exc.status == 404:
                return None
            raise
