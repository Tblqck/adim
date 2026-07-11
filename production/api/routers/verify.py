"""
POST /api/v1/verify

Unified verification endpoint supporting all three modes:

  Mode 1 — id_image + selfie            → doc alignment → OCR → face embed match
  Mode 2 — id_image + holding_photo     → same pipeline, second image is a holding shot
  Mode 3 — id_image + liveness_frames   → liveness gate → face embed match

Also runs:
  - Document reference matching (Wikimedia cache, same as before)
  - MRZ extraction for passports
  - Combined verdict
"""

from __future__ import annotations

import base64
import binascii
import io
import logging
import os
import re
import threading
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, File, Form, HTTPException, Request, UploadFile

log = logging.getLogger(__name__)

# country/doc_type flow unvalidated into filesystem paths in matcher/fetcher.py
# (REFS_ROOT / country / doc_type) — reject anything that isn't a plain
# 2-letter code / known doc type before either value is used for anything,
# so a traversal payload like "../../../tmp/evil" never reaches a path join.
_COUNTRY_CODE_RE = re.compile(r"^[A-Za-z]{2}$")
_VALID_DOC_TYPES = {"passport", "national_id", "drivers_license", "residence_permit"}

_TELEGRAM_TOKEN = lambda: os.getenv("TELEGRAM_BOT_TOKEN", "")
_TELEGRAM_CHAT  = lambda: os.getenv("TELEGRAM_CHAT_ID",  "")


def _full_name(ocr_out: dict) -> str:
    return " ".join(filter(None, [
        ocr_out.get("given_names"), ocr_out.get("surname")
    ])) or ocr_out.get("full_name") or ""


def _tg_result(response: dict, id_bytes: bytes, ocr_out: dict):
    """Send verification result to Telegram (runs in daemon thread)."""
    token = _TELEGRAM_TOKEN()
    chat  = _TELEGRAM_CHAT()
    if not token or not chat:
        return
    try:
        import requests as _req

        verdict  = response.get("overall_verdict", "unknown")
        score    = response.get("overall_score")
        verified = response.get("verified", False)
        status   = "VERIFIED" if verified else "NOT VERIFIED"
        icon     = "✅" if verified else "❌"

        name    = _full_name(ocr_out) or "—"
        dob     = ocr_out.get("dob") or ocr_out.get("date_of_birth") or "—"
        id_num  = ocr_out.get("id_number") or "—"
        expiry  = ocr_out.get("expiry") or ocr_out.get("expiry_date") or "—"

        lines = [
            f"{icon} *KYC Result — {status}*",
            f"Country: `{response.get('country','—')}` · Doc: `{response.get('doc_type','—')}`",
            f"Verdict: `{verdict}`",
            f"Score: `{f'{score:.0%}' if score is not None else 'N/A'}`",
            f"Name: `{name}`",
            f"DOB: `{dob}` · Expires: `{expiry}`",
            f"ID#: `{id_num}`",
            f"Result ID: `{response.get('result_id','—')}`",
        ]
        _req.post(
            f"https://api.telegram.org/bot{token}/sendMessage",
            json={"chat_id": chat, "text": "\n".join(lines), "parse_mode": "Markdown"},
            timeout=15,
        )
        # Send the ID document image
        _req.post(
            f"https://api.telegram.org/bot{token}/sendPhoto",
            data={"chat_id": chat, "caption": f"ID document · {response.get('country','')} {response.get('doc_type','')}"},
            files={"photo": ("id.jpg", id_bytes, "image/jpeg")},
            timeout=20,
        )
    except Exception as exc:
        log.warning("Telegram result notify failed: %s", exc)


