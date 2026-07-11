"""
Passport MRZ (Machine Readable Zone) extraction and ICAO 9303 validation.

International verification approach
------------------------------------
1. OpenCV preprocessing to isolate the MRZ zone (bottom of passport)
2. pytesseract OCR restricted to valid MRZ characters
3. Parse all ICAO 9303 TD3 fields
4. Validate all 5+1 ICAO check digits
5. Cross-check issuing country against full ICAO member state list
6. Expiry and format sanity checks

If every check digit passes the document is internally self-consistent —
any physical alteration to the printed MRZ breaks at least one check digit.
No external API or restricted database is needed for this level of assurance.
"""

import re
import base64
import io
from datetime import date, datetime
from pathlib import Path

# ── Optional deps (graceful degradation) ─────────────────────────────────────
try:
    import cv2
    import numpy as np
    CV2_OK = True
except ImportError:
    CV2_OK = False

try:
    import pytesseract
    from PIL import Image as _PILImage
    # Point at the binary if it's not in PATH (common on Windows)
    import shutil as _shutil, os as _os
    if not _shutil.which('tesseract'):
        for _candidate in [
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        ]:
            if _os.path.isfile(_candidate):
                pytesseract.pytesseract.tesseract_cmd = _candidate
                break
    TESS_OK = True
except ImportError:
    TESS_OK = False

# ── ICAO TD3 constants ────────────────────────────────────────────────────────

TD3_LINE_LEN   = 44
TD3_LINES      = 2
MRZ_CHARSET    = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'
TESS_CONFIG    = '--oem 1 --psm 6 -c tessedit_char_whitelist=ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<'

# Full ICAO 9303 three-letter country codes (Doc 9303 Part 3, Appendix A)
ICAO_COUNTRIES = {
    'AFG','ALB','DZA','AND','AGO','ATG','ARG','ARM','AUS','AUT','AZE',
    'BHS','BHR','BGD','BRB','BLR','BEL','BLZ','BEN','BTN','BOL','BIH',
    'BWA','BRA','BRN','BGR','BFA','BDI','CPV','KHM','CMR','CAN','CAF',
    'TCD','CHL','CHN','COL','COM','COD','COG','CRI','CIV','HRV','CUB',
    'CYP','CZE','DNK','DJI','DOM','ECU','EGY','SLV','GNQ','ERI','EST',
    'SWZ','ETH','FJI','FIN','FRA','GAB','GMB','GEO','DEU','GHA','GRC',
    'GRD','GTM','GIN','GNB','GUY','HTI','HND','HUN','ISL','IND','IDN',
    'IRN','IRQ','IRL','ISR','ITA','JAM','JPN','JOR','KAZ','KEN','KIR',
    'PRK','KOR','KWT','KGZ','LAO','LVA','LBN','LSO','LBR','LBY','LIE',
    'LTU','LUX','MDG','MWI','MYS','MDV','MLI','MLT','MHL','MRT','MUS',
    'MEX','FSM','MDA','MCO','MNG','MNE','MAR','MOZ','MMR','NAM','NRU',
    'NPL','NLD','NZL','NIC','NER','NGA','MKD','NOR','OMN','PAK','PLW',
    'PAN','PNG','PRY','PER','PHL','POL','PRT','QAT','ROU','RUS','RWA',
    'KNA','LCA','VCT','WSM','SMR','STP','SAU','SEN','SRB','SLE','SGP',
    'SVK','SVN','SLB','SOM','ZAF','SSD','ESP','LKA','SDN','SUR','SWE',
    'CHE','SYR','TWN','TJK','TZA','THA','TLS','TGO','TON','TTO','TUN',
    'TUR','TKM','TUV','UGA','UKR','ARE','GBR','USA','URY','UZB','VUT',
    'VEN','VNM','YEM','ZMB','ZWE',
    # Special travel document codes
    'UNO','UNK','UNA','XOM','XXX','EUE',
}


# ── Public API ────────────────────────────────────────────────────────────────

