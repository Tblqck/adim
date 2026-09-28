"""
Audit log for the admin dashboard: who did what, and when.

Two sources, merged into one newest-first feed (GET /api/v1/admin/audit):

1. Records the server already keeps for other reasons -- ad-hoc person and
   company screens and document checks (each stamped with who ran it),
   verifications received and moved to the bin, links generated and used.
   These need no schema change and go back as far as the data does.

2. audit_events (db/schema.sql, Migration 2026-09a) for the actions that
   leave no other trace: sign-ins (and failed ones), reviews, restores,
   permanent deletes, firm/employee/API-key changes, IP bans, template
   approvals. Written best-effort: an audit write never fails or slows the
   action it describes, and until the table exists they are skipped (one
   warning, re-checked every 10 minutes) while the feed still serves (1).

Only identifiers and outcomes are recorded -- never passwords, keys, tokens
or document contents.
"""

from __future__ import annotations

import asyncio
import logging
import re
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from production.database import db

log = logging.getLogger(__name__)

CATEGORIES = ("access", "verifications", "links", "screening", "account", "templates", "security")

# action -> category. Anything recorded must be listed here.
ACTIONS: dict[str, str] = {
    "login.success":            "access",
    "login.failed":             "access",
    "logout":                   "access",
    "verification.received":    "verifications",
    "verification.reviewed":    "verifications",
    "verification.binned":      "verifications",
    "verification.restored":    "verifications",
    "verification.deleted":     "verifications",
    "link.created":             "links",
    "link.used":                "links",
    "link.binned":              "links",
    "link.restored":            "links",
    "screen.person":            "screening",
    "screen.company":           "screening",
    "document.checked":         "screening",
    "firm.created":             "account",
    "firm.deleted":             "account",
    "user.created":             "account",
    "user.updated":             "account",
    "user.deleted":             "account",
    "api_key.rotated":          "account",
    "api_key.revoked":          "account",
    "template.approved":        "templates",
    "template.edited":          "templates",
    "template.renamed":         "templates",
    "template.deleted":         "templates",
    "template.backfilled":      "templates",
    "ip.banned":                "security",
    "ip.auto_banned":           "security",
    "ip.unbanned":              "security",
}

# ── Writing ──────────────────────────────────────────────────────────────────

_MISSING_RETRY_SECS = 600
_missing_since: Optional[float] = None
_pending: set[asyncio.Task] = set()
# Whether the last feed read found audit_events (None = not read yet).
_table_seen: Optional[bool] = None


async def _insert(row: dict) -> None:
    global _missing_since
    client = db._client
    if client is None:
        return
    if _missing_since is not None and time.monotonic() - _missing_since < _MISSING_RETRY_SECS:
        return
    try:
        r = await client.post("/rest/v1/audit_events", json=row, headers={"Prefer": "return=minimal"})
        if r.status_code == 404 or (r.status_code >= 400 and "audit_events" in r.text):
            if _missing_since is None:
                log.warning("audit_events table missing -- run Migration 2026-09a (db/schema.sql); audit writes skipped")
            _missing_since = time.monotonic()
            return
        r.raise_for_status()
        _missing_since = None
    except Exception as exc:
        log.warning("audit write failed (%s): %s", row.get("action"), exc)


def record(
    action: str,
    *,
    actor: Optional[str],
    actor_type: str = "user",
    firm_id: Optional[int] = None,
    target_type: Optional[str] = None,
    target_id: Any = None,
    summary: Optional[str] = None,
    detail: Optional[dict] = None,
    ip: Optional[str] = None,
) -> None:
    """Fire-and-forget: schedules the write and returns at once."""
    if action not in ACTIONS:
        log.warning("audit: unknown action %r not recorded", action)
        return
    row = {
        "action":      action,
        "actor":       (actor or None) and str(actor)[:255],
        "actor_type":  actor_type,
        "firm_id":     firm_id,
        "target_type": target_type,
        "target_id":   None if target_id is None else str(target_id)[:100],
        "summary":     summary[:300] if summary else None,
        "detail":      detail or None,
        "ip":          ip[:64] if ip else None,
    }
    try:
        task = asyncio.get_running_loop().create_task(_insert(row))
    except RuntimeError:
        return
    _pending.add(task)
    task.add_done_callback(_pending.discard)


