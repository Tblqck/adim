"""
KYB (company) sanctions & adverse-media screening via the OpenSanctions
hosted Match API.

Same 'default' aggregated dataset and endpoint as production/core/
pep_screen.py, just matched against the Company schema instead of Person —
https://api.opensanctions.org/match/default aggregates OFAC SDN, EU
Financial Sanctions, UK Consolidated List, UN Consolidated List, and
adverse-media-flagged entities for organizations as well as individuals.

Environment variables:
  OPENSANCTIONS_API_KEY   Free key from https://www.opensanctions.org/api/

Graceful degradation: if the key is unset, or the request fails/times
out, screen() returns risk_classification "UNAVAILABLE" without ever
raising or blocking the caller.
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

from production.core.db_catalog import SANCTIONS_DATABASES, ADVERSE_MEDIA_DATABASES, RISK_TOPIC_LABELS
from production.core.wikipedia_summary import fetch_extract as fetch_wikipedia_extract

MATCH_URL = "https://api.opensanctions.org/match/default"
TIMEOUT   = 5.0

# KYB screens a company against both — the full named catalog
# (production/core/db_catalog.py) is shown per search, not just the
# aggregate buckets, so an admin sees exactly which named list a given
# result did or didn't come from.
DATABASES_CHECKED = SANCTIONS_DATABASES + ADVERSE_MEDIA_DATABASES

MATCH_CONFIDENCE_THRESHOLD = 0.5  # OpenSanctions scores 0-1; below this, treat as noise


def _api_key() -> str:
    return os.getenv("OPENSANCTIONS_API_KEY", "")


async def screen(
    company_name: str,
    jurisdiction: Optional[str] = None,
    registration_number: Optional[str] = None,
) -> dict:
    """
    Screen a company name (+ optional jurisdiction / registration number)
    against sanctions and adverse-media lists. Never raises.
    """
    company_name = (company_name or "").strip()
    if not company_name:
        return _unavailable(company_name, "no company name to screen")

    key = _api_key()
    if not key or not _HTTPX_OK:
        return _unavailable(company_name, "OPENSANCTIONS_API_KEY not configured")

    properties: dict = {"name": [company_name]}
    if jurisdiction:
        properties["jurisdiction"] = [jurisdiction.lower()]
    if registration_number:
        properties["registrationNumber"] = [registration_number]

    payload = {"queries": {"q1": {"schema": "Company", "properties": properties}}}

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
        log.warning("KYB screen request failed for %r: %s", company_name, exc)
        return _unavailable(company_name, str(exc))

    try:
        return await _parse_response(company_name, data)
    except Exception as exc:
        log.warning("KYB screen response parse failed for %r: %s", company_name, exc)
        return _unavailable(company_name, f"unexpected API response shape: {exc}")


_ENGLISH_HINTS = re.compile(r"\b(the|is|of|and|in|to|was|has|for|since|as|by|on|from)\b", re.IGNORECASE)
_STATUS_WORDS  = re.compile(r"^(active|inactive|dissolved|liquidated|closed|struck.off|suspended|revoked|cancelled|expired)$", re.IGNORECASE)


def _pick_status(statuses: list) -> Optional[str]:
    """status is another multilingual/format grab-bag (license codes,
    'норм.', 'Код лицензии: ...') — prefer a plain recognizable status word
    if one is present, otherwise fall back to the shortest value (the
    verbose bureaucratic strings are reliably longer)."""
    if not statuses:
        return None
    for s in statuses:
        if _STATUS_WORDS.match(s.strip()):
            return s.strip()
    return min(statuses, key=len)


def _pick_note(notes: list) -> Optional[str]:
    """Notes are a multilingual grab-bag of short field-like strings and full
    narrative summaries in several languages. Ranking by count of common
    English stopwords (not just raw length) reliably picks the English
    narrative over an equally-long French/Russian/etc. one."""
    if not notes:
        return None
    best = max(notes, key=lambda n: (len(_ENGLISH_HINTS.findall(n)), len(n)))
    return best[:500] + "…" if len(best) > 500 else best


_NAMED_SANCTION_IDS = {e["dataset_id"] for e in SANCTIONS_DATABASES}


def _per_database_status(matches: list) -> list:
    """Cross-reference each match's source dataset against DATABASES_CHECKED
    so the admin sees which specific list actually produced a hit, instead
    of a blanket 'checked' status regardless of outcome. 'Press-Sourced
    Sanctions Announcements' (dataset_id 'adverse_media_other') is a
    catch-all, not a discrete source dataset in OpenSanctions — it's treated
    as a hit whenever a match carries an actual risk topic (see
    RISK_TOPIC_LABELS) that isn't explained by one of the named sanctions
    lists. Requiring a real topic — not just 'some dataset other than the
    four named ones' — matters: a same-name hit in a general corporate/
    ownership reference dataset with zero topics (seen live: "Amazon Web
    Services" matched gem_energy_ownership, Global Energy Monitor's
    power-plant ownership mapping) is a coincidence, not adverse media."""
    hit_dataset_ids: set = set()
    for m in matches:
        hit_dataset_ids.update(m.get("datasets") or [])
    adverse_media_hit = any(
        (m.get("topics") and not (set(m.get("datasets") or []) & _NAMED_SANCTION_IDS))
        for m in matches
    )

    out = []
    for entry in DATABASES_CHECKED:
        hit = adverse_media_hit if entry["dataset_id"] == "adverse_media_other" else entry["dataset_id"] in hit_dataset_ids
        out.append({**entry, "status": "HIT" if hit else "CLEAR"})
    return out


def _build_summary(company_name: str, matches: list, all_topics: set, wiki_extract: Optional[str] = None) -> str:
    """Plain-language read of the result — what this firm is first, then
    what the result means. A compliance officer wants the company
    identified before a confidence score; leading with the number doesn't
    tell them anything until they already know who they're looking at."""
    if not matches:
        return f"{company_name} was checked against {len(DATABASES_CHECKED)} databases across global sanctions and adverse-media lists — no matching record found."

    top = matches[0]
    # Wikipedia's own summary is a single clean English paragraph — prefer
    # it over OpenSanctions' notes (a multilingual grab-bag) whenever the
    # company has a Wikipedia page. Falls back to the richest available
    # note otherwise, not necessarily off the top-scored match — a
    # lower-scored duplicate record sometimes carries the fuller narrative
    # while the highest-scored entry has none.
    bio = wiki_extract or next((m["notes"] for m in matches if m.get("notes")), None)

    kind  = f" ({top['entity_type']})" if top.get("entity_type") else ""
    where = top.get("jurisdiction") or top.get("country")
    where = f", {where}" if where else ""
    identity = f"{top['name']}{kind}{where}."
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
        verdict = f" — flagged for review: {', '.join(reasons)}."
    else:
        verdict = " — no compliance-relevant flags on this record; likely a coincidental name match."

    return f"{identity} {count}, up to {confidence}% confidence{verdict}".strip()


