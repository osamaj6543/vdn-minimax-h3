"""SGLang lane: an engine adapter over SGLang Diffusion's OpenAI Videos API.

Verified against sglang's multimodal_gen entrypoints (2026-09-28):

    POST /v1/videos              multipart form: prompt, model, seconds, size,
                                 num_frames, num_inference_steps, seed,
                                 input_reference (image file; repeat for fl2v).
                                 ASYNC: returns {id, status=queued, ...} immediately.
    GET  /v1/videos/{id}         poll: status queued -> in_progress -> completed|failed
    GET  /v1/videos/{id}/content the finished mp4 (unless cloud storage returned
                                 a `url`, in which case fetch that instead)
    DELETE /v1/videos/{id}       removes the record (their code has NO abort:
                                 'TODO: support aborting a job')

Only t2v/i2v/l2v/fl2v are supported by SGLang for VDN-H3 (README); ref2v
raises. The adapter is synchronous from the worker's perspective: submit,
poll, download, return a RenderResult. Transport is injectable for tests.
"""
import json
import time
import uuid
from pathlib import Path

from .engine import RenderResult
from .schemas import Task

_TERMINAL = ("completed", "failed")
_KNOWN = _TERMINAL + ("queued", "in_progress")


class SglangEngine:
    def __init__(self, settings):
        self.settings = settings
        self.base = settings.sglang_url.rstrip("/")
        self.model = settings.sglang_model
        self.api_key = settings.sglang_api_key
        self.poll_seconds = settings.sglang_poll_seconds
        self.timeout_s = settings.sglang_timeout_s
        # injectable transport
        self._post = self._post_multipart
        self._get_json = self._get_json_impl
        self._get_bytes = self._get_bytes_impl

    def _headers(self):
        headers = {}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    def _post_multipart(self, fields: dict, files: dict) -> dict:
        """Minimal multipart/form-data POST returning parsed JSON."""
        import urllib.request

        boundary = uuid.uuid4().hex
        body = b""
        for name, value in fields.items():
            if value is None:
                continue
            body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                     f"name=\"{name}\"\r\n\r\n{value}\r\n").encode()
        for name, (filename, data, content_type) in files.items():
            body += (f"--{boundary}\r\nContent-Disposition: form-data; "
                     f"name=\"{name}\"; filename=\"{filename}\"\r\n"
                     f"Content-Type: {content_type}\r\n\r\n").encode()
            body += data + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        request = urllib.request.Request(
            f"{self.base}/v1/videos", data=body, method="POST",
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}",
                     **self._headers()})
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.loads(response.read())

    def _get_json_impl(self, path: str) -> dict:
        import urllib.request

        request = urllib.request.Request(f"{self.base}{path}",
                                         headers=self._headers())
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read())

    def _get_bytes_impl(self, path_or_url: str) -> bytes:
        import urllib.request

        url = path_or_url if path_or_url.startswith("http") \
            else f"{self.base}{path_or_url}"
        request = urllib.request.Request(url, headers=self._headers())
        with urllib.request.urlopen(request, timeout=300) as response:
            return response.read()

    def warmup(self) -> None:
        """Nothing to compile in-process: the SGLang server owns the GPUs and
        was warmed with --warmup-num-frames 345 at launch (README)."""
        self._get_json("/models")            # fail fast if the lane is unreachable

    def render(self, task: Task, prompt: str, image_paths, num_frames: int,
               num_steps: int, seed: int, video_shift: float, audio_shift: float,
               out_path: str) -> RenderResult:
        if task is Task.ref2v:
            raise ValueError("SGLang lane does not support ref2v; "
                             "use a repo-stack pool")
        fields = {"prompt": prompt, "model": self.model,
                  "num_frames": str(num_frames),
                  "num_inference_steps": str(num_steps), "seed": str(seed)}
        files = {f"input_reference_{i}": (Path(p).name, open(p, "rb").read(),
                                          "image/png")
                 for i, p in enumerate(image_paths or [])}
        response = self._post(fields, files)
        video_id = response["id"]

        deadline = time.monotonic() + self.timeout_s
        while True:
            job = self._get_json(f"/v1/videos/{video_id}")
            status = job.get("status")
            if status not in _KNOWN:
                raise RuntimeError(f"unknown SGLang status {status!r}")
            if status == "failed":
                raise RuntimeError(f"SGLang job {video_id} failed: "
                                   f"{job.get('error')}")
            if status == "completed":
                break
            if time.monotonic() > deadline:
                raise RuntimeError(f"SGLang job {video_id} timed out after "
                                   f"{self.timeout_s}s")
            time.sleep(self.poll_seconds)

        data_path = job.get("url") or f"/v1/videos/{video_id}/content"
        payload = self._get_bytes(data_path)
        Path(out_path).parent.mkdir(parents=True, exist_ok=True)
        Path(out_path).write_bytes(payload)
        return RenderResult(artifact_path=out_path,
                            step_seconds=[float(job.get("total_time", 0.0))])