# ── Reading ──────────────────────────────────────────────────────────────────

def _ts(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


_Q_SAFE = re.compile(r"[^\w @.\-']", re.UNICODE)


def _clean_q(q: Optional[str]) -> str:
    """PostgREST filter syntax uses , ( ) * " -- a search term keeps only
    characters that can never break out of the ilike pattern."""
    return _Q_SAFE.sub(" ", q or "").strip()[:80]


def _event(
    *, key: str, at: datetime, action: str, actor: Optional[str], actor_type: str,
    firm_id: Optional[int], target_type: Optional[str], target_id: Any,
    summary: Optional[str], outcome: Optional[str] = None, ip: Optional[str] = None,
    detail: Optional[dict] = None, recorded: bool = False,
) -> dict:
    return {
        "id":          key,
        "at":          _iso(at),
        "action":      action,
        "category":    ACTIONS.get(action, "security"),
        "actor":       actor,
        "actor_type":  actor_type,
        "firm_id":     firm_id,
        "target_type": target_type,
        "target_id":   None if target_id is None else str(target_id),
        "summary":     summary,
        "outcome":     outcome,
        "ip":          ip,
        "detail":      detail,
        "recorded":    recorded,  # False = derived from another table
    }


class _Source:
    """One PostgREST query that yields events, newest first, by one timestamp column."""

    def __init__(self, name, table, time_col, select, build, search_cols, extra=None):
        self.name = name
        self.table = table
        self.time_col = time_col
        self.select = select
        self.build = build
        self.search_cols = search_cols
        self.extra = extra or []


def _risk_outcome(risk: Optional[str]) -> Optional[str]:
    if not risk:
        return None
    r = risk.lower()
    if r in ("clear", "no_match", "low", "none"):
        return "ok"
    if r in ("error", "unavailable"):
        return "error"
    return "warning"


def _verdict_outcome(verdict: Optional[str]) -> Optional[str]:
    if not verdict:
        return None
    v = verdict.lower()
    if v in ("verified", "pass", "passed", "approved", "match"):
        return "ok"
    if v in ("error", "failed_processing"):
        return "error"
    return "warning"


def _doc_label(doc_type: Optional[str], country: Optional[str]) -> str:
    label = (doc_type or "document").replace("_", " ")
    return f"{country} {label}" if country else label


_SOURCES: list[_Source] = [
    _Source(
        "adhoc_screenings", "adhoc_screenings", "created_at",
        "id,created_at,searched_name,nationality,risk_classification,searched_by,firm_id",
        lambda r, at: _event(
            key=f"s:{r['id']}", at=at, action="screen.person", actor=r.get("searched_by"), actor_type="user",
            firm_id=r.get("firm_id"), target_type="person", target_id=None,
            summary=f"Screened {r.get('searched_name') or 'a person'}" + (f" ({r['nationality']})" if r.get("nationality") else ""),
            outcome=_risk_outcome(r.get("risk_classification")),
            detail={"risk": r.get("risk_classification")},
        ),
        ["searched_name", "searched_by"],
    ),
    _Source(
        "adhoc_kyb_screenings", "adhoc_kyb_screenings", "created_at",
        "id,created_at,company_name,jurisdiction,risk_classification,searched_by,firm_id",
        lambda r, at: _event(
            key=f"k:{r['id']}", at=at, action="screen.company", actor=r.get("searched_by"), actor_type="user",
            firm_id=r.get("firm_id"), target_type="company", target_id=None,
            summary=f"Screened company {r.get('company_name') or ''}".strip() + (f" ({r['jurisdiction']})" if r.get("jurisdiction") else ""),
            outcome=_risk_outcome(r.get("risk_classification")),
            detail={"risk": r.get("risk_classification")},
        ),
        ["company_name", "searched_by"],
    ),
    _Source(
        "adhoc_document_checks", "adhoc_document_checks", "created_at",
        "id,created_at,country,doc_type,full_name,forensics_verdict,pep_risk_classification,checked_by,firm_id",
        lambda r, at: _event(
            key=f"d:{r['id']}", at=at, action="document.checked", actor=r.get("checked_by"), actor_type="user",
            firm_id=r.get("firm_id"), target_type="document", target_id=None,
            summary=f"Checked a {_doc_label(r.get('doc_type'), r.get('country'))}" + (f" · {r['full_name']}" if r.get("full_name") else ""),
            outcome=_verdict_outcome(r.get("forensics_verdict")),
            detail={"forensics": r.get("forensics_verdict"), "pep_risk": r.get("pep_risk_classification")},
        ),
        ["full_name", "checked_by"],
    ),
    _Source(
        "results_received", "verification_results", "created_at",
        "id,created_at,user_ref,overall_verdict,country,doc_type,firm_id",
        lambda r, at: _event(
            key=f"v:{r['id']}", at=at, action="verification.received", actor=r.get("user_ref"), actor_type="applicant",
            firm_id=r.get("firm_id"), target_type="verification", target_id=r["id"],
            summary=f"Verification #{r['id']} received · {_doc_label(r.get('doc_type'), r.get('country'))}",
            outcome=_verdict_outcome(r.get("overall_verdict")),
            detail={"verdict": r.get("overall_verdict")},
        ),
        ["user_ref"],
    ),
    _Source(
        "results_binned", "verification_results", "deleted_at",
        "id,deleted_at,user_ref,firm_id",
        lambda r, at: _event(
            key=f"vb:{r['id']}", at=at, action="verification.binned", actor=None, actor_type="user",
            firm_id=r.get("firm_id"), target_type="verification", target_id=r["id"],
            summary=f"Verification #{r['id']} moved to the recycle bin",
        ),
        ["user_ref"],
        [("deleted_at", "not.is.null")],
    ),
    _Source(
        "links_created", "verification_sessions", "created_at",
        "id,created_at,user_ref,firm_id",
        lambda r, at: _event(
            key=f"l:{r['id']}", at=at, action="link.created", actor=None, actor_type="user",
            firm_id=r.get("firm_id"), target_type="link", target_id=r["id"],
            summary="Verification link generated" + (f" for {r['user_ref']}" if r.get("user_ref") else ""),
        ),
        ["user_ref"],
    ),
    _Source(
        "links_used", "verification_sessions", "used_at",
        "id,used_at,user_ref,firm_id",
        lambda r, at: _event(
            key=f"lu:{r['id']}", at=at, action="link.used", actor=r.get("user_ref"), actor_type="applicant",
            firm_id=r.get("firm_id"), target_type="link", target_id=r["id"],
            summary="Applicant completed a verification link", outcome="ok",
        ),
        ["user_ref"],
        [("used_at", "not.is.null")],
    ),
    _Source(
        "links_binned", "verification_sessions", "deleted_at",
        "id,deleted_at,user_ref,firm_id",
        lambda r, at: _event(
            key=f"lb:{r['id']}", at=at, action="link.binned", actor=None, actor_type="user",
            firm_id=r.get("firm_id"), target_type="link", target_id=r["id"],
            summary="Verification link moved to the recycle bin" + (f" ({r['user_ref']})" if r.get("user_ref") else ""),
        ),
        ["user_ref"],
        [("deleted_at", "not.is.null")],
    ),
    _Source(
        "audit_events", "audit_events", "created_at",
        "id,created_at,action,actor,actor_type,firm_id,target_type,target_id,summary,detail,ip",
        lambda r, at: _event(
            key=f"a:{r['id']}", at=at, action=r.get("action") or "", actor=r.get("actor"),
            actor_type=r.get("actor_type") or "user", firm_id=r.get("firm_id"),
            target_type=r.get("target_type"), target_id=r.get("target_id"), summary=r.get("summary"),
            outcome=(r.get("detail") or {}).get("outcome") if isinstance(r.get("detail"), dict) else None,
            ip=r.get("ip"), detail=r.get("detail"), recorded=True,
        ),
        ["actor", "summary", "target_id"],
    ),
]


async def _fetch(src: _Source, *, firm_id, before, date_from, date_to, q, limit, actions) -> list[dict]:
    client = db._client
    if client is None:
        return []
    params: list[tuple[str, str]] = [
        ("select", src.select),
        ("order", f"{src.time_col}.desc"),
        ("limit", str(limit)),
        *src.extra,
    ]
    bounds = []
    if before:
        bounds.append(f"{src.time_col}.lt.{before}")
    if date_from:
        bounds.append(f"{src.time_col}.gte.{date_from.isoformat()}")
    if date_to:
        bounds.append(f"{src.time_col}.lt.{(date_to + timedelta(days=1)).isoformat()}")
    if bounds:
        params.append(("and", f"({','.join(bounds)})"))
    if firm_id is not None:
        params.append(("firm_id", f"eq.{firm_id}"))
    if q:
        params.append(("or", "(" + ",".join(f'{c}.ilike."*{q}*"' for c in src.search_cols) + ")"))
    if src.table == "audit_events" and actions:
        params.append(("action", f"in.({','.join(actions)})"))
    try:
        r = await client.get(f"/rest/v1/{src.table}", params=params)
        if src.table == "audit_events":
            global _table_seen
            _table_seen = r.status_code == 200
            if not _table_seen:
                return []
        r.raise_for_status()
        rows = r.json()
    except Exception as exc:
        log.warning("audit feed source %s failed: %s", src.name, exc)
        return []
    out = []
    for row in rows:
        at = _ts(row.get(src.time_col))
        if at is not None:
            out.append(src.build(row, at))
    return out


def _dedupe(events: list[dict]) -> list[dict]:
    """A recorded event (it knows who did it) replaces the derived one for the
    same action on the same target -- e.g. a bin move seen both in
    audit_events and in verification_results.deleted_at."""
    recorded = {}
    for e in events:
        if e["recorded"] and e["target_id"] is not None:
            recorded.setdefault((e["action"], e["target_type"], e["target_id"]), []).append(_ts(e["at"]))
    out = []
    for e in events:
        if not e["recorded"] and e["target_id"] is not None:
            times = recorded.get((e["action"], e["target_type"], e["target_id"]))
            at = _ts(e["at"])
            if times and any(abs((t - at).total_seconds()) < 180 for t in times if t and at):
                continue
        out.append(e)
    return out


async def feed(
    *,
    firm_id: Optional[int],
    category: Optional[str] = None,
    action: Optional[str] = None,
    before: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    q: Optional[str] = None,
    limit: int = 50,
) -> dict:
    before_dt = _ts(before) if before else None
    before_s = _iso(before_dt) if before_dt else None
    q_s = _clean_q(q)

    if action and action in ACTIONS:
        actions = [action]
    elif category in CATEGORIES:
        actions = [a for a, c in ACTIONS.items() if c == category]
    else:
        actions = None

    sources = []
    for src in _SOURCES:
        if src.table == "audit_events":
            sources.append(src)
            continue
        if actions is not None and _source_action(src) not in actions:
            continue
        sources.append(src)

    # A little over the page from each source so the dedupe can't leave the page short.
    per_source = limit + 10
    chunks = await asyncio.gather(*[
        _fetch(s, firm_id=firm_id, before=before_s, date_from=date_from, date_to=date_to,
               q=q_s, limit=per_source, actions=actions)
        for s in sources
    ])
    events = _dedupe([e for chunk in chunks for e in chunk])
    events.sort(key=lambda e: e["at"], reverse=True)
    page = events[:limit]
    more = len(events) > limit or any(len(c) >= per_source for c in chunks)
    return {
        "items":        page,
        "next_before":  page[-1]["at"] if page and more else None,
        "recording":    bool(_table_seen),
        "categories":   list(CATEGORIES),
        "actions":      ACTIONS,
    }


_SOURCE_ACTION = {
    "adhoc_screenings":      "screen.person",
    "adhoc_kyb_screenings":  "screen.company",
    "adhoc_document_checks": "document.checked",
    "results_received":      "verification.received",
    "results_binned":        "verification.binned",
    "links_created":         "link.created",
    "links_used":            "link.used",
    "links_binned":          "link.binned",
}


def _source_action(src: _Source) -> str:
    return _SOURCE_ACTION[src.name]

