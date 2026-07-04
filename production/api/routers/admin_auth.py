"""
Admin dashboard authentication — single shared password, signed session cookie.

No per-admin accounts, no Supabase Auth — just a shared ADMIN_PASSWORD env
var and a tamper-proof, expiring cookie via itsdangerous (already an
installed transitive dependency of FastAPI/Starlette, so this adds no new
pip footprint).

Safe-by-default: if ADMIN_PASSWORD is unset, require_admin() always
rejects — the dashboard is locked out rather than silently open.
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import APIRouter, Form, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

log = logging.getLogger(__name__)

COOKIE_NAME  = "admin_session"
MAX_AGE_SECS = 7 * 24 * 3600  # 7-day session


def _admin_password() -> str:
    return os.getenv("ADMIN_PASSWORD", "")


def _serializer() -> URLSafeTimedSerializer:
    secret = os.getenv("ADMIN_SESSION_SECRET") or _admin_password() or "unset"
    return URLSafeTimedSerializer(secret, salt="kyc-admin-session")


def require_admin(request: Request) -> None:
    """FastAPI dependency — raises 401 unless a valid session cookie is present."""
    if not _admin_password():
        raise HTTPException(401, "Admin dashboard is not configured (ADMIN_PASSWORD unset)")

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")

    try:
        _serializer().loads(token, max_age=MAX_AGE_SECS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "Session expired or invalid")


router = APIRouter(tags=["admin-auth"])


@router.post("/login")
async def login(request: Request, response: Response, password: str = Form(...)):
    expected = _admin_password()
    if not expected or not hmac.compare_digest(password, expected):
        raise HTTPException(401, "Incorrect password")

    token = _serializer().dumps({"admin": True})
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=MAX_AGE_SECS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return {"ok": True}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}
