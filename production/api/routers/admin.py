"""
Admin API — list & detail endpoints for the verification dashboard.

Every route requires an authenticated admin session (production/api/routers
/admin_auth.py) and a configured Supabase connection — unlike capture.py's
local-disk fallback, there is no offline mode here: the dashboard is
meaningless without persisted history.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from production.api.routers.admin_auth import require_admin, router as auth_router
from production.database import db
from production.storage import storage

log = logging.getLogger(__name__)

router = APIRouter(tags=["admin"])
router.include_router(auth_router)


def _require_db() -> None:
    if not db.available:
        raise HTTPException(503, "Database not configured (SUPABASE_URL/SUPABASE_KEY unset)")


@router.get("/verifications", dependencies=[Depends(require_admin)])
async def list_verifications(
    page:      int            = Query(1, ge=1),
    page_size: int            = Query(25, ge=1, le=100),
    verified:  Optional[bool] = None,
    verdict:   Optional[str]  = None,
    country:   Optional[str]  = None,
    doc_type:  Optional[str]  = None,
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    q:         Optional[str]  = None,
):
    _require_db()
    result = await db.list_results(
        page=page, page_size=page_size,
        verified=verified, verdict=verdict, country=country, doc_type=doc_type,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        q=q,
    )
    return {
        "items":     result["items"],
        "total":     result["total"],
        "page":      page,
        "page_size": page_size,
    }


@router.get("/verifications/{result_id}", dependencies=[Depends(require_admin)])
async def get_verification(result_id: int):
    _require_db()
    row = await db.get_result(result_id)
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


@router.patch("/verifications/{result_id}", dependencies=[Depends(require_admin)])
async def review_verification(result_id: int, body: ReviewUpdate):
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
    )
    if not ok:
        raise HTTPException(404, "Verification not found or update failed")
    return {"ok": True}
