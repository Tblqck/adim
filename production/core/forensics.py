"""
Forensics & EXIF analysis for uploaded ID document images.

Real, local heuristics — no third-party service, no new dependencies beyond
Pillow + numpy (both already in requirements.txt):

  1. EXIF extraction (camera make/model, capture time, software tag, GPS)
  2. Editing-tool signature detection (regex against the Software tag)
  3. Missing-EXIF flag — the cheapest, strongest tamper signal: a
     screenshot or re-saved image typically carries no camera EXIF at all
  4. Error Level Analysis (ELA) — re-encode at a fixed JPEG quality and
     diff against the original; regions that were pasted/edited
     re-compress differently and light up in the diff
  5. JPEG quantization-table consistency — a best-effort, low-confidence
     resave heuristic

None of this is a substitute for a real forensic lab — it is presented to
admins as investigative signal, not as a pass/fail authority.
"""

from __future__ import annotations

import base64
import io
import logging
import re
from typing import Optional

log = logging.getLogger(__name__)

_EDIT_SOFTWARE_PATTERNS = re.compile(
    r"photoshop|gimp|snapseed|lightroom|pixelmator|facetune|picsart|affinity|paint\.net|canva",
    re.IGNORECASE,
)

# EXIF tag IDs (raw ints — avoids depending on ExifTags naming across Pillow versions)
_TAG_MAKE          = 271
_TAG_MODEL         = 272
_TAG_SOFTWARE      = 305
_TAG_DATETIME      = 306
_TAG_EXIF_IFD      = 0x8769  # 34665
_TAG_GPS_IFD       = 0x8825  # 34853
_TAG_DATETIME_ORIG = 36867

ELA_QUALITY = 90
ELA_SCALE   = 12  # amplification factor for the visual heatmap only
ELA_SUSPICIOUS_SCORE = 15.0
ELA_HIGH_RISK_SCORE  = 25.0


def analyze(image_bytes: bytes) -> dict:
    """
    Run all forensic checks against a single uploaded image (JPEG bytes).
    Never raises — returns a structured 'unavailable' result on any failure.
    """
    try:
        from PIL import Image
        import numpy as np
    except ImportError as exc:
        return _unavailable(f"Pillow/numpy not installed: {exc}")

    try:
        img = Image.open(io.BytesIO(image_bytes))
        img.load()
    except Exception as exc:
        return _unavailable(f"could not decode image: {exc}")

    risk_flags: list[str] = []

    # ── EXIF ─────────────────────────────────────────────────────────────────
    exif = img.getexif()
    exif_present = bool(exif) and len(exif) > 0

    camera_make  = _clean_str(exif.get(_TAG_MAKE))
    camera_model = _clean_str(exif.get(_TAG_MODEL))
    software_tag = _clean_str(exif.get(_TAG_SOFTWARE))
    datetime_original = _clean_str(exif.get(_TAG_DATETIME))

    gps_present = False
    try:
        exif_ifd = exif.get_ifd(_TAG_EXIF_IFD)
        if exif_ifd:
            do = _clean_str(exif_ifd.get(_TAG_DATETIME_ORIG))
            if do:
                datetime_original = do
    except Exception:
        pass
    try:
        gps_present = bool(exif.get_ifd(_TAG_GPS_IFD))
    except Exception:
        gps_present = False

    editing_software_detected = bool(software_tag and _EDIT_SOFTWARE_PATTERNS.search(software_tag))

    if not exif_present:
        risk_flags.append("No camera EXIF metadata found — image may be a screenshot, re-save, or edited export")
    if editing_software_detected:
        risk_flags.append(f"Editing software detected in EXIF: {software_tag}")

    # ── Error Level Analysis ────────────────────────────────────────────────
    ela_score, ela_heatmap_b64 = _error_level_analysis(img, np)
    if ela_score > ELA_SUSPICIOUS_SCORE:
        risk_flags.append(f"Elevated Error Level Analysis score ({ela_score:.1f}) — possible localized edit")

    # ── Quantization-table consistency (best-effort, low confidence) ───────
    resave_detected = _check_quantization(img)
    if resave_detected:
        risk_flags.append(
            "Non-standard JPEG quantization tables — image may have been "
            "re-saved by editing software (low-confidence signal)"
        )

    # ── Verdict ──────────────────────────────────────────────────────────────
    if (not exif_present and ela_score > ELA_SUSPICIOUS_SCORE) or editing_software_detected \
            or ela_score > ELA_HIGH_RISK_SCORE:
        verdict = "suspicious"
    else:
        verdict = "clean"

    return {
        "ok": True,
        "exif_present": exif_present,
        "camera_make": camera_make,
        "camera_model": camera_model,
        "datetime_original": datetime_original,
        "software_tag": software_tag,
        "editing_software_detected": editing_software_detected,
        "gps_present": gps_present,
        "resave_detected": resave_detected,
        "ela_score": round(ela_score, 2),
        "ela_heatmap_b64": ela_heatmap_b64,
        "risk_flags": risk_flags,
        "verdict": verdict,
        "error": None,
    }


def _error_level_analysis(img, np) -> tuple:
    """
    Re-encode the image at a fixed JPEG quality and diff against the
    original. Returns (score 0-100, base64 PNG data-URI heatmap or None).
    """
    from PIL import Image, ImageChops

    try:
        rgb = img.convert("RGB")
        buf = io.BytesIO()
        rgb.save(buf, "JPEG", quality=ELA_QUALITY)
        buf.seek(0)
        resaved = Image.open(buf)

        diff  = ImageChops.difference(rgb, resaved)
        arr   = np.asarray(diff, dtype=np.float32)
        score = float(arr.mean()) / 255.0 * 100.0

        amplified   = np.clip(arr * ELA_SCALE, 0, 255).astype("uint8")
        heat_buf    = io.BytesIO()
        Image.fromarray(amplified).save(heat_buf, "PNG")
        heatmap_b64 = "data:image/png;base64," + base64.b64encode(heat_buf.getvalue()).decode()

        return score, heatmap_b64
    except Exception as exc:
        log.warning("ELA failed: %s", exc)
        return 0.0, None


def _check_quantization(img) -> bool:
    """
    Best-effort resave heuristic: most camera JPEG encoders emit a pair of
    quantization tables (luma + chroma); a single table suggests the file
    passed through a non-camera re-encoder at some point. Low confidence —
    surfaced as a labeled signal, never as an authoritative verdict.
    """
    try:
        qtables = getattr(img, "quantization", None)
        if not qtables:
            return False
        return len(qtables) < 2
    except Exception:
        return False


def _clean_str(val) -> Optional[str]:
    if val is None:
        return None
    s = str(val).strip().strip("\x00")
    return s or None


def _unavailable(msg: str) -> dict:
    return {
        "ok": False,
        "exif_present": False,
        "camera_make": None, "camera_model": None,
        "datetime_original": None,
        "software_tag": None, "editing_software_detected": False,
        "gps_present": False, "resave_detected": False,
        "ela_score": 0.0, "ela_heatmap_b64": None,
        "risk_flags": [], "verdict": "unavailable",
        "error": msg,
    }
