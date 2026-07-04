"""
Standalone ID field extractor — no blueprint required, card documents only.

    from production.core.ocr_extract.extract import extract_id_fields
    result = extract_id_fields(id_aligned, country="NG", doc_type="national_id")
    result["fields"]  # {"surname": "HANSON", "given_names": "ABASIEKEME EMMANUEL", ...}

Scope: card-type documents (national_id, drivers_license, residence_permit).
Passports keep using the existing MRZ path (production/matcher/mrz.py) — a
passport's machine-readable zone is a far more reliable, checksummed source
than free-form label search, so this module is intentionally not wired in
for doc_type == "passport" (see production/api/routers/verify.py).
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from typing import Optional, Union

import numpy as np

from . import field_extractor, templates
from .engine import run_ocr

log = logging.getLogger(__name__)


def _to_np(image: Union[np.ndarray, bytes, str, Path]) -> np.ndarray:
    if isinstance(image, np.ndarray):
        return image
    from PIL import Image
    if isinstance(image, (str, Path)):
        return np.array(Image.open(image).convert("RGB"))
    if isinstance(image, bytes):
        return np.array(Image.open(io.BytesIO(image)).convert("RGB"))
    raise TypeError(f"Unsupported image type: {type(image)}")


def extract_id_fields(
    image: Union[np.ndarray, bytes, str, Path],
    country: Optional[str] = None,
    doc_type: Optional[str] = None,
    langs_hint: Optional[list[str]] = None,
) -> dict:
    """
    Run OCR + field extraction on a single ID card document image.

    country/doc_type: optional. When given, the extraction also updates
    the incremental template store (templates.py) with any fields it
    resolved, so the (country, doc_type) pair's template gets stronger
    with every real scan/verification — no separate ingestion step.

    Returns:
        {
          "fields":    {field_name: value, ...},
          "full_name": str,
          "raw_text":  str,
          "matches":   {field_name: {"source", "label_text", "bbox"}},
          "word_count": int,
        }
    """
    img = _to_np(image)
    words = run_ocr(img, langs_hint=langs_hint)

    learned = templates.get_learned_labels(country, doc_type) if country and doc_type else None
    result = field_extractor.extract(words, learned_labels=learned)
    result["word_count"] = len(words)

    if country and doc_type and result["matches"]:
        field_boxes = {
            field: m["bbox"] for field, m in result["matches"].items()
        }
        new_labels = {
            field: m["label_text"]
            for field, m in result["matches"].items()
            if m["source"] == "label" and m["label_text"]
        }
        templates.record_observation(country, doc_type, field_boxes, new_labels)

    return result
