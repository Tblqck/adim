"""
Admin API — list & detail endpoints for the verification dashboard.

Every route requires an authenticated admin session (production/api/routers
/admin_auth.py) and a configured Supabase connection — there is no offline
mode here: the dashboard is meaningless without persisted history.
"""

from __future__ import annotations

import logging
import os
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Any, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel

from production.api.routers.admin_auth import (
    generate_api_key, hash_api_key, hash_password, require_admin,
    require_admin_or_firm_key, router as auth_router,
)
from production.database import db
from production.storage import storage

log = logging.getLogger(__name__)

_COUNTRY_CODE_RE = re.compile(r"^[A-Za-z]{2}$")
_VALID_DOC_TYPES = {"passport", "national_id", "drivers_license", "residence_permit"}

router = APIRouter(tags=["admin"])
router.include_router(auth_router)


def _require_db() -> None:
    if not db.available:
        raise HTTPException(503, "Database not configured (SUPABASE_URL/SUPABASE_KEY unset)")


def _effective_firm_id(session: dict, requested_firm_id: Optional[int] = None) -> Optional[int]:
    """A firm-scoped session is always confined to its own firm_id, full
    stop — it can never override this via a request param. Only a
    super_admin session may pass an explicit firm_id (the dashboard's firm
    filter dropdown); omitting it means "all firms"."""
    if "firm_id" in session:
        return session["firm_id"]
    return requested_firm_id


@router.get("/verifications")
async def list_verifications(
    session:   dict            = Depends(require_admin),
    page:      int            = Query(1, ge=1),
    page_size: int            = Query(25, ge=1, le=100),
    verified:  Optional[bool] = None,
    verdict:   Optional[str]  = None,
    country:   Optional[str]  = None,
    doc_type:  Optional[str]  = None,
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    q:         Optional[str]  = None,
    firm_id:   Optional[int]  = None,
):
    _require_db()
    result = await db.list_results(
        page=page, page_size=page_size,
        verified=verified, verdict=verdict, country=country, doc_type=doc_type,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        q=q,
        firm_id=_effective_firm_id(session, firm_id),
    )
    return {
        "items":     result["items"],
        "total":     result["total"],
        "page":      page,
        "page_size": page_size,
    }


@router.get("/verifications/{result_id}")
async def get_verification(result_id: int, session: dict = Depends(require_admin)):
    _require_db()
    row = await db.get_result(result_id, firm_id=_effective_firm_id(session))
    if row is None:
        raise HTTPException(404, "Verification not found")

    # Resolve stored object paths to short-lived signed URLs at request time —
    # never return or persist bare paths / permanent URLs to the client.
    images: dict = {}
    if row.get("id_front_path"):
        images["id_front_url"] = await storage.signed_url(row["id_front_path"])
    if row.get("id_back_path"):
        images["id_back_url"] = await storage.signed_url(row["id_back_path"])
    face_paths = row.get("face_frame_paths") or []
    if face_paths:
        urls = [await storage.signed_url(p) for p in face_paths]
        images["face_urls"] = [u for u in urls if u]

    row["images"] = images
    for key in ("id_front_path", "id_back_path", "face_frame_paths"):
        row.pop(key, None)

    return row


class ReviewUpdate(BaseModel):
    reviewed_by:      str
    verified:         Optional[bool]           = None
    corrected_fields: Optional[dict[str, Any]] = None


@router.patch("/verifications/{result_id}")
async def review_verification(result_id: int, body: ReviewUpdate, session: dict = Depends(require_admin)):
    """
    Approve/reject/correct a verification. Never mutates the original
    OCR/MRZ extraction — corrected_fields is stored as a separate overlay
    so the raw model output stays auditable.
    """
    _require_db()
    ok = await db.review_result(
        result_id,
        reviewed_by=body.reviewed_by,
        verified=body.verified,
        corrected_fields=body.corrected_fields,
        firm_id=_effective_firm_id(session),
    )
    if not ok:
        raise HTTPException(404, "Verification not found or update failed")
    return {"ok": True}


