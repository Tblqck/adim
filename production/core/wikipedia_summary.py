"""
Best-effort fetch of a clean plain-text summary from Wikipedia's free REST
API, keyed off a wikipedia_url OpenSanctions already returns per-match
(properties.wikipediaUrl). Shared by pep_screen.py and kyb_screen.py to
enrich their `summary` field with a real Wikipedia extract instead of
OpenSanctions' multilingual notes grab-bag when a Wikipedia page exists —
Wikipedia's own summary endpoint is a single clean English paragraph,
already the highest-quality bio text available for any well-known subject.

https://en.wikipedia.org/api/rest_v1/page/summary/{title} — public, free,
no key required.

Never raises — a slow/failed Wikipedia call should never break a screen
result that is otherwise already complete without it.
"""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import unquote

log = logging.getLogger(__name__)

try:
    import httpx
    _HTTPX_OK = True
except ImportError:
    _HTTPX_OK = False

TIMEOUT = 4.0

# Wikimedia's API etiquette policy 403s any request without a descriptive
# User-Agent identifying the client and a contact — see
# https://meta.wikimedia.org/wiki/User-Agent_policy
_HEADERS = {"User-Agent": "idntory-kyc-admin/1.0 (compliance screening; contact: ai@goliveweb.eu)"}


async def fetch_extract(wikipedia_url: Optional[str]) -> Optional[str]:
    """wikipedia_url looks like 'https://en.wikipedia.org/wiki/Vladimir_Putin'
    — the page title is the last path segment."""
    if not wikipedia_url or not _HTTPX_OK:
        return None
    try:
        title = unquote(wikipedia_url.rstrip("/").rsplit("/", 1)[-1])
        if not title:
            return None
        async with httpx.AsyncClient(timeout=TIMEOUT, headers=_HEADERS) as client:
            r = await client.get(f"https://en.wikipedia.org/api/rest_v1/page/summary/{title}")
            r.raise_for_status()
            data = r.json()
        extract = (data.get("extract") or "").strip()
        return extract or None
    except Exception as exc:
        log.warning("Wikipedia summary fetch failed for %r: %s", wikipedia_url, exc)
        return None
