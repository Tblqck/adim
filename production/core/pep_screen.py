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
import re
from typing import Optional

log = logging.getLogger(__name__)

try:
    import httpx
    _HTTPX_OK = True
except ImportError:
    _HTTPX_OK = False

from production.core.db_catalog import PEP_DATABASES, SANCTIONS_DATABASES, RISK_TOPIC_LABELS
from production.core.wikipedia_summary import fetch_extract as fetch_wikipedia_extract

MATCH_URL = "https://api.opensanctions.org/match/default"
TIMEOUT   = 5.0

# "PEP & Sanctions Check" screens a person against both — the full named
# catalog (production/core/db_catalog.py) is shown per search, not just the
# aggregate buckets, so an admin sees exactly which named list a given
# result did or didn't come from.
DATABASES_CHECKED = SANCTIONS_DATABASES + PEP_DATABASES

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
        return await _parse_response(full_name, data)
    except Exception as exc:
        log.warning("PEP screen response parse failed for %r: %s", full_name, exc)
        return _unavailable(full_name, f"unexpected API response shape: {exc}")


_ENGLISH_HINTS = re.compile(r"\b(the|is|of|and|in|to|was|has|for|since|as|by|on|from)\b", re.IGNORECASE)


def _pick_note(notes: list) -> Optional[str]:
    """Notes are a multilingual grab-bag of short field-like strings and full
    narrative summaries in several languages. Ranking by count of common
    English stopwords (not just raw length) reliably picks the English
    narrative over an equally-long French/Russian/etc. one."""
    if not notes:
        return None
    best = max(notes, key=lambda n: (len(_ENGLISH_HINTS.findall(n)), len(n)))
    return best[:500] + "…" if len(best) > 500 else best


def _per_database_status(matches: list) -> list:
    """Cross-reference each match's source dataset / topics against
    DATABASES_CHECKED so the admin sees which specific list actually
    produced a hit, instead of a blanket 'checked' status on all five
    regardless of outcome. 'peps' is an OpenSanctions *collection* of many
    underlying per-country PEP sources, not a single source dataset, so it
    can't be matched via the datasets field the way the four sanctions
    lists can — the 'role.pep' topic is the reliable signal for it."""
    hit_dataset_ids: set = set()
    for m in matches:
        hit_dataset_ids.update(m.get("datasets") or [])
    pep_hit = any("role.pep" in (m.get("topics") or []) for m in matches)

    out = []
    for entry in DATABASES_CHECKED:
        hit = pep_hit if entry["dataset_id"] == "peps" else entry["dataset_id"] in hit_dataset_ids
        out.append({**entry, "status": "HIT" if hit else "CLEAR"})
    return out


def _build_summary(full_name: str, matches: list, all_topics: set, wiki_extract: Optional[str] = None) -> str:
    """Plain-language read of the result — who this is first, then what the
    result means. A compliance officer wants identity established before a
    confidence score; leading with the number doesn't tell them anything
    until they already know who they're looking at."""
    if not matches:
        return f"{full_name} was checked against {len(DATABASES_CHECKED)} databases across global PEP and sanctions lists — no matching record found."

    top = matches[0]
    # Wikipedia's own summary is a single clean English paragraph — prefer
    # it over OpenSanctions' notes (a multilingual grab-bag) whenever the
    # subject has a Wikipedia page. Falls back to the richest available
    # note otherwise, not necessarily off the top-scored match — a
    # lower-scored duplicate record sometimes carries the fuller narrative
    # while the highest-scored entry has none.
    bio = wiki_extract or next((m["notes"] for m in matches if m.get("notes")), None)

    role  = f", {top['position']}" if top.get("position") else ""
    where = f" ({top['country']})" if top.get("country") else ""
    identity = f"{top['name']}{where}{role}."
    if bio:
        bio = bio.strip()
        if bio and bio[-1] not in ".!?…":
            bio += "."
        identity += f" {bio}"

    confidence = round(top["score"] * 100)
    count = "1 record matched" if len(matches) == 1 else f"{len(matches)} records matched"

    # Only topics OpenSanctions itself attached carry a reason — a same-name
    # hit in a general reference/ownership dataset with no topics at all
    # isn't a compliance flag, just a coincidence (see db_catalog.py).
    reasons = [label for code, label in RISK_TOPIC_LABELS.items() if code in all_topics]
    if reasons:
        verdict = f" — flagged for review: subject is {', '.join(reasons)}."
    else:
        verdict = " — no compliance-relevant flags on this record; likely a coincidental name match."

    return f"{identity} {count}, up to {confidence}% confidence{verdict}".strip()


async def _parse_response(full_name: str, data: dict) -> dict:
    responses = data.get("responses") or data.get("results") or {}
    q1 = responses.get("q1") or {}
    raw_results = q1.get("results") or []

    matches = []
    for item in raw_results:
        score = float(item.get("score") or 0.0)
        if score < MATCH_CONFIDENCE_THRESHOLD:
            continue
        props = item.get("properties") or {}
        matches.append({
            "name":          item.get("caption") or item.get("name") or "unknown",
            "score":         round(score, 3),
            "country":       (props.get("country") or [None])[0],
            "position":      "; ".join(props.get("position") or []) or None,
            "birth_date":    (props.get("birthDate") or [None])[0],
            "notes":         _pick_note(props.get("notes") or []),
            "source_urls":   (props.get("sourceUrl") or [])[:3],
            "wikipedia_url": (props.get("wikipediaUrl") or [None])[0],
            "datasets": item.get("datasets") or [],
            "topics":   props.get("topics") or item.get("topics") or [],
        })

    matches.sort(key=lambda m: m["score"], reverse=True)
    top_score = matches[0]["score"] if matches else 0.0

    # A match with an empty topics list carries no compliance signal from
    # OpenSanctions itself — e.g. a same-name entry in a general corporate/
    # ownership reference dataset. Gating the verdict on topics (not just
    # "a match exists") avoids flagging those as POTENTIAL_MATCH.
    all_topics: set = set()
    for m in matches:
        all_topics.update(m.get("topics") or [])
    pep_match_found = "role.pep" in all_topics

    if all_topics:
        risk_classification = "POTENTIAL_MATCH"
        banner = "REVIEW REQUIRED: POTENTIAL MATCH"
    else:
        risk_classification = "CLEAN"
        banner = "PASSED: NO PEP MATCH FOUND"

    wiki_url = next((m["wikipedia_url"] for m in matches if m.get("wikipedia_url")), None)
    wiki_extract = await fetch_wikipedia_extract(wiki_url) if wiki_url else None

    return {
        "ok": True,
        "subject_name": full_name,
        "risk_classification": risk_classification,
        "match_confidence": top_score,
        "pep_match_found": pep_match_found,
        "banner": banner,
        "summary": _build_summary(full_name, matches, all_topics, wiki_extract),
        "databases_checked": _per_database_status(matches),
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
        "summary": f"Screening could not be completed: {reason}",
        "databases_checked": [{**e, "status": "UNAVAILABLE"} for e in DATABASES_CHECKED],
        "matches": [],
        "error": reason,
    }
