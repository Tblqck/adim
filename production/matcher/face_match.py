"""
Face matching: extract the face from the ID document photo and compare
it against the liveness selfie.

Uses OpenCV Haar cascades (built into opencv-python-headless — no extra
model downloads needed). Comparison is histogram + normalised cross-
correlation, which is lightweight and works on Render free tier.
"""

import base64
from pathlib import Path

try:
    import cv2
    import numpy as np
    CV2_OK = True
except ImportError:
    CV2_OK = False

_CASCADE = None


def _get_cascade():
    global _CASCADE
    if _CASCADE is None and CV2_OK:
        _CASCADE = cv2.CascadeClassifier(
            cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
        )
    return _CASCADE


def compare_faces(selfie_data, id_image_data) -> dict:
    """
    selfie_data    : bytes or base64 data-URI — the liveness selfie
    id_image_data  : bytes or base64 data-URI — the captured ID photo

    Returns:
        {
            'score':            float 0-1,
            'verdict':          'strong_match'|'likely_match'|'possible_match'|'no_match',
            'selfie_face_found': bool,
            'id_face_found':     bool,
            'error':            str|None,
        }
    """
    if not CV2_OK:
        return _err('opencv not installed')

    selfie = _decode(selfie_data)
    id_img = _decode(id_image_data)

    if selfie is None:
        return _err('could not decode selfie image')
    if id_img is None:
        return _err('could not decode ID image')

    face_s = _extract_face(selfie, strict=False)
    face_i = _extract_face(id_img, strict=True)

    if face_s is None:
        return {**_err('no face found in selfie'), 'selfie_face_found': False, 'id_face_found': face_i is not None}
    if face_i is None:
        return {**_err('no face found in ID photo — ensure face side is captured'), 'selfie_face_found': True, 'id_face_found': False}

    score   = _compare(face_s, face_i)
    verdict = (
        'strong_match'   if score >= 0.72 else
        'likely_match'   if score >= 0.55 else
        'possible_match' if score >= 0.38 else
        'no_match'
    )

    return {
        'score':             round(score, 3),
        'verdict':           verdict,
        'selfie_face_found': True,
        'id_face_found':     True,
        'error':             None,
    }


# ── Face extraction ───────────────────────────────────────────────────────────

def _extract_face(img: 'np.ndarray', strict: bool = False) -> 'np.ndarray | None':
    """
    Detect face in img and return the cropped + padded region.
    strict=True uses tighter parameters (better for small ID photo faces).
    """
    gray   = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    cascade = _get_cascade()

    # Try progressively looser settings until a face is found
    configs = (
        [(1.05, 6), (1.1, 4), (1.15, 3)]
        if strict else
        [(1.1, 4), (1.15, 3), (1.2, 2)]
    )

    for scale, min_n in configs:
        faces = cascade.detectMultiScale(
            gray,
            scaleFactor=scale,
            minNeighbors=min_n,
            minSize=(30, 30),
        )
        if len(faces) > 0:
            x, y, w, h = max(faces, key=lambda f: f[2] * f[3])
            pad = int(min(w, h) * 0.18)
            x1  = max(0, x - pad)
            y1  = max(0, y - pad)
            x2  = min(img.shape[1], x + w + pad)
            y2  = min(img.shape[0], y + h + pad)
            return img[y1:y2, x1:x2]

    return None


# ── Comparison ────────────────────────────────────────────────────────────────

def _compare(a: 'np.ndarray', b: 'np.ndarray') -> float:
    size = (96, 96)
    a = cv2.resize(a, size)
    b = cv2.resize(b, size)

    # HSV histogram similarity (robust to brightness/contrast difference)
    a_hsv = cv2.cvtColor(a, cv2.COLOR_BGR2HSV)
    b_hsv = cv2.cvtColor(b, cv2.COLOR_BGR2HSV)
    hist_score = 0.0
    for ch, bins, rng in [(0, 30, [0, 180]), (1, 32, [0, 256])]:
        ha = cv2.calcHist([a_hsv], [ch], None, [bins], rng)
        hb = cv2.calcHist([b_hsv], [ch], None, [bins], rng)
        cv2.normalize(ha, ha)
        cv2.normalize(hb, hb)
        hist_score += cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL)
    hist_score = max(0.0, hist_score / 2.0)

    # Normalised cross-correlation on grayscale (structural similarity)
    ag = cv2.cvtColor(a, cv2.COLOR_BGR2GRAY).astype(np.float32)
    bg = cv2.cvtColor(b, cv2.COLOR_BGR2GRAY).astype(np.float32)
    ag = (ag - ag.mean()) / (ag.std() + 1e-6)
    bg = (bg - bg.mean()) / (bg.std() + 1e-6)
    ncc = float(np.mean(ag * bg))
    ncc_score = max(0.0, (ncc + 1.0) / 2.0)

    return 0.5 * hist_score + 0.5 * ncc_score


# ── Decode ────────────────────────────────────────────────────────────────────

def _decode(data) -> 'np.ndarray | None':
    if isinstance(data, (str, Path)):
        s = str(data)
        if s.startswith('data:'):
            _, b64 = s.split(',', 1)
            data = base64.b64decode(b64)
        else:
            return cv2.imread(s)
    if isinstance(data, (bytes, bytearray)):
        arr = np.frombuffer(data, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if CV2_OK:
        if isinstance(data, np.ndarray):
            return data
    return None


def _err(msg: str) -> dict:
    return {
        'score': 0.0, 'verdict': 'error',
        'selfie_face_found': False, 'id_face_found': False,
        'error': msg,
    }
