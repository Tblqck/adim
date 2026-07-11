"""
Document authenticity matching.

Compares a captured ID image against a set of reference images using:
  - ORB keypoint matching with ratio test + homography verification
  - Color layout similarity (histogram comparison)

Returns a confidence score 0–1 and a verdict string.
"""

import base64
from pathlib import Path

try:
    import cv2
    import numpy as np
    CV2_OK = True
except ImportError:
    CV2_OK = False


def match_document(client_image_data, ref_paths: list) -> dict:
    """
    client_image_data : bytes or base64 data-URI string
    ref_paths         : list of Path or str pointing to reference images

    Returns:
        {
            'score':        float 0-1,
            'verdict':      'strong_match'|'likely_match'|'weak_match'|'no_match',
            'best':         float,
            'mean':         float,
            'refs_checked': int,
            'details':      [...],
            'error':        str|None,
        }
    """
    if not CV2_OK:
        return _err('opencv not installed')

    client = _decode(client_image_data)
    if client is None:
        return _err('could not decode client image')

    if not ref_paths:
        return _err('no reference images provided')

    client_gray = _preprocess(cv2.cvtColor(client, cv2.COLOR_BGR2GRAY))

    orb        = cv2.ORB_create(nfeatures=1200)
    kp_c, ds_c = orb.detectAndCompute(client_gray, None)

    if ds_c is None or len(kp_c) < 8:
        return _err('too few keypoints in client image — ensure the ID fills the frame')

    bf      = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=False)
    scores  = []
    details = []

    for rp in ref_paths:
        ref = _decode(rp)
        if ref is None:
            continue

        ref_gray       = _preprocess(cv2.cvtColor(ref, cv2.COLOR_BGR2GRAY))
        kp_r, ds_r     = orb.detectAndCompute(ref_gray, None)

        if ds_r is None or len(kp_r) < 8:
            continue

        # kNN match + Lowe ratio test
        raw     = bf.knnMatch(ds_c, ds_r, k=2)
        good    = [m for m, n in raw if m.distance < 0.75 * n.distance]

        inliers   = 0
        geo_ok    = False
        if len(good) >= 8:
            src = np.float32([kp_c[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
            dst = np.float32([kp_r[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)
            _, mask = cv2.findHomography(src, dst, cv2.RANSAC, 5.0)
            if mask is not None:
                inliers = int(mask.sum())
                geo_ok  = inliers >= 6
                good    = [g for g, m in zip(good, mask.ravel().tolist()) if m]

        match_score = min(len(good) / max(len(kp_c), 1), 1.0)
        color_score = _color_sim(client, ref)
        combined    = round(0.65 * match_score + 0.35 * color_score, 4)

        scores.append(combined)
        details.append({
            'ref':          Path(rp).name if not isinstance(rp, bytes) else 'bytes',
            'good_matches': len(good),
            'inliers':      inliers,
            'geo_ok':       geo_ok,
            'color_sim':    round(color_score, 3),
            'score':        combined,
        })

    if not scores:
        return _err('none of the reference images could be loaded / matched')

    best  = max(scores)
    mean  = sum(scores) / len(scores)
    score = round(0.7 * best + 0.3 * mean, 3)

    verdict = (
        'strong_match' if score >= 0.55 else
        'likely_match' if score >= 0.35 else
        'weak_match'   if score >= 0.15 else
        'no_match'
    )

    details.sort(key=lambda x: -x['score'])

    return {
        'score':        score,
        'verdict':      verdict,
        'best':         round(best, 3),
        'mean':         round(mean, 3),
        'refs_checked': len(scores),
        'details':      details[:5],
        'error':        None,
    }


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decode(data) -> 'np.ndarray | None':
    if isinstance(data, (str, Path)):
        path = str(data)
        # data-URI
        if path.startswith('data:'):
            _, b64 = path.split(',', 1)
            data = base64.b64decode(b64)
        else:
            return cv2.imread(path)
    if isinstance(data, (bytes, bytearray)):
        arr = np.frombuffer(data, np.uint8)
        return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if CV2_OK:
        import numpy as _np
        if isinstance(data, _np.ndarray):
            return data
    return None


def _preprocess(gray: 'np.ndarray') -> 'np.ndarray':
    gray = cv2.resize(gray, (800, 500))
    return cv2.equalizeHist(gray)


def _color_sim(a: 'np.ndarray', b: 'np.ndarray') -> float:
    size = (200, 125)
    a = cv2.resize(a, size)
    b = cv2.resize(b, size)
    total = 0.0
    for ch in range(3):
        ha = cv2.calcHist([a], [ch], None, [64], [0, 256])
        hb = cv2.calcHist([b], [ch], None, [64], [0, 256])
        total += cv2.compareHist(ha, hb, cv2.HISTCMP_CORREL)
    return max(0.0, total / 3.0)


def _err(msg: str) -> dict:
    return {
        'score': 0.0, 'verdict': 'error', 'best': 0.0, 'mean': 0.0,
        'refs_checked': 0, 'details': [], 'error': msg,
    }
