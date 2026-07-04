"""
OCR wrapper — doctr (db_resnet50 + crnn_vgg16_bn).

doctr downloads its own pretrained weights on first use (~160 MB total).
No manual model download needed for OCR.

Falls back to pytesseract if doctr is not installed.

Public API:
    ocr_region(img, bbox) → str
    ocr_fields(img, fields_map) → dict[str, str]
    ocr_full(img) → str
"""

from __future__ import annotations

import io
import logging
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

_predictor = None
_DOCTR_OK   = False
_TESS_OK    = False


def _init():
    global _predictor, _DOCTR_OK, _TESS_OK

    try:
        from doctr.models import ocr_predictor
        _predictor = ocr_predictor(pretrained=True)
        _DOCTR_OK  = True
        log.info("doctr OCR predictor ready")
        return
    except Exception as exc:
        log.warning("doctr not available (%s) — will try pytesseract", exc)

    try:
        import pytesseract
        pytesseract.get_tesseract_version()
        _TESS_OK = True
        log.info("pytesseract fallback ready")
    except Exception as exc:
        log.warning("pytesseract also not available: %s", exc)


def _ensure_init():
    global _DOCTR_OK, _TESS_OK
    if not _DOCTR_OK and not _TESS_OK and _predictor is None:
        _init()


# ── Image helpers ─────────────────────────────────────────────────────────────

def _crop_bbox(img: np.ndarray, bbox: dict) -> np.ndarray:
    """Crop using normalised bbox dict {x, y, w, h}."""
    h, w = img.shape[:2]
    x1 = max(0, int(bbox["x"] * w))
    y1 = max(0, int(bbox["y"] * h))
    x2 = min(w, int((bbox["x"] + bbox["w"]) * w))
    y2 = min(h, int((bbox["y"] + bbox["h"]) * h))
    return img[y1:y2, x1:x2]


def _np_to_pil_bytes(region: np.ndarray) -> bytes:
    from PIL import Image
    buf = io.BytesIO()
    Image.fromarray(region).save(buf, format="PNG")
    return buf.getvalue()


# ── doctr path ────────────────────────────────────────────────────────────────

def _doctr_ocr(region: np.ndarray) -> str:
    from doctr.io import DocumentFile
    if 0 in region.shape[:2]:
        return ""
    png = _np_to_pil_bytes(region)
    doc = DocumentFile.from_images([png])
    result = _predictor(doc)
    words = [
        w.value
        for block in result.pages[0].blocks
        for line  in block.lines
        for w     in line.words
    ]
    return " ".join(words).strip()


# ── pytesseract fallback ──────────────────────────────────────────────────────

def _tess_ocr(region: np.ndarray) -> str:
    import pytesseract
    if 0 in region.shape[:2]:
        return ""
    gray = cv2.cvtColor(region, cv2.COLOR_RGB2GRAY)
    _, thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    text = pytesseract.image_to_string(thresh, config="--psm 6")
    return text.strip()


# ── Public API ────────────────────────────────────────────────────────────────

def ocr_region(img: np.ndarray, bbox: Optional[dict] = None) -> str:
    """
    OCR a rectangular region of the image.
    If bbox is None the whole image is used.
    img: RGB np.ndarray.
    Returns plain text string.
    """
    _ensure_init()
    region = _crop_bbox(img, bbox) if bbox else img
    if 0 in region.shape[:2]:
        return ""

    if _DOCTR_OK:
        try:
            return _doctr_ocr(region)
        except Exception as exc:
            log.warning("doctr OCR failed: %s", exc)

    if _TESS_OK:
        try:
            return _tess_ocr(region)
        except Exception as exc:
            log.warning("pytesseract OCR failed: %s", exc)

    return ""


def ocr_fields(img: np.ndarray, fields: dict) -> dict[str, str]:
    """
    OCR each named field region from a blueprint fields map.

    fields: { "field_name": {"x": 0.0, "y": 0.0, "w": 0.0, "h": 0.0}, ... }
    Returns: { "field_name": "extracted text", ... }
    """
    _ensure_init()
    out = {}
    for name, bbox in fields.items():
        out[name] = ocr_region(img, bbox)
    return out


def ocr_full(img: np.ndarray) -> str:
    """OCR the entire image, returning all text as a single string."""
    return ocr_region(img, bbox=None)
