"""
ID card visible text extraction.

Runs tesseract OCR on the full ID image (no character whitelist) and
attempts to identify standard fields (name, ID number, dates, etc.)
from the raw text.

For passports the MRZ fields (from mrz.py) are already structured —
this module handles the visible printed text on the bio-data page and
on card-format documents.
"""

import re
import base64
from pathlib import Path

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
    import shutil, os
    if not shutil.which('tesseract'):
        for _candidate in [
            r'C:\Program Files\Tesseract-OCR\tesseract.exe',
            r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        ]:
            if os.path.isfile(_candidate):
                pytesseract.pytesseract.tesseract_cmd = _candidate
                break
    TESS_OK = True
except ImportError:
    TESS_OK = False


# ── Public API ────────────────────────────────────────────────────────────────

def extract_text(image_data) -> dict:
    """
    Extract visible text from an ID document image.

    image_data : base64 data-URI string, raw bytes, or file path

    Returns:
        {
            'ok':     bool,
            'raw':    str,          # full OCR dump
            'lines':  [str],        # non-empty lines
            'fields': {             # best-effort field identification
                'name':          str | None,
                'id_number':     str | None,
                'date_of_birth': str | None,
                'expiry_date':   str | None,
                'nationality':   str | None,
                'sex':           str | None,
                'address':       str | None,
            },
            'error':  str | None,
        }
    """
    if not CV2_OK:
        return _err('opencv not installed')
    if not TESS_OK:
        return _err('pytesseract not installed or tesseract binary not found')

    img = _decode(image_data)
    if img is None:
        return _err('could not decode image')

    processed = _preprocess(img)
    pil_img   = _PILImage.fromarray(processed)

    try:
        raw = pytesseract.image_to_string(pil_img, config='--oem 1 --psm 6')
    except Exception as exc:
        return _err(f'OCR failed: {exc}')

    lines  = [l.strip() for l in raw.splitlines() if l.strip()]
    fields = _extract_fields(lines, raw)

    return {
        'ok':     True,
        'raw':    raw.strip(),
        'lines':  lines,
        'fields': fields,
        'error':  None,
    }


# ── Preprocessing ─────────────────────────────────────────────────────────────

def _preprocess(img: 'np.ndarray') -> 'np.ndarray':
    h, w = img.shape[:2]
    if w < 1200:
        scale = 1200 / w
        img   = cv2.resize(img, (1200, int(h * scale)), interpolation=cv2.INTER_CUBIC)
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    binary = cv2.adaptiveThreshold(
        gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY,
        31, 10,
    )
    return binary


# ── Field extraction ──────────────────────────────────────────────────────────

_DATE_RE = re.compile(
    r'\b(\d{2}[/\-\.]\d{2}[/\-\.]\d{4}'   # DD/MM/YYYY
    r'|\d{4}[/\-\.]\d{2}[/\-\.]\d{2}'     # YYYY-MM-DD
    r'|\d{2}\s+\w{3,9}\s+\d{4})\b',       # 15 April 1990
    re.IGNORECASE,
)

_ID_RE = re.compile(r'\b([A-Z]{0,3}\d{5,15}[A-Z]{0,3})\b')

_NAME_KEYWORDS    = ('SURNAME', 'FAMILY NAME', 'LAST NAME', 'NOM', 'APELLIDO')
_GIVEN_KEYWORDS   = ('GIVEN NAME', 'FIRST NAME', 'PRÉNOM', 'FORENAME', 'NOMBRE')
_ID_KEYWORDS      = ('ID NO', 'ID NUMBER', 'DOCUMENT NO', 'PASSPORT NO', 'NIN',
                     'NUMBER', 'NUMERO', 'NUMÉRO', 'CARD NO')
_DOB_KEYWORDS     = ('DATE OF BIRTH', 'DOB', 'BIRTH DATE', 'BORN', 'DATE NAISS',
                     'DATA NASC', 'FECHA NAC')
_EXPIRY_KEYWORDS  = ('EXPIRY', 'EXPIRES', 'EXPIRATION', 'VALID UNTIL', 'DATE EXPIR',
                     'GÜLTIG BIS', 'VALIDO HASTA')