class ScreenRequest(BaseModel):
    given_names:   str
    surname:       str
    date_of_birth: Optional[str] = None
    nationality:   Optional[str] = None
    searched_by:   Optional[str] = None
    firm_id:       Optional[int] = None  # super-admin only — attributes the audit row to a firm


@router.post("/screen")
async def screen_name(body: ScreenRequest, session: dict = Depends(require_admin)):
    """
    Standalone PEP & sanctions screen — no document, no verification_results
    row. Admin types a name (+ optional DOB/nationality to sharpen the
    match), we call the same OpenSanctions screen() used by the automated
    pipeline, and log the search for audit purposes.
    """
    full_name = " ".join(filter(None, [body.given_names.strip(), body.surname.strip()])).strip()
    if not full_name:
        raise HTTPException(400, "given_names and/or surname required")

    from production.core.pep_screen import screen as pep_screen_call
    result = await pep_screen_call(full_name, body.date_of_birth, body.nationality)

    if db.available:
        await db.log_adhoc_screening(
            full_name, body.date_of_birth, body.nationality, result,
            searched_by=body.searched_by,
            firm_id=_effective_firm_id(session, body.firm_id),
        )

    return result


class ScreenCompanyRequest(BaseModel):
    company_name:         str
    jurisdiction:         Optional[str] = None
    registration_number:  Optional[str] = None
    searched_by:          Optional[str] = None
    firm_id:              Optional[int] = None  # super-admin only — attributes the audit row to a firm


@router.post("/screen-company")
async def screen_company(body: ScreenCompanyRequest, session: dict = Depends(require_admin)):
    """
    KYB — standalone company sanctions & adverse-media screen, no document,
    no verification_results row. Same OpenSanctions Match API as
    screen_name() above, matched against the Company schema instead of
    Person. Logged for audit purposes.
    """
    company_name = body.company_name.strip()
    if not company_name:
        raise HTTPException(400, "company_name required")

    from production.core.kyb_screen import screen as kyb_screen_call
    result = await kyb_screen_call(company_name, body.jurisdiction, body.registration_number)

    if db.available:
        await db.log_adhoc_kyb_screen(
            company_name, body.jurisdiction, result,
            registration_number=body.registration_number,
            searched_by=body.searched_by,
            firm_id=_effective_firm_id(session, body.firm_id),
        )

    return result


@router.get("/databases-catalog")
async def databases_catalog(session: dict = Depends(require_admin)):
    """
    Reference catalog backing the admin 'Databases' registry page — the same
    PEP / Sanctions / Adverse-Media entries returned per-search in
    'databases_checked' (see screen_name / screen_company above), so the
    registry page and every individual search result stay in sync by
    construction instead of via two hand-maintained lists.
    """
    from production.core.db_catalog import PEP_DATABASES, SANCTIONS_DATABASES, ADVERSE_MEDIA_DATABASES
    return {
        "pep":           PEP_DATABASES,
        "sanctions":     SANCTIONS_DATABASES,
        "adverse_media": ADVERSE_MEDIA_DATABASES,
    }


