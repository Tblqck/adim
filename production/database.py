"""
Supabase database layer via REST API (HTTPS).

Uses the Supabase PostgREST endpoint instead of a direct Postgres connection,
so EC2 instances without IPv6 routing can still reach Supabase.

Environment variables:
  SUPABASE_URL      e.g. https://zmthbjqrgkgpgvmxgdhd.supabase.co
  SUPABASE_KEY      service_role secret key (sb_secret_... or eyJ...)

Falls back gracefully if env vars are not set.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Optional

log = logging.getLogger(__name__)

try:
    import httpx
    _HTTPX_OK = True
except ImportError:
    _HTTPX_OK = False
    log.warning("httpx not installed — DB features disabled")


def _base_url() -> str:
    return os.getenv("SUPABASE_URL", "").rstrip("/")


def _headers() -> dict:
    key = os.getenv("SUPABASE_KEY", "")
    return {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


def _parse_date(s: Optional[str]) -> Optional[str]:
    """
    Best-effort parse of the date strings our OCR/MRZ paths actually
    produce — e.g. "07-09-1997", "07/09/1997", "1997-09-07", or the
    textual "15th Apr 2025" / "15 April 2025" style. Returns ISO
    'YYYY-MM-DD' or None if nothing matches (never raises).
    """
    if not s:
        return None
    import re
    from datetime import datetime

    s = s.strip()

    for fmt in ("%d.%m.%Y", "%d-%m-%Y", "%d/%m/%Y", "%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass

    # "15th Apr 2025" / "15 April 2025" — strip ordinal suffix first
    stripped = re.sub(r"(\d{1,2})(st|nd|rd|th)", r"\1", s, flags=re.IGNORECASE)
    for fmt in ("%d %b %Y", "%d %B %Y", "%d-%b-%Y", "%d-%B-%Y"):
        try:
            return datetime.strptime(stripped, fmt).date().isoformat()
        except ValueError:
            pass

    return None


def _parse_content_range(cr: Optional[str]) -> int:
    """Parse PostgREST's 'Content-Range: 0-24/117' header into the total (117)."""
    if not cr or "/" not in cr:
        return 0
    try:
        return int(cr.split("/", 1)[1])
    except ValueError:
        return 0


