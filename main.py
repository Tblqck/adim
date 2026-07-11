"""
Admin dashboard — FastAPI entry point.

Contains only the admin dashboard: its static HTML/JS (this folder) and the
backend it calls into (production/ — PEP/KYB screening, document-check,
verifications history, auth, DB). No client-facing ID-capture/verification
flow, no ONNX models — that's a separate concern and lives elsewhere.

Run locally:
    uvicorn main:app --reload --port 5050
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from production.database import db
from production.api.routers import admin as admin_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
)

_HERE     = Path(__file__).resolve().parent
_NO_STORE = {"Cache-Control": "no-store"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(
    title       = "KYC Admin Dashboard",
    description = "Review dashboard for verification results, PEP/KYB screening, and document checks.",
    version     = "3.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

app.include_router(admin_router.router, prefix="/api/v1/admin")


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "db": db.available}


# Country-code autocomplete data, shared by list/screen/document-check pages.
# Served directly (not via StaticFiles) so it gets the same no-store header —
# a generic StaticFiles mount lets browsers cache it indefinitely.
_COUNTRIES_JS = _HERE / "scripts" / "countries.js"
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


@app.get("/", include_in_schema=False)
async def root():
    return RedirectResponse("/admin/list")