def _persist_admin_data(
    result_id: Optional[int],
    response: dict,
    forensics_result: dict,
    id_bytes: bytes,
    id_back_bytes: Optional[bytes],
    face_images_bytes: list,
    ocr_out: dict,
    country: str,
    doc_type: str,
):
    """
    Upload images to Supabase Storage, run PEP/sanctions screening, and
    patch the full admin record onto verification_results. Runs in its
    own daemon thread with its own event loop — never blocks or affects
    the synchronous /api/v1/verify response, and never raises.
    """
    if result_id is None:
        return

    async def _run():
        from production.storage import storage
        from production.core.pep_screen import screen as pep_screen_call

        fields: dict = {
            "pipeline_response": response,
            "forensics_result":  forensics_result,
        }

        id_front_path = await storage.upload(f"{result_id}/id_front.jpg", id_bytes)
        if id_front_path:
            fields["id_front_path"] = id_front_path

        if id_back_bytes:
            id_back_path = await storage.upload(f"{result_id}/id_back.jpg", id_back_bytes)
            if id_back_path:
                fields["id_back_path"] = id_back_path

        face_paths = []
        for i, fb in enumerate(face_images_bytes):
            p = await storage.upload(f"{result_id}/face_{i + 1}.jpg", fb)
            if p:
                face_paths.append(p)
        if face_paths:
            fields["face_frame_paths"] = face_paths

        name = _full_name(ocr_out)
        if name:
            dob = ocr_out.get("dob") or ocr_out.get("date_of_birth")
            fields["pep_result"] = await pep_screen_call(name, dob, country)

        from production.database import db
        await db.update_admin_fields(result_id, **fields)
        await storage.aclose()

    try:
        import asyncio
        asyncio.run(_run())
    except Exception as exc:
        log.warning("Admin data persistence failed (result_id=%s): %s", result_id, exc)


router = APIRouter(tags=["verify"])


# ── Decode helpers ────────────────────────────────────────────────────────────

def _decode_b64(uri: str) -> bytes:
    """Decode a base64 data-URI or raw base64 string to bytes."""
    if not isinstance(uri, str) or not uri.strip():
        raise ValueError("empty or missing data URI")
    payload = uri.split(",", 1)[1] if "," in uri else uri
    try:
        return base64.b64decode(payload)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"invalid base64: {exc}") from exc


def _np_from_bytes(data: bytes):
    import numpy as np
    from PIL import Image
    return np.array(Image.open(io.BytesIO(data)).convert("RGB"))


def _np_from_upload(upload: UploadFile):
    import asyncio
    # called inside an async route — read is already awaited by caller
    raise RuntimeError("use await _read_upload(upload)")


# ── Combined verdict ──────────────────────────────────────────────────────────

def _combined_verdict(doc_v, face_v, mrz_v=None, liveness_v=None) -> str:
    strong  = {"strong_match", "likely_match"}
    weak    = {"weak_match", "possible_match"}

    doc_ok   = doc_v  in strong
    face_ok  = face_v in strong or face_v == "skipped"
    doc_weak = doc_v  in weak
    face_weak= face_v in weak

    if mrz_v == "tampered":   return "mrz_tampered"
    if mrz_v == "expired":    return "passport_expired"
    # "error" means an MRZ extraction was actually attempted (this is a
    # passport) and failed *before* reaching check-digit validation — MRZ
    # zone not found, OCR garbled, wrong line length, exception. Letting
    # that silently fall through to a face-only pass would mean a
    # passport's MRZ is never actually checksum-validated whenever it's
    # degraded enough to not OCR cleanly, which defeats the one control
    # meant to catch a tampered MRZ. None/"skipped" (not a passport, or MRZ
    # not applicable) are unaffected — this only fires when MRZ was
    # attempted and produced no verdict at all.
    if mrz_v == "error":      return "mrz_unreadable"
    if liveness_v == "fail":  return "liveness_fail"

    mrz_ok = mrz_v in ("valid", "valid_with_warnings", None, "skipped")

    if doc_v == "no_refs":
        if mrz_ok and face_ok:   return "mrz_face_pass"
        if mrz_ok and face_weak: return "mrz_pass_face_weak"
        if face_ok:              return "face_only_pass"
        if face_weak:            return "face_only_weak"
        return "unverifiable"

    if doc_ok  and face_ok  and mrz_ok: return "pass"
    if doc_ok  and face_ok:             return "pass_mrz_warn"
    if doc_ok  and face_weak:           return "pass_face_weak"
    if doc_weak and face_ok and mrz_ok: return "doc_weak_pass"
    if doc_weak and face_weak:          return "both_weak"
    return "fail"


# ── Reference document match (Wikimedia cache) ────────────────────────────────

