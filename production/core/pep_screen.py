"""
PEP & Sanctions screening via the OpenSanctions hosted Match API.

https://api.opensanctions.org/match/default aggregates OFAC SDN, EU
Financial Sanctions, UK Consolidated List, UN Consolidated List, and
global Politically-Exposed-Person (PEP) lists under one 'default' dataset,
with a free tier suitable for low-volume KYC screening. It does
structured entity matching (schema + properties) rather than full-text
search, which is what an extracted-identity screen needs.

Environment variables:
  OPENSANCTIONS_API_KEY   Free key from https://www.opensanctions.org/api/

Graceful degradation: if the key is unset, or the request fails/times
out, screen() returns risk_classification "UNAVAILABLE" without ever
raising or blocking the caller. It is called from a background thread in
verify.py, never inline in the synchronous /api/v1/verify response.
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

MATCH_URL = "https://api.opensanctions.org/match/default"
TIMEOUT   = 5.0

# Static list matched to the datasets the 'default' OpenSanctions collection
# aggregates — shown to admins as "what was checked" regardless of whether
# any individual dataset actually produced a hit.
DATABASES_CHECKED = [
    {"name": "US OFAC SDN",           "dataset_id": "us_ofac_sdn",     "status": "ACTIVE"},
    {"name": "EU Financial Sanctions", "dataset_id": "eu_fsf",         "status": "ACTIVE"},
    {"name": "UK Consolidated List",  "dataset_id": "gb_hmt_sanctions", "status": "ACTIVE"},
    {"name": "UN Consolidated List",  "dataset_id": "un_sc_sanctions", "status": "ACTIVE"},
    {"name": "Global PEP Lists",      "dataset_id": "peps",            "status": "ACTIVE"},
]

MATCH_CONFIDENCE_THRESHOLD = 0.5  # OpenSanctions scores 0-1; below this, treat as noise


def _api_key() -> str:
    return os.getenv("OPENSANCTIONS_API_KEY", "")


async def screen(full_name: str, dob: Optional[str] = None, nationality: Optional[str] = None) -> dict:
    """
    Screen a subject name (+ optional DOB / nationality) against sanctions
    and PEP lists. Never raises.
    """
    full_name = (full_name or "").strip()
    if not full_name:
        return _unavailable(full_name, "no name to screen")

    key = _api_key()
    if not key or not _HTTPX_OK:
        return _unavailable(full_name, "OPENSANCTIONS_API_KEY not configured")

    properties: dict = {"name": [full_name]}
    if dob:
        properties["birthDate"] = [dob]
    if nationality:
        properties["nationality"] = [nationality.lower()]

    payload = {"queries": {"q1": {"schema": "Person", "properties": properties}}}

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as client:
            r = await client.post(
                MATCH_URL,
                json=payload,
                headers={"Authorization": f"ApiKey {key}"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as exc:
        log.warning("PEP screen request failed for %r: %s", full_name, exc)
        return _unavailable(full_name, str(exc))

    try:
        return _parse_response(full_name, data)
    except Exception as exc:
        log.warning("PEP screen response parse failed for %r: %s", full_name, exc)
        return _unavailable(full_name, f"unexpected API response shape: {exc}")


def _parse_response(full_name: str, data: dict) -> dict:
    responses = data.get("responses") or data.get("results") or {}
    q1 = responses.get("q1") or {}
    raw_results = q1.get("results") or []

    matches = []
    for item in raw_results:
        score = float(item.get("score") or 0.0)
        if score < MATCH_CONFIDENCE_THRESHOLD:
            continue
        matches.append({
            "name":     item.get("caption") or item.get("name") or "unknown",
            "score":    round(score, 3),
            "datasets": item.get("datasets") or [],
            "topics":   item.get("properties", {}).get("topics") or item.get("topics") or [],
        })

    matches.sort(key=lambda m: m["score"], reverse=True)
    top_score = matches[0]["score"] if matches else 0.0
    pep_match_found = any("role.pep" in m["topics"] for m in matches)

    if matches:
        risk_classification = "POTENTIAL_MATCH"
        banner = "REVIEW REQUIRED: POTENTIAL MATCH"
    else:
        risk_classification = "CLEAN"
        banner = "PASSED: NO PEP MATCH FOUND"

    return {
        "ok": True,
        "subject_name": full_name,
        "risk_classification": risk_classification,
        "match_confidence": top_score,
        "pep_match_found": pep_match_found,
        "banner": banner,
        "databases_checked": DATABASES_CHECKED,
        "matches": matches,
        "error": None,
    }


def _unavailable(full_name: str, reason: str) -> dict:
    return {
        "ok": False,
        "subject_name": full_name,
        "risk_classification": "UNAVAILABLE",
        "match_confidence": 0.0,
        "pep_match_found": False,
        "banner": "SCREENING UNAVAILABLE",
        "databases_checked": DATABASES_CHECKED,
        "matches": [],
        "error": reason,
    }