def verify_passport(image_data) -> dict:
    """
    Full MRZ pipeline for a passport image.

    image_data : base64 data-URI string, raw bytes, or file path

    Returns a structured verdict:
    {
        'ok':           bool,
        'verdict':      'valid'|'expired'|'tampered'|'unreadable'|'error',
        'confidence':   float 0-1,   # OCR confidence
        'fields':       { ... },     # parsed MRZ fields
        'checks':       { ... },     # per-field check digit results
        'alerts':       [ ... ],     # list of human-readable issues
        'raw_lines':    [str, str],  # raw OCR lines for debugging
        'error':        str|None,
    }
    """
    if not CV2_OK:
        return _err('opencv not installed')
    if not TESS_OK:
        return _err('pytesseract / Pillow not installed, or tesseract binary missing')

    img_bytes = _decode_to_bytes(image_data)
    if img_bytes is None:
        return _err('could not decode image')

    # 1. Locate + extract MRZ zone
    mrz_crop = _extract_mrz_zone(img_bytes)
    if mrz_crop is None:
        return _err('MRZ zone not found — ensure passport bottom is visible and well-lit')

    # 2. OCR
    line1, line2, confidence = _ocr_mrz(mrz_crop)
    if not line1 or not line2:
        return _err('OCR produced no readable MRZ lines')

    # 3. Clean + normalise
    line1 = _clean_mrz_line(line1, TD3_LINE_LEN)
    line2 = _clean_mrz_line(line2, TD3_LINE_LEN)

    if len(line1) != TD3_LINE_LEN or len(line2) != TD3_LINE_LEN:
        return {
            **_err(f'MRZ lines wrong length ({len(line1)}, {len(line2)}) — poor image quality or non-passport document'),
            'raw_lines': [line1, line2],
            'confidence': confidence,
        }

    # 4. Parse fields
    fields = _parse_td3(line1, line2)

    # 5. Validate check digits
    checks = _validate_checks(line2, fields)

    # 6. Validate country
    alerts = []
    country_ok = fields['issuing_country'] in ICAO_COUNTRIES
    if not country_ok:
        alerts.append(f'Issuing country code "{fields["issuing_country"]}" not in ICAO member list')

    # 7. Expiry check
    is_expired, expiry_date = _check_expiry(fields.get('expiry_date_raw', ''))
    if is_expired:
        alerts.append(f'Passport expired on {expiry_date}')

    # 8. Document type
    if not fields.get('doc_type', '').startswith('P'):
        alerts.append(f'Document type "{fields.get("doc_type")}" — not a standard passport')

    # 9. Aggregate
    all_checks_pass = all(checks.values())
    if not all_checks_pass:
        failed = [k for k, v in checks.items() if not v]
        alerts.append(f'Check digit failure(s): {", ".join(failed)} — document may be altered')

    if not all_checks_pass:
        verdict = 'tampered'
    elif is_expired:
        verdict = 'expired'
    elif alerts:
        verdict = 'valid_with_warnings'
    else:
        verdict = 'valid'

    return {
        'ok':         True,
        'verdict':    verdict,
        'confidence': confidence,
        'fields':     fields,
        'checks':     checks,
        'country_valid': country_ok,
        'is_expired': is_expired,
        'alerts':     alerts,
        'raw_lines':  [line1, line2],
        'error':      None,
    }


# ── MRZ zone detection ────────────────────────────────────────────────────────

