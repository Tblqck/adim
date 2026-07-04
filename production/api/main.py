"""
KYC Verification — FastAPI entry point.

Serves the production/web/ static frontend AND /api/v1/ JSON endpoints.

Run locally:
    uvicorn production.api.main:app --reload --port 5000

On Render (via Procfile):
    uvicorn production.api.main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

from production.database import db
from production.api.routers import verify, capture, admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
)

# Correct MIME types for MediaPipe WASM assets
mimetypes.add_type("application/wasm",         ".wasm")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("text/javascript",          ".mjs")

_WEB_DIR = Path(__file__).resolve().parents[1] / "web"


# ── Lifespan: connect DB and warm ONNX models on startup ─────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # DB
    await db.connect()

    # Warm ONNX models in background so first request isn't slow
    import asyncio
    loop = asyncio.get_event_loop()

    def _warm():
        from production.core.biometrics import _load_det, _load_embed
        from production.core.liveness   import _load_model as _load_live
        from production.core.alignment  import _load_model as _load_align
        from production.core.ocr        import _init as _init_ocr
        _load_det();  _load_embed();  _load_live();  _load_align();  _init_ocr()

    await loop.run_in_executor(None, _warm)

    yield  # app is running

    await db.disconnect()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title       = "KYC Verification API",
    description = "Identity & biometric verification engine — ONNX, zero cloud dependency.",
    version     = "2.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

# API routes
app.include_router(verify.router,  prefix="/api/v1")
app.include_router(capture.router, prefix="/api/v1")
app.include_router(admin.router,   prefix="/api/v1/admin")


@app.get("/health", tags=["meta"])
async def health():
    return {
        "status": "ok",
        "db":     db.available,
        "models_dir": str(_WEB_DIR.parent / "models"),
    }


# /config.js — injected by every HTML page before module scripts.
# Set EXTERNAL_API_URL on Render to point the browser at your local Docker API.
# e.g.  EXTERNAL_API_URL=https://abc123.ngrok-free.app
@app.get("/config.js", include_in_schema=False)
async def config_js():
    external = os.getenv("EXTERNAL_API_URL", "").rstrip("/")
    js = f"window.API_BASE = {repr(external)};\n"
    return Response(content=js, media_type="text/javascript")


# Static frontend — must come AFTER API routes so /api/* is not shadowed
if _WEB_DIR.exists():
    app.mount("/liveness", StaticFiles(directory=str(_WEB_DIR / "liveness")), name="liveness")
    app.mount("/scripts",  StaticFiles(directory=str(_WEB_DIR / "scripts")),  name="scripts")
    app.mount("/styles",   StaticFiles(directory=str(_WEB_DIR / "styles")),   name="styles")

    # Serve named HTML pages
    for _page in ("index", "id-capture", "liveness", "handoff", "pipeline"):
        _html = _WEB_DIR / f"{_page}.html"
        if _html.exists():
            # capture _html in closure
            def _make_route(p: Path):
                async def _route():
                    return FileResponse(str(p))
                _route.__name__ = p.stem
                return _route

            app.get(f"/{_page}" if _page != "index" else "/",
                    include_in_schema=False)(_make_route(_html))

    # manifest + sw
    for _static in ("manifest.json", "sw.js"):
        _f = _WEB_DIR / _static
        if _f.exists():
            def _make_static(p: Path):
                async def _route():
                    return FileResponse(str(p))
                _route.__name__ = p.name
                return _route
            app.get(f"/{_static}", include_in_schema=False)(_make_static(_f))

    # Admin dashboard — static assets + pages, served unauthenticated at the
    # file level (the gate is that every /api/v1/admin/* call requires the
    # session cookie; the frontend redirects to /admin/login on any 401).
    _ADMIN_DIR = _WEB_DIR / "admin"
    if _ADMIN_DIR.exists():
        for _asset in ("admin.css", "admin.js", "list.js", "detail.js"):
            _f = _ADMIN_DIR / _asset
            if _f.exists():
                def _make_admin_asset(p: Path):
                    async def _route():
                        return FileResponse(str(p))
                    _route.__name__ = f"admin_asset_{p.stem}"
                    return _route
                app.get(f"/admin/{_asset}", include_in_schema=False)(_make_admin_asset(_f))

        for _page in ("login", "list", "detail"):
            _html = _ADMIN_DIR / f"{_page}.html"
            if _html.exists():
                def _make_admin_page(p: Path):
                    async def _route():
                        return FileResponse(str(p))
                    _route.__name__ = f"admin_{p.stem}"
                    return _route
                app.get(f"/admin/{_page}", include_in_schema=False)(_make_admin_page(_html))

        @app.get("/admin", include_in_schema=False)
        async def admin_root():
            return RedirectResponse("/admin/list")
