"""
Supabase Storage layer via REST API (HTTPS) — mirrors production/database.py.

Persists verification images (ID front/back, liveness face frames) to a
private 'captures' bucket so the admin dashboard can review them. The
bucket is private: signed_url() must be called at request time by the
admin API, never baked into a stored row.

Environment variables (shared with database.py):
  SUPABASE_URL      e.g. https://zmthbjqrgkgpgvmxgdhd.supabase.co
  SUPABASE_KEY      service_role secret key (sb_secret_... or eyJ...)

Falls back gracefully if env vars are not set — upload()/signed_url()
return None rather than raising, so the verify pipeline never blocks or
fails on storage being unavailable.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

try:
    import httpx
    _HTTPX_OK = True
except ImportError:
    _HTTPX_OK = False
    log.warning("httpx not installed — storage features disabled")

BUCKET = "captures"


def _base_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _headers(content_type: Optional[str] = None) -> dict:
    key = os.getenv("SUPABASE_KEY", "")
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    if content_type:
        headers["Content-Type"] = content_type
    return headers


class _Storage:
    def __init__(self):
        self._client: Optional["httpx.AsyncClient"] = None

    @property
    def available(self) -> bool:
        return _HTTPX_OK and bool(_base_url()) and bool(os.getenv("SUPABASE_KEY", ""))

    def _ensure_client(self) -> Optional["httpx.AsyncClient"]:
        if not self.available:
            return None
        if self._client is None:
            self._client = httpx.AsyncClient(base_url=_base_url(), timeout=20.0)
        return self._client

    async def aclose(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Upload ───────────────────────────────────────────────────────────────

    async def upload(
        self,
        path: str,
        data: bytes,
        content_type: str = "image/jpeg",
    ) -> Optional[str]:
        """
        Upload bytes to {bucket}/{path}. Returns the object path on success,
        None if storage isn't configured or the upload failed (never raises).
        """
        client = self._ensure_client()
        if client is None or not data:
            return None
        try:
            headers = _headers(content_type)
            headers["x-upsert"] = "true"
            r = await client.post(
                f"/storage/v1/object/{BUCKET}/{path}",
                content=data,
                headers=headers,
            )
            r.raise_for_status()
            return path
        except Exception as exc:
            log.warning("storage.upload(%s) failed: %s", path, exc)
            return None

    # ── Signed URL ───────────────────────────────────────────────────────────

    async def signed_url(self, path: str, expires_in: int = 300) -> Optional[str]:
        """
        Mint a short-lived signed URL for a private object. Call this only
        at admin-detail render time — never persist the result.
        """
        client = self._ensure_client()
        if client is None or not path:
            return None
        try:
            r = await client.post(
                f"/storage/v1/object/sign/{BUCKET}/{path}",
                json={"expiresIn": expires_in},
                headers=_headers("application/json"),
            )
            r.raise_for_status()
            signed_path = r.json().get("signedURL")
            if not signed_path:
                return None
            return f"{_base_url()}/storage/v1{signed_path}"
        except Exception as exc:
            log.warning("storage.signed_url(%s) failed: %s", path, exc)
            return None


# Singleton used by verify.py (upload) and the admin router (signed_url)
storage = _Storage()