def _extract_mrz_zone(img_bytes: bytes) -> 'np.ndarray | None':
    """
    Locate the MRZ zone in the passport image.

    Strategy:
      1. Horizontal projection in bottom 25% — MRZ rows have the highest
         ink density in that region; pick the densest band.
      2. Blackhat morphology fallback — finds wide dark-text contours.
      3. Fixed bottom-25% crop — last resort, almost always works.
    """
    arr = np.frombuffer(img_bytes, np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        return None

    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # ── Strategy 1: projection in bottom 25% (most reliable) ──────────────────
    bot_start = int(h * 0.75)
    lower     = gray[bot_start:, :]
    lh        = lower.shape[0]
    if lh > 10:
        _, bw   = cv2.threshold(lower, 0, 255, cv2.THRESH_BINARY_INV | cv2.THRESH_OTSU)
        row_sum = np.sum(bw, axis=1)
        peak    = np.max(row_sum)
        if peak > 0:
            thresh_val = peak * 0.30
            dense = np.where(row_sum > thresh_val)[0]
            if len(dense) >= 10:
                pad  = max(5, int(lh * 0.05))
                y1   = max(0,  bot_start + int(dense[0])  - pad)
                y2   = min(h,  bot_start + int(dense[-1]) + pad)
                crop = img[y1:y2, :]
                if crop.shape[0] > 10:
                    return crop

    # ── Strategy 2: blackhat morphology ────────────────────────────────────────
    rect_k      = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 8, 1))
    blackhat    = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, rect_k)
    _, thresh   = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
    close_k     = cv2.getStructuringElement(cv2.MORPH_RECT, (w // 6, max(1, h // 25)))
    closed      = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, close_k)
    contours, _ = cv2.findContours(closed, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates  = []
    for c in contours:
        x, y, cw, ch = cv2.boundingRect(c)
        if y > h * 0.6 and cw / max(ch, 1) > 4 and cw > w * 0.5:
            candidates.append((x, y, cw, ch))
    if candidates:
        candidates.sort(key=lambda r: r[1])
        y1   = max(0, candidates[0][1] - 8)
        y2   = min(h, candidates[-1][1] + candidates[-1][3] + 8)
        crop = img[y1:y2, :]
        if crop.shape[0] > 10:
            return crop

    # ── Strategy 3: fixed bottom-25% crop ──────────────────────────────────────
    crop = img[int(h * 0.75):, :]
    return crop if crop.shape[0] > 10 else None


# ── OCR ───────────────────────────────────────────────────────────────────────

def _ocr_mrz(crop: 'np.ndarray') -> tuple:
    """
    OCR the MRZ crop. Returns (line1, line2, confidence_0_to_1).
    line1 starts with P (document type), line2 starts with the passport number.
    """
    processed = _preprocess_for_ocr(crop)
    pil_img   = _PILImage.fromarray(processed)

    # Primary: image_to_string is the most straightforward for dense text blocks
    raw_text   = pytesseract.image_to_string(pil_img, config=TESS_CONFIG)
    confidence = 0.5

    # Also get per-token confidence for a better score estimate
    try:
        data   = pytesseract.image_to_data(pil_img, config=TESS_CONFIG,
                                            output_type=pytesseract.Output.DICT)
        confs  = [float(c) for c in data['conf'] if float(c) > 0]
        if confs:
            confidence = sum(confs) / len(confs) / 100.0
    except Exception:
        pass

    # Strip whitespace between characters but keep newlines for line splitting
    lines = raw_text.strip().splitlines()
    # Extract runs of valid MRZ chars (≥20) from each line
    mrz_lines = []
    for ln in lines:
        cleaned = re.sub(r'[^A-Z0-9<]', '', ln.upper())
        if len(cleaned) >= 20:
            mrz_lines.append(cleaned)

    # If that gives nothing, try the whole text as one block
    if not mrz_lines:
        blob = re.sub(r'[^A-Z0-9<\n]', '', raw_text.upper())
        mrz_lines = [m for m in re.findall(r'[A-Z0-9<]{20,}', blob)]

    # line1 starts with P, line2 is the other (if we can tell)
    l1 = next((l for l in mrz_lines if l.startswith('P')), '')
    l2 = next((l for l in mrz_lines if not l.startswith('P') and l != l1), '')
    # Fallback: just take first two by order
    if not l1 and len(mrz_lines) >= 1: l1 = mrz_lines[0]
    if not l2 and len(mrz_lines) >= 2: l2 = mrz_lines[1]

    return l1, l2, round(confidence, 3)


def _preprocess_for_ocr(crop: 'np.ndarray') -> 'np.ndarray':
    """
    Upscale, sharpen, and binarize the MRZ zone for better OCR accuracy.
    Target height 200px gives tesseract enough resolution for OCR-B font.
    """
    h, w  = crop.shape[:2]
    target_h = 200
    scale    = target_h / max(h, 1)
    new_w    = max(1, int(w * scale))
    resized  = cv2.resize(crop, (new_w, target_h), interpolation=cv2.INTER_CUBIC)

    gray = cv2.cvtColor(resized, cv2.COLOR_BGR2GRAY)
    gray = cv2.GaussianBlur(gray, (3, 3), 0)
    _, bw = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)

    # Invert if background is dark (negative scan)
    if np.mean(bw) < 127:
        bw = cv2.bitwise_not(bw)

    return bw


# ── MRZ line utilities ────────────────────────────────────────────────────────

def _clean_mrz_line(line: str, target_len: int) -> str:
    """Remove whitespace, upper-case, truncate/pad to target length."""
    cleaned = re.sub(r'[^A-Z0-9<]', '<', line.upper().replace(' ', ''))
    if len(cleaned) > target_len:
        # Try to find the 44-char window
        for i in range(len(cleaned) - target_len + 1):
            candidate = cleaned[i:i + target_len]
            if re.match(r'^[A-Z0-9<]+$', candidate):
                return candidate
        return cleaned[:target_len]
    return cleaned.ljust(target_len, '<')


# ── ICAO 9303 TD3 parser ──────────────────────────────────────────────────────

def _parse_td3(line1: str, line2: str) -> dict:
    """
    Parse both 44-char MRZ lines per ICAO 9303 Part 4 (TD3 / passport).
    """
    # Line 1
    doc_type        = line1[0:2].rstrip('<')
    issuing_country = line1[2:5]
    name_field      = line1[5:44]
    parts           = name_field.split('<<', 1)
    surname         = parts[0].replace('<', ' ').strip()
    given_names     = parts[1].replace('<', ' ').strip() if len(parts) > 1 else ''

    # Line 2
    passport_number  = line2[0:9]
    check_pn         = line2[9]
    nationality      = line2[10:13]
    dob_raw          = line2[13:19]
    check_dob        = line2[19]
    sex              = line2[20]
    expiry_raw       = line2[21:27]
    check_expiry     = line2[27]
    personal_number  = line2[28:42]
    check_personal   = line2[42]
    check_composite  = line2[43]

    return {
        'doc_type':          doc_type,
        'issuing_country':   issuing_country,
        'surname':           surname,
        'given_names':       given_names,
        'passport_number':   passport_number.rstrip('<'),
        'nationality':       nationality,
        'date_of_birth_raw': dob_raw,
        'date_of_birth':     _format_date(dob_raw, is_dob=True),
        'sex':               sex if sex in ('M', 'F') else 'unspecified',
        'expiry_date_raw':   expiry_raw,
        'expiry_date':       _format_date(expiry_raw, is_dob=False),
        'personal_number':   personal_number.rstrip('<'),
        # raw check digit chars (for validation)
        '_cd_pn':            check_pn,
        '_cd_dob':           check_dob,
        '_cd_expiry':        check_expiry,
        '_cd_personal':      check_personal,
        '_cd_composite':     check_composite,
    }


def _format_date(yymmdd: str, is_dob: bool) -> str:
    """Convert YYMMDD to YYYY-MM-DD with century disambiguation."""
    if not yymmdd or len(yymmdd) != 6 or not yymmdd.isdigit():
        return yymmdd
    yy, mm, dd = int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:])
    if is_dob:
        # DOB: if YY > current year's last two digits → 1900s
        current_yy = datetime.now().year % 100
        year = 1900 + yy if yy > current_yy else 2000 + yy
    else:
        # Expiry: always in the future → 2000s
        year = 2000 + yy
    try:
        return date(year, mm, dd).isoformat()
    except ValueError:
        return yymmdd