@router.post("/document-check")
async def document_check(
    country:       str                 = Form(..., description="ISO alpha-2 country code, e.g. 'NG'"),
    doc_type:      str                 = Form(..., description="'passport' | 'national_id' | 'drivers_license' | 'residence_permit'"),
    id_image:      UploadFile          = File(...,  description="Document front / bio-data page image"),
    id_image_back: Optional[UploadFile] = File(None, description="Document back, if applicable"),
    checked_by:    Optional[str]       = Form(None),
    firm_id:       Optional[int]       = Form(None, description="super-admin only — attributes the audit row to a firm"),
    session:       dict                = Depends(require_admin),
):
    """
    Standalone document authenticity + PEP check — no selfie/liveness, since
    the admin is checking a document on file rather than a live person.
    Passports run MRZ checksum validation; card documents (national_id/
    drivers_license/residence_permit) run the same reference-image match +
    template-free OCR extraction as the client-facing pipeline. Both branches
    run forensics (EXIF/ELA tamper analysis) and a PEP/sanctions screen on
    the extracted name. Logged to its own audit table, never to
    verification_results — this is an admin spot-check, not a client
    onboarding event.
    """
    if not _COUNTRY_CODE_RE.match(country):
        raise HTTPException(400, "country must be a 2-letter ISO alpha-2 code")
    if doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(400, f"doc_type must be one of {sorted(_VALID_DOC_TYPES)}")

    id_bytes = await id_image.read()
    if not id_bytes:
        raise HTTPException(400, "id_image is empty")
    _ = await id_image_back.read() if id_image_back else None  # accepted, not scored (matches verify.py precedent)

    from production.core.forensics import analyze as _analyze_forensics
    forensics_result = _analyze_forensics(id_bytes)

    mrz_result: Optional[dict] = None
    doc_result: Optional[dict] = None
    ocr_fields: dict = {}

    if doc_type == "passport":
        import base64
        try:
            from production.matcher.mrz import verify_passport as _mrz_verify
            mrz_result = _mrz_verify("data:image/jpeg;base64," + base64.b64encode(id_bytes).decode())
        except Exception as exc:
            log.warning("Document-check MRZ extraction failed: %s", exc)
            mrz_result = {"verdict": "error", "error": str(exc)}
        ocr_fields = (mrz_result or {}).get("fields") or {}
    else:
        doc_result = {"score": None, "verdict": "no_refs", "refs_checked": 0}
        try:
            from production.matcher.fetcher import ensure_refs
            from production.matcher.doc_match import match_document
            ref_result = ensure_refs(country, doc_type)
            ref_files = ref_result["files"]
            if ref_files:
                doc_result = match_document(id_bytes, ref_files)
                doc_result["refs_checked"] = len(ref_files)
            else:
                doc_result["error"] = "No reference images cached for this document type"
        except Exception as exc:
            log.warning("Document-check reference match failed: %s", exc)
            doc_result["error"] = str(exc)

        try:
            import io
            import numpy as np
            from PIL import Image
            from production.core.ocr_extract.extract import extract_id_fields
            id_np = np.array(Image.open(io.BytesIO(id_bytes)).convert("RGB"))
            ocr_fields = extract_id_fields(id_np, country=country, doc_type=doc_type).get("fields", {})
        except Exception as exc:
            log.warning("Document-check OCR extraction failed: %s", exc)

    full_name = " ".join(filter(None, [ocr_fields.get("given_names"), ocr_fields.get("surname")])).strip() \
        or ocr_fields.get("full_name") or ""
    dob = ocr_fields.get("dob") or ocr_fields.get("date_of_birth")

    from production.core.pep_screen import screen as pep_screen_call
    pep_result = await pep_screen_call(full_name, dob, country)

    response = {
        "ok":         True,
        "country":    country.upper(),
        "doc_type":   doc_type,
        "forensics":  forensics_result,
        "document":   doc_result,
        "mrz":        mrz_result,
        "ocr_fields": ocr_fields,
        "pep":        pep_result,
    }

    if db.available:
        await db.log_adhoc_document_check(
            country, doc_type, full_name,
            mrz_verdict=(mrz_result or {}).get("verdict") if mrz_result else None,
            document_match_verdict=(doc_result or {}).get("verdict") if doc_result else None,
            forensics_verdict=forensics_result.get("verdict"),
            pep_result=pep_result,
            result=response,
            checked_by=checked_by,
            firm_id=_effective_firm_id(session, firm_id),
        )

    return response


def _require_super_admin(session: dict) -> None:
    if not session.get("super_admin"):
        raise HTTPException(403, "Super-admin access required")


class CreateFirmRequest(BaseModel):
    name:     str
    slug:     str
    password: str


