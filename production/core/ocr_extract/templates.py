"""
Incremental, self-building templates — no upfront ingestion step required.

Every call to extract.extract_id_fields() that resolves a field via a
label match feeds this store two things, keyed by (country, doc_type):

  1. field_bboxes — a running-average normalised bbox of where each field's
     *value* was found, so a mature template can crop-and-OCR that region
     directly next time instead of re-running the full label search.
  2. learned_labels — any label text that resolved to a field but wasn't
     already in labels.py's static dictionary (e.g. a country-specific
     bilingual label, or a language not yet seeded). These are folded
     into label matching on the next scan of the same document type.

Persisted as plain JSON. Storage directory is configurable via
OCR_TEMPLATES_DIR (mount a volume there in production so learned
templates survive container rebuilds) — defaults to this module's own
directory for local/dev use.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)

_STORE_DIR = Path(os.getenv("OCR_TEMPLATES_DIR", str(Path(__file__).resolve().parent)))
_STORE_PATH = _STORE_DIR / "templates_store.json"
_lock = threading.Lock()

# A field's stored bbox is only trusted for the fast-path crop once it has
# been observed at least this many times at a stable position.
MATURE_HITS = 3
_BBOX_KEYS = ("x", "y", "w", "h")


def _load() -> dict:
    if not _STORE_PATH.exists():
        return {}
    try:
        with _STORE_PATH.open("r", encoding="utf-8") as fh:
            return json.load(fh)
    except Exception as exc:
        log.warning("templates_store.json unreadable, starting fresh: %s", exc)
        return {}


def _save(data: dict) -> None:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = _STORE_PATH.with_suffix(".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    tmp.replace(_STORE_PATH)


def _key(country: str, doc_type: str) -> str:
    return f"{country.upper()}:{doc_type.lower()}"


def get_template(country: str, doc_type: str) -> dict:
    """Return {"field_bboxes": {...}, "learned_labels": {...}} for this doc type."""
    data = _load()
    return data.get(_key(country, doc_type), {"field_bboxes": {}, "learned_labels": {}})


def get_mature_bboxes(country: str, doc_type: str) -> dict[str, dict]:
    """Field bboxes seen often enough to trust for a direct-crop fast path."""
    tpl = get_template(country, doc_type)
    return {
        field: bbox
        for field, bbox in tpl.get("field_bboxes", {}).items()
        if bbox.get("hits", 0) >= MATURE_HITS
    }


def get_learned_labels(country: str, doc_type: str) -> dict[str, list[str]]:
    return get_template(country, doc_type).get("learned_labels", {})


def record_observation(
    country: str,
    doc_type: str,
    field_boxes: dict[str, tuple[float, float, float, float]],
    new_labels: Optional[dict[str, str]] = None,
) -> None:
    """
    Fold one successful extraction into the running template. Never raises
    — called from the synchronous /api/v1/verify request path, so a disk
    hiccup here must not affect the verification response.

    field_boxes:  {field_name: (x, y, w, h)} normalised value-box positions
                  actually used for this extraction.
    new_labels:   {field_name: label_text} raw label text that resolved to
                  this field but wasn't already a known static label.
    """
    if not country or not doc_type or (not field_boxes and not new_labels):
        return

    try:
        with _lock:
            data = _load()
            key = _key(country, doc_type)
            entry = data.setdefault(key, {"field_bboxes": {}, "learned_labels": {}})

            for field, (x, y, w, h) in field_boxes.items():
                existing = entry["field_bboxes"].get(field)
                if existing is None:
                    entry["field_bboxes"][field] = {"x": x, "y": y, "w": w, "h": h, "hits": 1}
                else:
                    hits = existing.get("hits", 1)
                    # Running average — smooths out per-scan crop/alignment jitter.
                    for k, new_v in zip(_BBOX_KEYS, (x, y, w, h)):
                        existing[k] = (existing[k] * hits + new_v) / (hits + 1)
                    existing["hits"] = hits + 1

            if new_labels:
                for field, label_text in new_labels.items():
                    bucket = entry["learned_labels"].setdefault(field, [])
                    norm_existing = {lbl.lower() for lbl in bucket}
                    if label_text.lower() not in norm_existing:
                        bucket.append(label_text)

            _save(data)
    except Exception as exc:
        log.warning("templates.record_observation failed (non-fatal): %s", exc)


def stats(country: str, doc_type: str) -> dict:
    """Quick summary for debugging/CLI use — hits per field, sample count."""
    tpl = get_template(country, doc_type)
    return {
        field: bbox.get("hits", 0)
        for field, bbox in tpl.get("field_bboxes", {}).items()
    }
