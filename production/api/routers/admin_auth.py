"""
Admin dashboard authentication.

Two kinds of session, same signed cookie mechanism, both DB-backed:
  - Super-admin: a row in `admin_users` (fixed username "admin"), sees every
    firm's data. Login form's "Firm" field left blank routes here.
  - Firm-scoped: a row in the `firms` table (slug + hashed password), sees
    only that firm's data. See production/api/routers/admin.py's POST /firms
    for how a firm is created.

Cookie is a tamper-proof, expiring token via itsdangerous (already an
installed transitive dependency of FastAPI/Starlette, so this adds no new
pip footprint).

Safe-by-default: ADMIN_SESSION_SECRET must be explicitly set for any
session — super-admin or firm — to verify. There is deliberately no
fallback to ADMIN_PASSWORD or a hardcoded default for the signing secret;
a predictable signing secret would let anyone forge a session cookie.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets

from fastapi import APIRouter, Form, HTTPException, Request, Response
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer

log = logging.getLogger(__name__)

COOKIE_NAME  = "admin_session"
MAX_AGE_SECS = 7 * 24 * 3600  # 7-day session

_PBKDF2_ITERATIONS = 200_000
SUPER_ADMIN_USERNAME = "admin"


def _session_secret() -> str:
    return os.getenv("ADMIN_SESSION_SECRET", "")


def _serializer() -> URLSafeTimedSerializer:
    return URLSafeTimedSerializer(_session_secret(), salt="kyc-admin-session")


def require_admin(request: Request) -> dict:
    """FastAPI dependency — raises 401 unless a valid session cookie is
    present, otherwise returns its payload: {"super_admin": True} or
    {"firm_id": int, "firm_slug": str}."""
    if not _session_secret():
        raise HTTPException(401, "Admin dashboard is not configured (ADMIN_SESSION_SECRET unset)")

    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")

    try:
        return _serializer().loads(token, max_age=MAX_AGE_SECS)
    except (BadSignature, SignatureExpired):
        raise HTTPException(401, "Session expired or invalid")


async def require_admin_or_firm_key(request: Request) -> dict:
    """Like require_admin, but also accepts a firm's own X-Client-Id/
    X-Api-Key as an alternative to the dashboard cookie. This is what lets
    a firm's own backend call firm-scoped endpoints (e.g. POST /sessions,
    to generate a Generate Link token programmatically) without a human
    "logging in" — a server-to-server process has no browser to hold a
    session cookie, but it already has the same API key it uses for
    direct /verify calls.

    Returns the same {"firm_id": int, "firm_slug": str} shape as a
    firm-scoped dashboard session, so callers don't need to care which
    path authenticated the request.
    """
    client_id = request.headers.get("X-Client-Id", "")
    if client_id:
        from production.database import db
        provided = request.headers.get("X-Api-Key", "")
        firm = await db.get_firm_by_slug(client_id)
        if not firm or not firm.get("active") or not provided or not verify_api_key(provided, firm["api_key_hash"]):
            raise HTTPException(403, "Invalid X-Client-Id/X-Api-Key")
        return {"firm_id": firm["id"], "firm_slug": firm["slug"]}
    return require_admin(request)


# ── Password / API-key hashing ──────────────────────────────────────────────
# Neither a firm's dashboard password nor its API key is ever stored in
# recoverable form. Passwords are human-chosen (low entropy) so they get a
# slow, salted KDF; API keys are generated as random 256-bit tokens, so a
# plain sha256 is already infeasible to brute-force — no need for a slow KDF
# there, and it keeps firm creation/lookup cheap.

def hash_password(password: str, salt: str | None = None) -> tuple[str, str]:
    """Returns (hash_hex, salt_hex). Pass salt back in to verify."""
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ITERATIONS)
    return digest.hex(), salt


def verify_password(password: str, hash_hex: str, salt_hex: str) -> bool:
    candidate, _ = hash_password(password, salt_hex)
    return hmac.compare_digest(candidate, hash_hex)


def generate_api_key() -> str:
    return secrets.token_hex(32)


def hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def verify_api_key(key: str, hash_hex: str) -> bool:
    return hmac.compare_digest(hash_api_key(key), hash_hex)


router = APIRouter(tags=["admin-auth"])


@router.post("/login")
async def login(
    request: Request,
    response: Response,
    password: str = Form(...),
    firm: str = Form(None, description="Firm slug — omit for super-admin login"),
):
    from production.database import db

    if firm:
        row = await db.get_firm_by_slug(firm)
        if not row or not row.get("active"):
            raise HTTPException(401, "Incorrect firm or password")
        if not verify_password(password, row["admin_password_hash"], row["admin_password_salt"]):
            raise HTTPException(401, "Incorrect firm or password")
        payload = {"firm_id": row["id"], "firm_slug": row["slug"]}
        is_super_admin = False
    else:
        row = await db.get_admin_user_by_username(SUPER_ADMIN_USERNAME)
        if not row or not row.get("active"):
            raise HTTPException(401, "Incorrect password")
        if not verify_password(password, row["password_hash"], row["password_salt"]):
            raise HTTPException(401, "Incorrect password")
        payload = {"super_admin": True}
        is_super_admin = True

    token = _serializer().dumps(payload)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=MAX_AGE_SECS,
        httponly=True,
        samesite="lax",
        secure=request.url.scheme == "https",
    )
    return {"ok": True, "super_admin": is_super_admin}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}
