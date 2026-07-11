"""
KYC engine + admin dashboard — combined FastAPI entry point.

Everything lives under this one folder now: the ID-capture/verification
engine (production/, moved in from its old separate location — ONNX models,
OCR, biometrics, liveness, document matching) and the admin dashboard
(this folder's own HTML/JS). No more HTTP proxy to a separately-running
service — production.* is imported and run in-process.

Run locally:
    uvicorn main:app --reload --port 5000
"""

from __future__ import annotations

import logging
import mimetypes
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from production.database import db
from production.api.routers import verify, capture, admin as admin_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
)

_HERE     = Path(__file__).resolve().parent
_WEB_DIR  = _HERE / "production" / "web"
_NO_STORE = {"Cache-Control": "no-store"}


# ── API key middleware ────────────────────────────────────────────────────────
# Only the actual data-plane endpoints require:
#   X-Api-Key: <value of API_KEY env var, or a firm's key if X-Client-Id is sent>
# Everything else — the client capture pages, their static JS/CSS
# (/scripts, /styles, /liveness), and the admin dashboard — is loaded by a
# plain browser navigation or <script src>/<link>, which can never attach a
# custom header, so gating those the same way as the API would just break
# them. This is an allowlist of the protected surface, not a blocklist of
# exemptions. If API_KEY is not set AND no X-Client-Id is sent, the
# middleware is disabled entirely (dev mode).
#
# Multi-tenant lookup: if the caller sends X-Client-Id, it's resolved against
# firms.slug and the key is checked against that firm's hashed key — success
# attaches request.state.firm_id so verify.py/capture.py can stamp it onto
# whatever gets written to the DB. No X-Client-Id falls back to the legacy
# single API_KEY env var check with firm_id left None (unattributed / your
# own default usage) — existing integrations keep working unchanged.
#
# A third path, X-Session-Token, is for the hosted capture page (a public
# browser, not a trusted server) — see production/api/routers/admin.py's
# POST /sessions. It's a random, single-use, 24h-expiring token, checked
# and consumed here, so the browser never needs the firm's real API key.

def _session_token_expired(expires_at: str) -> bool:
    from datetime import datetime, timezone
    try:
        exp = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > exp
    except Exception:
        return True  # unparseable expiry — fail closed


class ApiKeyMiddleware(BaseHTTPMiddleware):
    _PROTECTED_PREFIXES = ("/api/v1/verify", "/api/v1/save", "/api/v1/mrz")

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith(self._PROTECTED_PREFIXES):
            return await call_next(request)

        session_token = request.headers.get("X-Session-Token", "")
        if session_token:
            sess = await db.get_session_by_token(session_token)
            if not sess or sess.get("status") != "pending" or _session_token_expired(sess.get("expires_at", "")):
                return JSONResponse(
                    status_code=403,
                    content={"ok": False, "error": "Forbidden — invalid, expired, or already-used session token"},
                )
            if not await db.mark_session_used(session_token):
                # Lost a race against a concurrent request for the same token.
                return JSONResponse(
                    status_code=403,
                    content={"ok": False, "error": "Forbidden — session token already used"},
                )
            request.state.firm_id = sess["firm_id"]
            return await call_next(request)

        provided = request.headers.get("X-Api-Key", "")
        client_id = request.headers.get("X-Client-Id", "")

        if client_id:
            from production.api.routers.admin_auth import verify_api_key
            firm = await db.get_firm_by_slug(client_id)
            if not firm or not firm.get("active") or not provided or not verify_api_key(provided, firm["api_key_hash"]):
                return JSONResponse(
                    status_code=403,
                    content={"ok": False, "error": "Forbidden — missing or invalid X-Client-Id/X-Api-Key"},
                )
            request.state.firm_id = firm["id"]
            return await call_next(request)

        request.state.firm_id = None
        expected = os.getenv("API_KEY", "")
        if not expected:
            # No key configured — open (dev mode)
            return await call_next(request)

        if not provided or provided != expected:
            return JSONResponse(
                status_code=403,
                content={"ok": False, "error": "Forbidden — missing or invalid X-Api-Key header"},
            )

        return await call_next(request)


