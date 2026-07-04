"""
Admin dashboard — FastAPI entry point.

Serves the admin static frontend (production/web/admin/) plus the
/api/v1/admin/* JSON API. This is intentionally just the review dashboard,
not the full ID-verification engine — it only reads results that were
already written to Supabase by that engine elsewhere.

Run locally:
    uvicorn production.api.main:app --reload --port 5000

On Render (via Dockerfile):
    uvicorn production.api.main:app --host 0.0.0.0 --port $PORT
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from production.database import db
from production.api.routers import admin

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-7s  %(name)s — %(message)s",
)

_ADMIN_DIR = Path(__file__).resolve().parents[1] / "web" / "admin"


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    yield
    await db.disconnect()


app = FastAPI(
    title       = "KYC Admin Dashboard",
    description = "Review dashboard for verification results — reads from Supabase only.",
    version     = "1.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins  = ["*"],
    allow_methods  = ["*"],
    allow_headers  = ["*"],
)

app.include_router(admin.router, prefix="/api/v1/admin")


@app.get("/health", tags=["meta"])
async def health():
    return {"status": "ok", "db": db.available}


# Admin dashboard — static assets + pages, served unauthenticated at the file
# level (the gate is that every /api/v1/admin/* call requires the session
# cookie; the frontend redirects to /admin/login on any 401).
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

    @app.get("/", include_in_schema=False)
    async def root():
        return RedirectResponse("/admin/list")