async def _parse_response(company_name: str, data: dict) -> dict:
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
            "name":                 item.get("caption") or item.get("name") or "unknown",
            "score":                round(score, 3),
            "country":              (props.get("country") or [None])[0],
            "jurisdiction":         (props.get("jurisdiction") or [None])[0],
            "status":               _pick_status(props.get("status") or []),
            "entity_type":          (props.get("summary") or [None])[0],
            "registration_number":  (props.get("registrationNumber") or [None])[0],
            "incorporation_date":   (props.get("incorporationDate") or [None])[0],
            "address":              (props.get("address") or [None])[0],
            "website":              (props.get("website") or [None])[0],
            "program_ids":          props.get("programId") or [],
            "notes":                _pick_note(props.get("notes") or []),
            "source_urls":          (props.get("sourceUrl") or [])[:3],
            "wikipedia_url":        (props.get("wikipediaUrl") or [None])[0],
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
    sanctioned_match_found = "sanction" in all_topics

    if all_topics:
        risk_classification = "POTENTIAL_MATCH"
        banner = "REVIEW REQUIRED: POTENTIAL MATCH"
    else:
        risk_classification = "CLEAN"
        banner = "PASSED: NO SANCTIONS OR ADVERSE MEDIA MATCH FOUND"

    wiki_url = next((m["wikipedia_url"] for m in matches if m.get("wikipedia_url")), None)
    wiki_extract = await fetch_wikipedia_extract(wiki_url) if wiki_url else None

    return {
        "ok": True,
        "subject_name": company_name,
        "risk_classification": risk_classification,
        "match_confidence": top_score,
        "sanctioned_match_found": sanctioned_match_found,
        "banner": banner,
        "summary": _build_summary(company_name, matches, all_topics, wiki_extract),
        "databases_checked": _per_database_status(matches),
        "matches": matches,
        "error": None,
    }


def _unavailable(company_name: str, reason: str) -> dict:
    return {
        "ok": False,
        "subject_name": company_name,
        "risk_classification": "UNAVAILABLE",
        "match_confidence": 0.0,
        "sanctioned_match_found": False,
        "banner": "SCREENING UNAVAILABLE",
        "summary": f"Screening could not be completed: {reason}",
        "databases_checked": [{**e, "status": "UNAVAILABLE"} for e in DATABASES_CHECKED],
        "matches": [],
        "error": reason,
    }