# Correct MIME types for MediaPipe WASM assets
mimetypes.add_type("application/wasm",         ".wasm")
mimetypes.add_type("application/octet-stream", ".task")
mimetypes.add_type("text/javascript",          ".mjs")


# ── Lifespan: connect DB and warm ONNX models on startup ─────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
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
    title       = "KYC Engine + Admin Dashboard",
    description = "Identity & biometric verification engine plus its admin review dashboard — one combined service.",
    version     = "3.0.0",
    lifespan    = lifespan,
)

app.add_middleware(ApiKeyMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

# API routes
app.include_router(verify.router,        prefix="/api/v1")
app.include_router(capture.router,       prefix="/api/v1")
app.include_router(admin_router.router,  prefix="/api/v1/admin")


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


# ── Client capture frontend (production/web/) ────────────────────────────────
# Must come AFTER API routes so /api/* is not shadowed.
if _WEB_DIR.exists():
    app.mount("/liveness", StaticFiles(directory=str(_WEB_DIR / "liveness")), name="liveness")
    app.mount("/scripts",  StaticFiles(directory=str(_WEB_DIR / "scripts")),  name="scripts")
    app.mount("/styles",   StaticFiles(directory=str(_WEB_DIR / "styles")),   name="styles")

    for _page in ("index", "id-capture", "liveness", "handoff", "pipeline"):
        _html = _WEB_DIR / f"{_page}.html"
        if _html.exists():
            def _make_route(p: Path):
                async def _route():
                    return FileResponse(str(p))
                _route.__name__ = p.stem
                return _route
            app.get(f"/{_page}" if _page != "index" else "/",
                    include_in_schema=False)(_make_route(_html))

    for _static in ("manifest.json", "sw.js"):
        _f = _WEB_DIR / _static
        if _f.exists():
            def _make_static(p: Path):
                async def _route():
                    return FileResponse(str(p))
                _route.__name__ = p.name
                return _route
            app.get(f"/{_static}", include_in_schema=False)(_make_static(_f))


# ── Admin dashboard (this folder's own HTML/JS) ───────────────────────────────
# Static assets + pages, served unauthenticated at the file level (the gate
# is that every /api/v1/admin/* call requires the session cookie; the
# frontend redirects to /admin/login on any 401).
#
# Cache-Control: no-store on every response — without it, browsers fall back
# to heuristic caching for plain FileResponse output, and different browsers
# hang on to stale HTML/JS/CSS for different lengths of time, so a new
# deploy looks "live" in some browsers and stale in others.

_SCRIPTS_DIR = _HERE / "scripts"
_COUNTRIES_JS = _SCRIPTS_DIR / "countries.js"
if _COUNTRIES_JS.exists():
    @app.get("/scripts/countries.js", include_in_schema=False)
    async def scripts_countries():
        return FileResponse(str(_COUNTRIES_JS), headers=_NO_STORE)

for _asset in ("admin.css", "admin.js", "list.js", "detail.js", "screen.js", "document-check.js",
               "generate-link.js", "kyb.js", "databases.js"):
    _f = _HERE / _asset
    if _f.exists():
        def _make_admin_asset(p: Path):
            async def _route():
                return FileResponse(str(p), headers=_NO_STORE)
            _route.__name__ = f"admin_asset_{p.stem}"
            return _route
        app.get(f"/admin/{_asset}", include_in_schema=False)(_make_admin_asset(_f))

for _page in ("login", "list", "detail", "screen", "document-check", "generate-link", "kyb", "databases", "docs"):
    _html = _HERE / f"{_page}.html"
    if _html.exists():
        def _make_admin_page(p: Path):
            async def _route():
                return FileResponse(str(p), headers=_NO_STORE)
            _route.__name__ = f"admin_{p.stem}"
            return _route
        app.get(f"/admin/{_page}", include_in_schema=False)(_make_admin_page(_html))


@app.get("/admin", include_in_schema=False)
async def admin_root():
    return RedirectResponse("/admin/list")