@router.post("/firms")
async def create_firm(body: CreateFirmRequest, session: dict = Depends(require_admin)):
    """
    Onboard a new firm. Returns the plaintext API key exactly once — it is
    never stored (only its sha256 hash is) and can't be retrieved again,
    only regenerated by creating a fresh key (not yet exposed as an
    endpoint — re-run this with the same slug once update-in-place exists).
    """
    _require_super_admin(session)
    _require_db()

    slug = body.slug.strip().lower()
    if not slug or not body.name.strip() or not body.password:
        raise HTTPException(400, "name, slug, and password are all required")

    existing = await db.get_firm_by_slug(slug)
    if existing:
        raise HTTPException(409, f"Firm slug {slug!r} already exists")

    admin_password_hash, admin_password_salt = hash_password(body.password)
    api_key = generate_api_key()

    firm = await db.create_firm(
        name=body.name.strip(),
        slug=slug,
        admin_password_hash=admin_password_hash,
        admin_password_salt=admin_password_salt,
        api_key_hash=hash_api_key(api_key),
    )
    if firm is None:
        raise HTTPException(500, "Failed to create firm")

    return {
        "ok":      True,
        "firm":    {"id": firm["id"], "name": firm["name"], "slug": firm["slug"]},
        "api_key": api_key,  # shown once — write this down now
    }


@router.get("/firms")
async def list_firms(session: dict = Depends(require_admin)):
    _require_super_admin(session)
    _require_db()
    return {"items": await db.list_firms()}


@router.get("/me")
async def whoami(session: dict = Depends(require_admin)):
    """Lets the frontend show/personalize firm details (e.g. the Docs page)
    without needing a separate super-admin-only /firms call — the dashboard
    cookie proves who's asking, this just echoes back what it already
    grants access to."""
    if session.get("super_admin"):
        return {"super_admin": True, "firm_id": None, "firm_slug": None, "firm_name": None}
    _require_db()
    firm = await db.get_firm_by_slug(session["firm_slug"])
    return {
        "super_admin": False,
        "firm_id":     session["firm_id"],
        "firm_slug":   session["firm_slug"],
        "firm_name":   (firm or {}).get("name") or session["firm_slug"],
    }


# ── Generate Link (single-use verification session tokens) ──────────────────
# A token here is deliberately NOT the firm's real API key — that's a
# long-lived server-to-server secret that should never sit in a browser or a
# link an applicant might forward/screenshot. This is a random, single-use,
# 24h-expiring credential scoped to exactly one applicant. See
# production/api/main.py's ApiKeyMiddleware for the X-Session-Token check
# that consumes it.
#
# Both endpoints below accept EITHER the admin dashboard cookie (a human
# clicking "Generate Link") OR a firm's own X-Client-Id/X-Api-Key (their
# backend generating links programmatically, e.g. mid-signup on their own
# site) — see require_admin_or_firm_key. A firm authenticating via its own
# key is always scoped to its own firm_id, same as a firm-scoped dashboard
# session; only a super-admin dashboard session can pass an explicit
# firm_id override.

SESSION_TTL_HOURS = 24


class CreateSessionRequest(BaseModel):
    user_ref: Optional[str] = None
    firm_id:  Optional[int] = None  # super-admin only — which firm this link is for


@router.post("/sessions")
async def create_session(body: CreateSessionRequest, session: dict = Depends(require_admin_or_firm_key)):
    _require_db()
    firm_id = _effective_firm_id(session, body.firm_id)
    if firm_id is None:
        raise HTTPException(400, "firm_id is required (super-admin must specify which firm this link is for)")

    token = secrets.token_urlsafe(24)
    expires_at = (datetime.utcnow() + timedelta(hours=SESSION_TTL_HOURS)).isoformat() + "Z"

    row = await db.create_session(token=token, firm_id=firm_id, expires_at=expires_at, user_ref=body.user_ref)
    if row is None:
        raise HTTPException(500, "Failed to create session")

    base = os.getenv("CAPTURE_BASE_URL", "").rstrip("/")
    url = f"{base}/index.html?token={token}" if base else None

    return {
        "ok":         True,
        "token":      token,
        "url":        url,
        "expires_at": expires_at,
    }


@router.get("/sessions")
async def list_sessions(session: dict = Depends(require_admin_or_firm_key), firm_id: Optional[int] = None):
    _require_db()
    return {"items": await db.list_sessions(firm_id=_effective_firm_id(session, firm_id))}
