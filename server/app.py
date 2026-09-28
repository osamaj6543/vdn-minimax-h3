"""FastAPI wiring for the gateway, plus the uvicorn entrypoint.

    python -m server.app            # in-memory store (dev)
    VDN_BACKEND=redis VDN_REDIS_URL=redis://host:6379/0 python -m server.app
"""
import os
from typing import Optional

from fastapi import Depends, FastAPI, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response

from .gateway import Gateway
from .metrics import REGISTRY
from .schemas import (FL2VRequest, I2VRequest, JobView, L2VRequest,
                      Ref2VRequest, T2VRequest, UploadOut)
from .settings import Settings
from .storage import make_storage


def build_appwrite(settings: Settings):
    """(storage, uploads_mirror, job_sink) when Appwrite is fully configured;
    (None, None, None) otherwise - every Appwrite feature is additive."""
    if not settings.appwrite_enabled or not settings.appwrite_project \
            or not settings.appwrite_key:
        return None, None, None
    from .appwrite import AppwriteClient
    from .appwrite_store import AppwriteJobSink, AppwriteStorage, AppwriteUploads

    client = AppwriteClient(settings.appwrite_endpoint, settings.appwrite_project,
                            settings.appwrite_key)
    storage = (AppwriteStorage(client, settings.appwrite_artifacts_bucket)
               if settings.appwrite_artifacts_bucket else None)
    uploads = (AppwriteUploads(client, settings.appwrite_uploads_bucket)
               if settings.appwrite_uploads_bucket else None)
    sink = AppwriteJobSink(client, settings)
    return storage, uploads, sink


def create_app(store, settings, storage=None) -> FastAPI:
    appwrite_storage, uploads, job_sink = build_appwrite(settings)
    storage = storage or appwrite_storage or make_storage(settings)
    gw = Gateway(store, settings, job_sink=job_sink, uploads_client=uploads)
    app = FastAPI(title="VDN-H3 Inference Server", version="0.3.0")

    def caller(idempotency_key: Optional[str] = Header(default=None),
               api_key: str = Depends(gw.auth)):
        return idempotency_key, api_key

    def t2v(body: T2VRequest, c=Depends(caller)):
        return gw.t2v(body, *c)

    def i2v(body: I2VRequest, c=Depends(caller)):
        return gw.i2v(body, *c)

    def l2v(body: L2VRequest, c=Depends(caller)):
        return gw.l2v(body, *c)

    def fl2v(body: FL2VRequest, c=Depends(caller)):
        return gw.fl2v(body, *c)

    def ref2v(body: Ref2VRequest, c=Depends(caller)):
        return gw.ref2v(body, *c)

    def upload(file: UploadFile, api_key: str = Depends(gw.auth)):
        return gw.upload(file)

    def recent(limit: int = 50, api_key: str = Depends(gw.auth)):
        _ = api_key
        return gw.recent_jobs(limit)

    def get_job(job_id: str, api_key: str = Depends(gw.auth)):
        _ = api_key
        return gw.get_job(job_id)

    def cancel_job(job_id: str, api_key: str = Depends(gw.auth)):
        _ = api_key
        return gw.cancel_job(job_id)

    def metrics() -> Response:
        pools = {settings.default_pool}
        for tier in gw.registry.tiers.values():
            pools.update(gw.registry.pools_of(tier))
        for pool in pools:
            REGISTRY.gauge(f"vdn_queue_depth{{pool=\"{pool}\"}}",
                           store.queue_depth(pool), "jobs waiting, by pool")
        return Response(content=REGISTRY.render(), media_type="text/plain; charset=utf-8")

    def artifact(key: str, api_key=Depends(gw.auth)):
        _ = api_key
        path = storage.local_path(key)
        if path is not None:
            return FileResponse(path, media_type="video/mp4", filename=key)
        data = storage.load(key)
        if data is None:
            raise HTTPException(404, f"no artifact {key!r}")
        return Response(content=data, media_type="video/mp4")

    app.add_api_route("/healthz", lambda: {"ok": True}, methods=["GET"])
    app.add_api_route("/readyz", lambda: {"ready": True}, methods=["GET"])
    for path, fn in (("/v1/video/t2v", t2v), ("/v1/video/i2v", i2v),
                     ("/v1/video/l2v", l2v), ("/v1/video/fl2v", fl2v),
                     ("/v1/video/ref2v", ref2v)):
        app.add_api_route(path, fn, methods=["POST"], response_model=JobView,
                          status_code=202)
    app.add_api_route("/v1/uploads", upload, methods=["POST"],
                      response_model=UploadOut)
    app.add_api_route("/v1/jobs", recent, methods=["GET"])
    app.add_api_route("/v1/jobs/{job_id}", get_job, methods=["GET"],
                      response_model=JobView)
    app.add_api_route("/v1/jobs/{job_id}", cancel_job, methods=["DELETE"],
                      response_model=JobView)
    app.add_api_route("/metrics", metrics, methods=["GET"])
    app.add_api_route("/v1/artifacts/{key}", artifact, methods=["GET"])
    return app


def main() -> None:
    import uvicorn

    from .settings import Settings
    from .store import make_store

    settings = Settings()
    settings.validate()
    app = create_app(make_store(settings), settings)
    uvicorn.run(app, host="0.0.0.0", port=int(os.environ.get("VDN_PORT", "8000")))


if __name__ == "__main__":
    main()
