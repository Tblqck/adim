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
        firm_id:               Optional[int]   = None,
    ) -> Optional[int]:
        """
        Same as write_result(), plus the admin-dashboard columns that are
        known at insert time (country/doc_type/overall_verdict) and the
        per-model scores — all computed synchronously in verify.py before
        this is called, so they don't need the background admin-data patch.

        firm_id is resolved by ApiKeyMiddleware from the caller's
        X-Client-Id/X-Api-Key and threaded down from verify.py — None means
        the legacy single API_KEY was used (no firm attached).
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
            "firm_id":            firm_id,
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
        firm_id:    Optional[int]  = None,
    ) -> dict:
        """
        Paginated, filterable verification_results for the admin list view.
        Returns {"items": [...], "total": int}. Rows are lightweight —
        no pipeline_response/forensics_result/pep_result JSONB blobs.

        firm_id: None means "no filter" (super-admin viewing all firms).
        Callers must never let a firm-scoped session pass anything other
        than its own firm_id here — that's enforced in the router, not here.
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
        if firm_id is not None:
            params["firm_id"] = f"eq.{firm_id}"
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
            # PostgREST rejects an or=() filter that mixes a base-table column
            # with a joined/embedded-resource column (400 Bad Request) — the
            # embedded reference has to be resolved as its own query first,
            # then folded into the base-table filter as an id.in.(...) list.
            name_match_ids: list = []
            try:
                r_names = await self._client.get(
                    "/rest/v1/extracted_id_data",
                    params={
                        "select": "verification_result_id",
                        "or": f"(full_name.ilike.*{safe}*,id_number.ilike.*{safe}*)",
                    },
                )
                r_names.raise_for_status()
                name_match_ids = [row["verification_result_id"] for row in r_names.json()]
            except Exception as exc:
                log.warning("list_results name/id_number sub-search failed: %s", exc)

            or_parts = [f"user_ref.ilike.*{safe}*"]
            if name_match_ids:
                or_parts.append(f"id.in.({','.join(str(i) for i in name_match_ids)})")
            params["or"] = f"({','.join(or_parts)})"

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

    async def get_result(self, result_id: int, firm_id: Optional[int] = None) -> Optional[dict]:
        """Full admin-detail row: base columns + JSONB blobs + extracted_id_data.

        firm_id filters the lookup itself (not just the list view) — without
        this, a firm-scoped session could read any other firm's record by
        guessing/incrementing result_id. None means no filter (super-admin)."""
        if not self._client:
            return None
        params = {
            "id":     f"eq.{result_id}",
            "select": "*,extracted_id_data(*)",
            "limit":  "1",
        }
        if firm_id is not None:
            params["firm_id"] = f"eq.{firm_id}"
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
        firm_id: Optional[int] = None,
    ) -> bool:
        """
        Admin approve/reject/correct action. corrected_fields is merged onto
        whatever was already recorded (never overwritten wholesale), so a
        reviewer correcting one field doesn't erase an earlier correction to
        another. The original OCR/MRZ values in extracted_id_data /
        pipeline_response are never touched — corrected_fields is purely an
        overlay the UI prefers when present.

        firm_id (None = super-admin) scopes both the existence check and the
        patch itself, so a firm-scoped session can't review another firm's
        record by guessing its id.
        """
        if not self._client:
            return False

        existing = await self.get_result(result_id, firm_id=firm_id)
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

        patch_params: dict = {"id": f"eq.{result_id}"}
        if firm_id is not None:
            patch_params["firm_id"] = f"eq.{firm_id}"

        try:
            r = await self._client.patch(
                "/rest/v1/verification_results",
                params=patch_params,
                json=fields,
                headers={"Prefer": "return=minimal"},
            )
            r.raise_for_status()
            return True
        except Exception as exc:
            log.warning("review_result error (result_id=%s): %s", result_id, exc)
            return False

    # ── Ad-hoc PEP/sanctions screenings (name-only, no document) ─────────────

    async def log_adhoc_screening(
        self,
        searched_name: str,
        date_of_birth: Optional[str],
        nationality:   Optional[str],
        result:        dict,
        searched_by:   Optional[str] = None,
        firm_id:       Optional[int] = None,
    ) -> Optional[int]:
        if not self._client:
            return None
        payload = {
            "searched_name":       searched_name,
            "date_of_birth":       _parse_date(date_of_birth),
            "nationality":         nationality.upper() if nationality else None,
            "risk_classification": result.get("risk_classification"),
            "match_confidence":    result.get("match_confidence"),
            "result":              result,
            "searched_by":         searched_by,
            "firm_id":             firm_id,
        }
        try:
            r = await self._client.post("/rest/v1/adhoc_screenings", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("log_adhoc_screening error: %s", exc)
            return None

    # ── Ad-hoc KYB (company) sanctions/adverse-media screenings ──────────────

    async def log_adhoc_kyb_screen(
        self,
        company_name:         str,
        jurisdiction:         Optional[str],
        result:               dict,
        registration_number:  Optional[str] = None,
        searched_by:          Optional[str] = None,
        firm_id:              Optional[int] = None,
    ) -> Optional[int]:
        if not self._client:
            return None
        payload = {
            "company_name":        company_name,
            "jurisdiction":        jurisdiction.upper() if jurisdiction else None,
            "registration_number": registration_number,
            "risk_classification": result.get("risk_classification"),
            "match_confidence":    result.get("match_confidence"),
            "result":              result,
            "searched_by":         searched_by,
            "firm_id":             firm_id,
        }
        try:
            r = await self._client.post("/rest/v1/adhoc_kyb_screenings", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("log_adhoc_kyb_screen error: %s", exc)
            return None

    # ── Ad-hoc document authenticity + PEP checks (no selfie/liveness) ───────

    async def log_adhoc_document_check(
        self,
        country:                Optional[str],
        doc_type:               str,
        full_name:              str,
        mrz_verdict:            Optional[str],
        document_match_verdict: Optional[str],
        forensics_verdict:      Optional[str],
        pep_result:             dict,
        result:                 dict,
        checked_by:             Optional[str] = None,
        firm_id:                Optional[int] = None,
    ) -> Optional[int]:
        if not self._client:
            return None
        payload = {
            "country":                 country.upper() if country else None,
            "doc_type":                doc_type,
            "full_name":               full_name or None,
            "mrz_verdict":             mrz_verdict,
            "document_match_verdict":  document_match_verdict,
            "forensics_verdict":       forensics_verdict,
            "pep_risk_classification": pep_result.get("risk_classification"),
            "result":                  result,
            "checked_by":              checked_by,
            "firm_id":                 firm_id,
        }
        try:
            r = await self._client.post("/rest/v1/adhoc_document_checks", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0]["id"] if rows else None
        except Exception as exc:
            log.warning("log_adhoc_document_check error: %s", exc)
            return None

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

    # ── Firms (multi-tenant API clients) ──────────────────────────────────────

    async def get_firm_by_slug(self, slug: str) -> Optional[dict]:
        """Used by both admin login (dashboard password) and ApiKeyMiddleware
        (data-plane API key) — both hashes live on the same row."""
        if not self._client:
            return None
        try:
            r = await self._client.get(
                "/rest/v1/firms",
                params={"slug": f"eq.{slug}", "limit": "1"},
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("get_firm_by_slug error: %s", exc)
            return None

    async def list_firms(self) -> list:
        if not self._client:
            return []
        try:
            r = await self._client.get(
                "/rest/v1/firms",
                params={"select": "id,name,slug,active,created_at", "order": "name.asc"},
            )
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log.warning("list_firms error: %s", exc)
            return []

    async def create_firm(
        self,
        name: str,
        slug: str,
        admin_password_hash: str,
        admin_password_salt: str,
        api_key_hash: str,
    ) -> Optional[dict]:
        if not self._client:
            return None
        payload = {
            "name":                 name,
            "slug":                 slug,
            "admin_password_hash":  admin_password_hash,
            "admin_password_salt":  admin_password_salt,
            "api_key_hash":         api_key_hash,
        }
        try:
            r = await self._client.post("/rest/v1/firms", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("create_firm error: %s", exc)
            return None

    # ── Super-admin accounts ──────────────────────────────────────────────────

    async def get_admin_user_by_username(self, username: str) -> Optional[dict]:
        if not self._client:
            return None
        try:
            r = await self._client.get(
                "/rest/v1/admin_users",
                params={"username": f"eq.{username}", "limit": "1"},
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("get_admin_user_by_username error: %s", exc)
            return None

    # ── Verification sessions (Generate Link single-use tokens) ──────────────

    async def create_session(
        self,
        token:      str,
        firm_id:    int,
        expires_at: str,
        user_ref:   Optional[str] = None,
    ) -> Optional[dict]:
        if not self._client:
            return None
        payload = {
            "token":      token,
            "firm_id":    firm_id,
            "user_ref":   user_ref,
            "expires_at": expires_at,
        }
        try:
            r = await self._client.post("/rest/v1/verification_sessions", json=payload)
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("create_session error: %s", exc)
            return None

    async def get_session_by_token(self, token: str) -> Optional[dict]:
        if not self._client:
            return None
        try:
            r = await self._client.get(
                "/rest/v1/verification_sessions",
                params={"token": f"eq.{token}", "limit": "1"},
            )
            r.raise_for_status()
            rows = r.json()
            return rows[0] if rows else None
        except Exception as exc:
            log.warning("get_session_by_token error: %s", exc)
            return None

    async def mark_session_used(self, token: str) -> bool:
        """Best-effort single-use enforcement: only flips pending -> used, so
        a race between two concurrent requests for the same token can't both
        succeed (PostgREST's eq. filter on status means the second PATCH
        matches zero rows once the first has already flipped it)."""
        if not self._client:
            return False
        from datetime import datetime
        try:
            r = await self._client.patch(
                "/rest/v1/verification_sessions",
                params={"token": f"eq.{token}", "status": "eq.pending"},
                json={"status": "used", "used_at": datetime.utcnow().isoformat() + "Z"},
                headers={"Prefer": "return=representation"},
            )
            r.raise_for_status()
            rows = r.json()
            return bool(rows)
        except Exception as exc:
            log.warning("mark_session_used error: %s", exc)
            return False

    async def list_sessions(self, firm_id: Optional[int] = None, limit: int = 25) -> list:
        if not self._client:
            return []
        params: dict = {
            "select": "id,token,user_ref,status,expires_at,created_at,used_at,firm_id",
            "order":  "created_at.desc",
            "limit":  str(limit),
        }
        if firm_id is not None:
            params["firm_id"] = f"eq.{firm_id}"
        try:
            r = await self._client.get("/rest/v1/verification_sessions", params=params)
            r.raise_for_status()
            return r.json()
        except Exception as exc:
            log.warning("list_sessions error: %s", exc)
            return []


# Singleton used by routers
db = _Database()