class _Database:
    def __init__(self):
        self._client: Optional["httpx.AsyncClient"] = None

    @property
    def available(self) -> bool:
        return _HTTPX_OK and bool(_base_url()) and bool(os.getenv("SUPABASE_KEY", ""))

    async def connect(self):
        if not _HTTPX_OK:
            log.warning("httpx not available — running without database")
            return
        if not self.available:
            log.warning("SUPABASE_URL / SUPABASE_KEY not set — running without database")
            return
        self._client = httpx.AsyncClient(
            base_url=_base_url(),
            headers=_headers(),
            timeout=10.0,
        )
        # Quick connectivity check
        try:
            r = await self._client.get("/rest/v1/countries?limit=1")
            r.raise_for_status()
            log.info("Supabase REST API connected (%s)", _base_url())
        except Exception as exc:
            log.warning("Supabase REST ping failed: %s — running without database", exc)
            await self._client.aclose()
            self._client = None

    async def disconnect(self):
        if self._client:
            await self._client.aclose()
            self._client = None

    # ── Blueprint lookup ──────────────────────────────────────────────────────

    async def fetch_blueprint(
        self,
        country_code: str,
        document_type: str,
        issue_year: int = 2020,
    ) -> Optional[dict]:
        if not self._client:
            return None
        params = {
            "country_code": f"eq.{country_code.upper()}",
            "document_type": f"eq.{document_type}",
            "status":        "eq.active",
            "order":         "id.desc",
            "limit":         "1",
            "select":        "id,fields,face_region,mrz_region,background_phash",
        }
        try:
            r = await self._client.get("/rest/v1/document_blueprints", params=params)
            r.raise_for_status()
            rows = r.json()
            if not rows:
                return None
            row = rows[0]
            for key in ("fields", "face_region", "mrz_region"):
                if isinstance(row.get(key), str):
                    row[key] = json.loads(row[key])
            return row
        except Exception as exc:
            log.warning("fetch_blueprint error: %s", exc)
            return None

    # ── Result write ──────────────────────────────────────────────────────────

    async def write_result(
        self,
        user_ref:       str,
        mode:           int,
        blueprint_id:   Optional[int],
        verified:       bool,
        confidence:     float,
        failure_reason: Optional[str],
    ) -> Optional[int]:
        if not self._client:
            return None
        payload = {
            "user_ref":           user_ref,
            "verification_mode":  mode,
            "blueprint_id":       blueprint_id,
            "verified":           verified,
            "confidence_score":   round(float(confidence), 4),
            "failure_reason":     failure_reason,
        }
        try:
            r = await self._client.post("/rest/v1/verification_results", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("write_result error: %s", exc)
            return None

    async def write_result_full(
        self,
        user_ref:       str,
        mode:           int,
        blueprint_id:   Optional[int],
        verified:       bool,
        confidence:     float,
        failure_reason: Optional[str],
        country:        Optional[str] = None,
        doc_type:       Optional[str] = None,
        overall_verdict: Optional[str] = None,
        face_match_score:      Optional[float] = None,
        face_match_verdict:    Optional[str]   = None,
        liveness_score:        Optional[float] = None,
        liveness_verdict:      Optional[str]   = None,
        liveness_method:       Optional[str]   = None,
        document_match_score:  Optional[float] = None,
        document_match_verdict: Optional[str]  = None,
        mrz_verdict:           Optional[str]   = None,
        forensics_verdict:     Optional[str]   = None,
        forensics_ela_score:   Optional[float] = None,
        forensics_risk_flags:  Optional[list]  = None,
        ocr_word_count:        Optional[int]   = None,
    ) -> Optional[int]:
        """
        Same as write_result(), plus the admin-dashboard columns that are
        known at insert time (country/doc_type/overall_verdict) and the
        per-model scores — all computed synchronously in verify.py before
        this is called, so they don't need the background admin-data patch.
        """
        if not self._client:
            return None
        payload = {
            "user_ref":           user_ref,
            "verification_mode":  mode,
            "blueprint_id":       blueprint_id,
            "verified":           verified,
            "confidence_score":   round(float(confidence), 4),
            "failure_reason":     failure_reason,
            "country":            country.upper() if country else None,
            "doc_type":           doc_type,
            "overall_verdict":    overall_verdict,
            "face_match_score":       face_match_score,
            "face_match_verdict":     face_match_verdict,
            "liveness_score":         liveness_score,
            "liveness_verdict":       liveness_verdict,
            "liveness_method":        liveness_method,
            "document_match_score":   document_match_score,
            "document_match_verdict": document_match_verdict,
            "mrz_verdict":            mrz_verdict,
            "forensics_verdict":      forensics_verdict,
            "forensics_ela_score":    forensics_ela_score,
            "forensics_risk_flags":   forensics_risk_flags,
            "ocr_word_count":         ocr_word_count,
        }
        try:
            r = await self._client.post("/rest/v1/verification_results", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("write_result_full error: %s", exc)
            return None

    async def update_admin_fields(self, result_id: Optional[int], **fields) -> None:
        """
        PATCH admin-dashboard columns (pipeline_response, forensics_result,
        pep_result, image paths) onto an existing verification_results row.
        Fire-and-forget from a background thread — never raises, no-ops if
        result_id is missing or the DB isn't configured.
        """
        if not self._client or result_id is None or not fields:
            return
        try:
            r = await self._client.patch(
                "/rest/v1/verification_results",
                params={"id": f"eq.{result_id}"},
                json=fields,
                headers={"Prefer": "return=minimal"},
            )
            r.raise_for_status()
        except Exception as exc:
            log.warning("update_admin_fields error (result_id=%s): %s", result_id, exc)

    async def write_extracted(
        self,
        result_id: int,
        ocr: dict,
        field_sources: Optional[dict] = None,
    ):
        if not self._client or result_id is None:
            return

        surname     = ocr.get("surname")
        given_names = ocr.get("given_names")
        full_name   = ocr.get("full_name") or " ".join(filter(None, [given_names, surname])) or None

        payload = {
            "verification_result_id": result_id,
            "full_name":     full_name,
            "surname":       surname,
            "given_names":   given_names,
            "date_of_birth": _parse_date(ocr.get("dob") or ocr.get("date_of_birth")),
            "issue_date":    _parse_date(ocr.get("issue_date")),
            "id_number":     ocr.get("id_number"),
            "nationality":   ocr.get("nationality"),
            "expiry_date":   _parse_date(ocr.get("expiry") or ocr.get("expiry_date")),
            "raw_fields":    ocr,
            "field_sources": field_sources,
        }
        try:
            r = await self._client.post("/rest/v1/extracted_id_data", json=payload)
            r.raise_for_status()
        except Exception as exc:
            log.warning("write_extracted error: %s", exc)

    # ── Admin dashboard queries ─────────────────────────────────────────────────

    async def list_results(
        self,
        page:       int = 1,
        page_size:  int = 25,
        verified:   Optional[bool] = None,
        verdict:    Optional[str]  = None,
        country:    Optional[str]  = None,
        doc_type:   Optional[str]  = None,
        date_from:  Optional[str]  = None,
        date_to:    Optional[str]  = None,
        q:          Optional[str]  = None,
    ) -> dict:
        """
        Paginated, filterable verification_results for the admin list view.
        Returns {"items": [...], "total": int}. Rows are lightweight —
        no pipeline_response/forensics_result/pep_result JSONB blobs.
        """
        if not self._client:
            return {"items": [], "total": 0}

        params: dict = {
            "select": "id,user_ref,verification_mode,verified,confidence_score,failure_reason,"
                      "country,doc_type,overall_verdict,created_at,"
                      "extracted_id_data(full_name,id_number,date_of_birth,nationality)",
            "order":  "created_at.desc",
            "limit":  str(page_size),
            "offset": str((page - 1) * page_size),
        }
        if verified is not None:
            params["verified"] = f"eq.{str(verified).lower()}"
        if verdict:
            params["overall_verdict"] = f"eq.{verdict}"
        if country:
            params["country"] = f"eq.{country.upper()}"
        if doc_type:
            params["doc_type"] = f"eq.{doc_type}"
        if date_from or date_to:
            bounds = []
            if date_from:
                bounds.append(f"gte.{date_from}")
            if date_to:
                bounds.append(f"lte.{date_to}")
            params["created_at"] = bounds if len(bounds) > 1 else bounds[0]
        if q:
            safe = q.replace(",", "").replace("*", "")
            params["or"] = (
                f"(user_ref.ilike.*{safe}*,"
                f"extracted_id_data.full_name.ilike.*{safe}*,"
                f"extracted_id_data.id_number.ilike.*{safe}*)"
            )

        try:
            r = await self._client.get(
                "/rest/v1/verification_results",
                params=params,
                headers={"Prefer": "count=exact"},
            )
            r.raise_for_status()
            items = r.json()
            total = _parse_content_range(r.headers.get("content-range"))
            return {"items": items, "total": total}
        except Exception as exc:
            log.warning("list_results error: %s", exc)
            return {"items": [], "total": 0}

    async def get_result(self, result_id: int) -> Optional[dict]:
        """Full admin-detail row: base columns + JSONB blobs + extracted_id_data."""
        if not self._client:
            return None
        params = {
            "id":     f"eq.{result_id}",
            "select": "*,extracted_id_data(*)",
            "limit":  "1",
        }
        try:
            r = await self._client.get("/rest/v1/verification_results", params=params)
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("get_result error: %s", exc)
            return None

    async def review_result(
        self,
        result_id: int,
        reviewed_by: str,
        verified: Optional[bool] = None,
        corrected_fields: Optional[dict] = None,
    ) -> bool:
        """
        Admin approve/reject/correct action. corrected_fields is merged onto
        whatever was already recorded (never overwritten wholesale), so a
        reviewer correcting one field doesn't erase an earlier correction to
        another. The original OCR/MRZ values in extracted_id_data /
        pipeline_response are never touched — corrected_fields is purely an
        overlay the UI prefers when present.
        """
        if not self._client:
            return False

        existing = await self.get_result(result_id)
        if existing is None:
            return False

        merged_corrections = {**(existing.get("corrected_fields") or {}), **(corrected_fields or {})}

        fields: dict = {
            "reviewed":    True,
            "reviewed_by": reviewed_by,
        }
        if verified is not None:
            fields["verified"] = verified
        if corrected_fields:
            fields["corrected_fields"] = merged_corrections

        try:
            r = await self._client.patch(
                "/rest/v1/verification_results",
                params={"id": f"eq.{result_id}"},
                json=fields,
                headers={"Prefer": "return=minimal"},
            )
            r.raise_for_status()
            return True
        except Exception as exc:
            log.warning("review_result error (result_id=%s): %s", result_id, exc)
            return False

    # ── Pending review queue ──────────────────────────────────────────────────

    async def queue_pending(
        self,
        image_path:    str,
        country_hint:  str,
        doc_type_hint: str,
    ) -> Optional[int]:
        if not self._client:
            return None
        payload = {
            "flat_image_path":    image_path,
            "country_hint":       country_hint,
            "document_type_hint": doc_type_hint,
        }
        try:
            r = await self._client.post("/rest/v1/pending_review", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("queue_pending error: %s", exc)
            return None


# Singleton used by routers
db = _Database()