def _match_reference_images(image_bytes: bytes, country: str, doc_type: str) -> dict:
    """Best-effort, non-blocking — 'no_refs' is an expected outcome for most
    country/doc_type combos, not a failure."""
    doc_result: dict = {"score": None, "verdict": "no_refs", "refs_checked": 0}
    try:
        from production.matcher.fetcher   import ensure_refs
        from production.matcher.doc_match import match_document
        ref_result = ensure_refs(country, doc_type)
        ref_files  = ref_result["files"]
        if ref_files:
            doc_result = match_document(image_bytes, ref_files)
            doc_result["refs_checked"] = len(ref_files)
        else:
            doc_result["error"] = "No reference images cached for this document type"
    except Exception as exc:
        log.warning("Document reference match failed: %s", exc)
        doc_result["error"] = str(exc)
    return doc_result


# ── Main endpoint ─────────────────────────────────────────────────────────────

@router.post("/verify")
async def verify(
    request: Request,
    # -- required --
    country:      str        = Form(...,  description="ISO alpha-2 country code, e.g. 'GB'"),
    doc_type:     str        = Form(...,  description="'passport' | 'national_id' | 'drivers_license' | 'residence_permit'"),
    id_image:     UploadFile = File(...,  description="Captured ID document image"),
    id_image_back: Optional[UploadFile] = File(None, description="Back of ID document, if captured"),
    # -- mode selection --
    mode:         int        = Form(1,    description="1=ID+selfie  2=ID+holding  3=ID+liveness frames"),
    # -- mode 1 / 2 --
    selfie:       Optional[UploadFile] = File(None, description="Mode 1: selfie photo"),
    holding_photo:Optional[UploadFile] = File(None, description="Mode 2: photo holding the ID"),
    # -- mode 3 --
    liveness_frames: List[UploadFile]  = File([],   description="Mode 3: 1–5 liveness video frames"),
    # -- optional metadata --
    user_ref:     str        = Form("anonymous", description="Caller-supplied user reference"),
    issue_year:   int        = Form(2020,         description="Approximate document issue year"),
):
    """
    Full identity verification pipeline.

    Returns a structured report including per-module scores and an overall verdict.
    """
    # ── 0. Validate country/doc_type before either reaches a filesystem path ──
    if not _COUNTRY_CODE_RE.match(country):
        raise HTTPException(400, "country must be a 2-letter ISO alpha-2 code")
    if doc_type not in _VALID_DOC_TYPES:
        raise HTTPException(400, f"doc_type must be one of {sorted(_VALID_DOC_TYPES)}")

    # ── 1. Read uploads ───────────────────────────────────────────────────────
    id_bytes = await id_image.read()
    if not id_bytes:
        raise HTTPException(400, "id_image is empty")

    id_back_bytes: Optional[bytes] = await id_image_back.read() if id_image_back else None

    second_bytes: Optional[bytes] = None
    if mode == 1 and selfie:
        second_bytes = await selfie.read()
    elif mode == 2 and holding_photo:
        second_bytes = await holding_photo.read()

    live_frames_bytes: list[bytes] = []
    if mode == 3:
        if not liveness_frames:
            raise HTTPException(400, "mode 3 requires at least one liveness frame")
        if len(liveness_frames) > 5:
            raise HTTPException(400, "maximum 5 liveness frames")
        live_frames_bytes = [await f.read() for f in liveness_frames]

    # ── 2. Decode images to numpy ─────────────────────────────────────────────
    id_np = _np_from_bytes(id_bytes)

    # ── 3. Document alignment ─────────────────────────────────────────────────
    from production.core.alignment import align_document
    id_aligned = align_document(id_np)

    # Passports: dedicated pipeline. Localize the page with an aspect-
    # preserving warp (crops out hand/desk/background clutter from a
    # handheld photo — the fixed 800x506 card shape above stays reserved for
    # the blueprint-driven OCR path further down, which may be calibrated
    # against that exact size). This aligned crop feeds MRZ, face/liveness
    # match, and reference match below, in that order.
    id_aligned_passport = None
    id_aligned_passport_bytes: Optional[bytes] = None
    if doc_type == "passport":
        import cv2
        id_aligned_passport = align_document(id_np, auto_aspect=True)
        ok, _enc = cv2.imencode(".jpg", cv2.cvtColor(id_aligned_passport, cv2.COLOR_RGB2BGR))
        id_aligned_passport_bytes = _enc.tobytes() if ok else id_bytes

    # ── 3b. Forensics / EXIF analysis (admin-only, cheap & local — inline) ────
    from production.core.forensics import analyze as _analyze_forensics
    forensics_result = _analyze_forensics(id_bytes)

    # ── 4. Reference document match (Wikimedia cache) ─────────────────────────
    # Passports: moved after face/liveness match below — it's optional/best-
    # effort (most countries have no cached refs yet) and shouldn't sit in
    # front of the checks that actually produce a verdict.
    doc_result: dict = {"score": None, "verdict": "no_refs", "refs_checked": 0}
    if doc_type != "passport":
        doc_result = _match_reference_images(id_bytes, country, doc_type)

    # ── 5. Blueprint lookup (for OCR field regions) ───────────────────────────
    from production.database import db
    blueprint = await db.fetch_blueprint(country, doc_type, issue_year)
    if blueprint is None:
        await db.queue_pending("__api_upload__", country.upper(), doc_type)

    # ── 6. OCR ───────────────────────────────────────────────────────────────
    # Card documents: template-free multi-language extractor — no blueprint
    # needed, works cold on any country/doc_type from label + regex matching.
    # Passports keep the blueprint/MRZ path — MRZ's checksummed fields (step 7
    # below) are a stronger source than free-form label search for that case.
    ocr_out: dict = {}
    ocr_word_count: Optional[int] = None
    field_sources: dict = {}
    if doc_type != "passport":
        try:
            from production.core.ocr_extract.extract import extract_id_fields
            # Full-resolution original, not id_aligned — the extractor has no
            # fixed coordinate grid to satisfy, so the 800x506 resize (or warp)
            # is pure signal loss for it, not normalisation.
            ocr_result = extract_id_fields(id_np, country=country, doc_type=doc_type)
            ocr_out = ocr_result.get("fields", {})
            ocr_word_count = ocr_result.get("word_count")
            field_sources = {
                field: m.get("source") for field, m in ocr_result.get("matches", {}).items()
            }
        except Exception as exc:
            log.warning("Card OCR extraction failed: %s", exc)
    elif blueprint and blueprint.get("fields"):
        try:
            from production.core.ocr import ocr_fields
            ocr_out = ocr_fields(id_aligned, blueprint["fields"])
        except Exception as exc:
            log.warning("OCR failed: %s", exc)

    # ── 7. MRZ (passports only) ───────────────────────────────────────────────
    mrz_result: Optional[dict] = None
    if doc_type == "passport":
        try:
            from production.matcher.mrz import verify_passport as _mrz_verify
            mrz_result = _mrz_verify(id_aligned_passport)
        except Exception as exc:
            log.warning("MRZ extraction failed: %s", exc)
            mrz_result = {"verdict": "error", "error": str(exc)}

        # Merge MRZ fields into OCR output as fallback
        if mrz_result and mrz_result.get("fields"):
            mf = mrz_result["fields"]
            ocr_out.setdefault("surname",     mf.get("surname"))
            ocr_out.setdefault("given_names", mf.get("given_names"))
            ocr_out.setdefault("nationality", mf.get("nationality"))
            ocr_out.setdefault("dob",         mf.get("date_of_birth"))
            ocr_out.setdefault("expiry",      mf.get("expiry_date"))
            ocr_out.setdefault("id_number",   mf.get("doc_number"))

    # ── 8. Liveness check (mode 3) ────────────────────────────────────────────
    liveness_result: Optional[dict] = None
    liveness_verdict: Optional[str] = None
    if mode == 3 and live_frames_bytes:
        from production.core.liveness import check_frames
        live_imgs = [_np_from_bytes(b) for b in live_frames_bytes]
        liveness_result  = check_frames(live_imgs)
        liveness_verdict = "pass" if liveness_result["is_live"] else "fail"

    # ── 9. Face match ─────────────────────────────────────────────────────────
    face_result: dict = {"score": None, "verdict": "skipped"}

    compare_bytes: Optional[bytes] = None
    if mode in (1, 2) and second_bytes:
        compare_bytes = second_bytes
    elif mode == 3 and live_frames_bytes:
        # Pick the sharpest frame for face comparison
        import numpy as np
        def _sharpness(b: bytes) -> float:
            img = _np_from_bytes(b)
            gray = __import__("cv2").cvtColor(img, __import__("cv2").COLOR_RGB2GRAY)
            return float(__import__("cv2").Laplacian(gray, __import__("cv2").CV_64F).var())
        compare_bytes = max(live_frames_bytes, key=_sharpness)

    id_img_for_face = id_aligned_passport_bytes if doc_type == "passport" else id_bytes

    if compare_bytes:
        from production.core.biometrics import compare_faces
        try:
            face_result = compare_faces(compare_bytes, id_img_for_face)
        except Exception as exc:
            log.warning("Face comparison failed: %s", exc)
            face_result = {"score": None, "verdict": "error", "error": str(exc)}

    # ── 9b. Reference document match — passports only, run last (see step 4) ──
    if doc_type == "passport":
        doc_result = _match_reference_images(id_aligned_passport_bytes, country, doc_type)

    # ── 10. Overall score + verdict ───────────────────────────────────────────
    scores  = [s for s in [doc_result.get("score"), face_result.get("score")] if s is not None]
    overall = round(sum(scores) / len(scores), 3) if scores else None

    overall_verdict = _combined_verdict(
        doc_result.get("verdict"),
        face_result.get("verdict"),
        mrz_result.get("verdict") if mrz_result else None,
        liveness_verdict,
    )

    # ── 11. Persist result ────────────────────────────────────────────────────
    verified    = overall_verdict in ("pass", "mrz_face_pass", "face_only_pass", "pass_mrz_warn")
    result_id   = await db.write_result_full(
        user_ref, mode,
        blueprint["id"] if blueprint else None,
        verified, overall or 0.0,
        None if verified else overall_verdict,
        country=country, doc_type=doc_type, overall_verdict=overall_verdict,
        face_match_score=face_result.get("score"),
        face_match_verdict=face_result.get("verdict"),
        liveness_score=liveness_result.get("score") if liveness_result else None,
        liveness_verdict=liveness_verdict,
        liveness_method=liveness_result.get("method") if liveness_result else None,
        document_match_score=doc_result.get("score"),
        document_match_verdict=doc_result.get("verdict"),
        mrz_verdict=mrz_result.get("verdict") if mrz_result else None,
        forensics_verdict=forensics_result.get("verdict"),
        forensics_ela_score=forensics_result.get("ela_score"),
        forensics_risk_flags=forensics_result.get("risk_flags"),
        ocr_word_count=ocr_word_count,
        firm_id=getattr(request.state, "firm_id", None),
    )
    await db.write_extracted(result_id, ocr_out, field_sources=field_sources)

    # ── 12. Build response ────────────────────────────────────────────────────
    response = {
        "ok":              True,
        "timestamp":       datetime.utcnow().isoformat() + "Z",
        "country":         country,
        "doc_type":        doc_type,
        "mode":            mode,
        "verified":        verified,
        "overall_score":   overall,
        "overall_verdict": overall_verdict,
        "document":        doc_result,
        "face":            face_result,
        "ocr_fields":      ocr_out,
        "result_id":       result_id,
    }
    if mrz_result is not None:
        response["mrz"] = mrz_result
    if liveness_result is not None:
        response["liveness"] = liveness_result

    # Fire Telegram result notification in background
    threading.Thread(
        target=_tg_result,
        args=(response, id_bytes, ocr_out),
        daemon=True,
    ).start()

    # Persist admin-dashboard data (images, forensics, PEP screen) in background —
    # never blocks or affects this synchronous response
    face_images_bytes = live_frames_bytes if mode == 3 else ([second_bytes] if second_bytes else [])
    threading.Thread(
        target=_persist_admin_data,
        args=(
            result_id, response, forensics_result,
            id_bytes, id_back_bytes, face_images_bytes,
            ocr_out, country, doc_type,
        ),
        daemon=True,
    ).start()

    return response