_NATION_KEYWORDS  = ('NATIONALITY', 'NATIONALITÉ', 'NATIONALITÄT', 'NAZIONALITÀ')
_SEX_KEYWORDS     = ('SEX', 'GENDER', 'SEXE', 'GESCHLECHT')
_ADDR_KEYWORDS    = ('ADDRESS', 'ADDR', 'RESIDENCE', 'DOMICILE', 'WOHNORT')


def _extract_fields(lines: list, raw: str) -> dict:
    fields = {
        'name':          None,
        'id_number':     None,
        'date_of_birth': None,
        'expiry_date':   None,
        'nationality':   None,
        'sex':           None,
        'address':       None,
    }

    dates_found = _DATE_RE.findall(raw)

    for i, line in enumerate(lines):
        u = line.upper()
        next_line = lines[i + 1] if i + 1 < len(lines) else ''

        # Surname
        if any(kw in u for kw in _NAME_KEYWORDS):
            candidate = next_line if next_line and not any(c.isdigit() for c in next_line) else ''
            if candidate and not fields['name']:
                fields['name'] = candidate.strip()

        # Given names (append to surname if already found)
        if any(kw in u for kw in _GIVEN_KEYWORDS):
            if next_line:
                given = next_line.strip()
                fields['name'] = ((fields['name'] or '') + ' ' + given).strip()

        # ID number — try to extract from the same line or the next
        if any(kw in u for kw in _ID_KEYWORDS) and not fields['id_number']:
            m = _ID_RE.search(line) or _ID_RE.search(next_line)
            if m:
                fields['id_number'] = m.group(1)

        # Date of birth
        if any(kw in u for kw in _DOB_KEYWORDS) and not fields['date_of_birth']:
            m = _DATE_RE.search(line) or _DATE_RE.search(next_line)
            if m:
                fields['date_of_birth'] = m.group()

        # Expiry
        if any(kw in u for kw in _EXPIRY_KEYWORDS) and not fields['expiry_date']:
            m = _DATE_RE.search(line) or _DATE_RE.search(next_line)
            if m:
                fields['expiry_date'] = m.group()

        # Nationality
        if any(kw in u for kw in _NATION_KEYWORDS) and not fields['nationality']:
            parts = line.split(':', 1)
            if len(parts) > 1 and parts[1].strip():
                fields['nationality'] = parts[1].strip()
            elif next_line and len(next_line.strip()) <= 30:
                fields['nationality'] = next_line.strip()

        # Sex
        if any(kw in u for kw in _SEX_KEYWORDS) and not fields['sex']:
            if re.search(r'\bM\b|\bMALE\b', u):
                fields['sex'] = 'M'
            elif re.search(r'\bF\b|\bFEMALE\b', u):
                fields['sex'] = 'F'

        # Address
        if any(kw in u for kw in _ADDR_KEYWORDS) and not fields['address']:
            if next_line:
                fields['address'] = next_line.strip()

    # Fallback: use first/second dates if not already identified
    if not fields['date_of_birth'] and len(dates_found) >= 1:
        fields['date_of_birth'] = dates_found[0]
    if not fields['expiry_date'] and len(dates_found) >= 2:
        fields['expiry_date'] = dates_found[1]

    # Strip None values for a cleaner response
    return {k: v for k, v in fields.items() if v is not None}


# ── Decode helpers ────────────────────────────────────────────────────────────

def _decode(data) -> 'np.ndarray | None':
    if isinstance(data, (str, Path)):
        s = str(data)
        if s.startswith('data:'):
            _, b64 = s.split(',', 1)
            data = base64.b64decode(b64)
        else:
            return cv2.imread(s) if CV2_OK else None
    if isinstance(data, (bytes, bytearray)) and CV2_OK:
        arr = np.frombuffer(data, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if CV2_OK and hasattr(data, '__class__') and 'ndarray' in str(type(data)):
        return data
    return None


def _err(msg: str) -> dict:
    return {
        'ok': False, 'raw': '', 'lines': [],
        'fields': {}, 'error': msg,
    }