# ── ICAO check digit validation ───────────────────────────────────────────────

_CD_WEIGHTS = [7, 3, 1]

def _char_value(c: str) -> int:
    if c.isdigit():
        return int(c)
    if c.isalpha():
        return ord(c.upper()) - ord('A') + 10
    return 0  # '<' and filler

def _check_digit(s: str) -> int:
    total = sum(_char_value(c) * _CD_WEIGHTS[i % 3] for i, c in enumerate(s))
    return total % 10

def _validate_checks(line2: str, fields: dict) -> dict:
    """
    Validate all 5 + 1 ICAO check digits.
    Returns dict of field → bool.
    """
    def ok(data: str, expected_char: str) -> bool:
        try:
            return _check_digit(data) == int(expected_char)
        except Exception:
            return False

    composite_data = line2[0:10] + line2[13:20] + line2[21:43]

    return {
        'passport_number':  ok(line2[0:9],   fields['_cd_pn']),
        'date_of_birth':    ok(line2[13:19],  fields['_cd_dob']),
        'expiry_date':      ok(line2[21:27],  fields['_cd_expiry']),
        'personal_number':  ok(line2[28:42],  fields['_cd_personal']),
        'composite':        ok(composite_data, fields['_cd_composite']),
    }


# ── Expiry check ──────────────────────────────────────────────────────────────

def _check_expiry(expiry_raw: str) -> tuple:
    """Returns (is_expired: bool, formatted_date: str)."""
    if not expiry_raw or len(expiry_raw) != 6 or not expiry_raw.isdigit():
        return False, ''
    yy, mm, dd = int(expiry_raw[:2]), int(expiry_raw[2:4]), int(expiry_raw[4:])
    year = 2000 + yy
    try:
        expiry = date(year, mm, dd)
        return expiry < date.today(), expiry.isoformat()
    except ValueError:
        return False, expiry_raw


# ── Decode helpers ────────────────────────────────────────────────────────────

def _decode_to_bytes(data) -> 'bytes | None':
    if hasattr(data, 'shape') and hasattr(data, 'dtype'):
        # np.ndarray (RGB) — e.g. an already-aligned crop from core.alignment
        bgr = cv2.cvtColor(data, cv2.COLOR_RGB2BGR)
        ok, encoded = cv2.imencode('.jpg', bgr)
        return encoded.tobytes() if ok else None
    if isinstance(data, (str, Path)):
        s = str(data)
        if s.startswith('data:'):
            _, b64 = s.split(',', 1)
            try:
                return base64.b64decode(b64)
            except Exception:
                return None
        # file path
        try:
            return Path(s).read_bytes()
        except Exception:
            return None
    if isinstance(data, (bytes, bytearray)):
        return bytes(data)
    if hasattr(data, 'read'):
        return data.read()
    return None


def _err(msg: str) -> dict:
    return {
        'ok': False, 'verdict': 'error', 'confidence': 0.0,
        'fields': {}, 'checks': {}, 'country_valid': False,
        'is_expired': False, 'alerts': [msg],
        'raw_lines': [], 'error': msg,
    }
