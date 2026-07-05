"""
Admin dashboard — FastAPI entry point.

Self-contained: serves the static admin frontend (this folder) and proxies
every /api/v1/admin/* call to the AWS box that runs the verification engine
(see admin_proxy.py). No DB client, no ML models, no OpenCV/doctr — this
folder can be deployed on its own with nothing outside it.

Run locally:
    uvicorn main:app --reload --port 5000
"""

from __future__ import annotations

import logging
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

import admin_proxy

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
)

_HERE        = Path(__file__).resolve().parent
_SCRIPTS_DIR = _HERE / "scripts"
_NO_STORE    = {"Cache-Control": "no-store"}

app = FastAPI(
    title       = "KYC Admin Dashboard",
    description = "Review dashboard for verification results — proxies to the AWS verification engine.",
    version     = "2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

app.include_router(admin_proxy.router, prefix="/api/v1/admin")


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok"}


# Country-code autocomplete data, shared by list/screen/document-check pages.
# Served directly (not via StaticFiles) so it gets the same no-store header —
# a generic StaticFiles mount lets browsers cache it indefinitely.
_COUNTRIES_JS = _SCRIPTS_DIR / "countries.js"
if _COUNTRIES_JS.exists():
    @app.get("/scripts/countries.js", include_in_schema=False)
    async def scripts_countries():
        return FileResponse(str(_COUNTRIES_JS), headers=_NO_STORE)

# Static assets + pages, served unauthenticated at the file level (the gate
# is that every /api/v1/admin/* call requires the session cookie; the
# frontend redirects to /admin/login on any 401).
#
# Cache-Control: no-store on every response — without it, browsers fall back
# to heuristic caching for plain FileResponse output, and different browsers
# hang on to stale HTML/JS/CSS for different lengths of time, so a new
# deploy looks "live" in some browsers and stale in others.
for _asset in ("admin.css", "admin.js", "list.js", "detail.js", "screen.js", "document-check.js"):
    _f = _HERE / _asset
    if _f.exists():
        def _make_admin_asset(p: Path):
            async def _route():
                return FileResponse(str(p), headers=_NO_STORE)
            _route.__name__ = f"admin_asset_{p.stem}"
            return _route
        app.get(f"/admin/{_asset}", include_in_schema=False)(_make_admin_asset(_f))

for _page in ("login", "list", "detail", "screen", "document-check", "generate-link"):
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


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/admin/list")
