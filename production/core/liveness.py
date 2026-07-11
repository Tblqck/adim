"""
Silent liveness / anti-spoofing — MiniFASNetV2 ONNX.

Model: 2.7_80x80_MiniFASNetV2.onnx (~0.4 MB)
Source: github.com/minivision-ai/Silent-Face-Anti-Spoofing

Place the model file in production/models/.

Falls back to a sharpness-based heuristic when the model is not present:
a printed photo held to the camera tends to have lower Laplacian variance
than a real live face, so it gives a rough signal with no dependencies.

Public API:
    check_liveness(frame: np.ndarray) → {"is_live": bool, "score": float, "method": str}
    check_frames(frames: list[np.ndarray]) → {"is_live": bool, "score": float, ...}
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
_MODEL_PATH = _MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx"

# MiniFASNet processes 80×80 patches
_INPUT_SIZE = (80, 80)

# Softmax output: [spoof_prob, live_prob]
_LIVE_THRESHOLD = 0.60

_session = None


def _load_model():
    global _session
    if _session is not None:
        return _session
    if not _MODEL_PATH.exists():
        log.warning("MiniFASNetV2.onnx not found — liveness will use sharpness heuristic")
        return None
    try:
        import onnxruntime as ort
        _session = ort.InferenceSession(str(_MODEL_PATH), providers=["CPUExecutionProvider"])
        log.info("Liveness model loaded: %s", _MODEL_PATH.name)
    except Exception as exc:
        log.warning("Failed to load liveness model: %s", exc)
    return _session


def _face_crop_80(img: np.ndarray) -> np.ndarray | None:
    """Detect face and return an 80×80 RGB crop, or None."""
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    cc   = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    for sf, mn in [(1.1, 5), (1.15, 4), (1.2, 3)]:
        faces = cc.detectMultiScale(gray, scaleFactor=sf, minNeighbors=mn, minSize=(48, 48))
        if len(faces):
            x, y, w, h = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)[0]
            # 2.7× expansion as per MiniFASNet original repo
            scale = 2.7
            cx, cy = x + w // 2, y + h // 2
            half   = int(max(w, h) * scale / 2)
            ih, iw = img.shape[:2]
            x1 = max(0, cx - half)
            y1 = max(0, cy - half)
            x2 = min(iw, cx + half)
            y2 = min(ih, cy + half)
            crop = img[y1:y2, x1:x2]
            return cv2.resize(crop, _INPUT_SIZE)
    return None


def _preprocess(crop: np.ndarray) -> np.ndarray:
    blob = crop.astype(np.float32)
    blob -= np.array([123.0, 117.0, 104.0], dtype=np.float32)
    blob = blob.transpose(2, 0, 1)[np.newaxis]
    return blob


def _sharpness_score(img: np.ndarray) -> float:
    """Laplacian variance — higher = sharper = more likely live."""
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    lap  = cv2.Laplacian(gray, cv2.CV_64F).var()
    # Clamp to [0,1] — empirically: live faces ≥ 100, printed photos ≤ 40
    return float(min(max(lap / 150.0, 0.0), 1.0))


def check_liveness(frame: np.ndarray) -> dict:
    """
    Run liveness detection on a single RGB frame.

    Returns:
        is_live  (bool)
        score    (float 0–1, higher = more live)
        method   ("onnx" | "heuristic")
    """
    sess = _load_model()

    if sess is not None:
        crop = _face_crop_80(frame)
        if crop is not None:
            blob = _preprocess(crop)
            try:
                out   = sess.run(None, {sess.get_inputs()[0].name: blob})[0][0]
                # Softmax over [spoof, live]
                probs = np.exp(out - out.max())
                probs /= probs.sum()
                live_score = float(probs[1]) if len(probs) > 1 else float(probs[0])
                return {
                    "is_live": live_score >= _LIVE_THRESHOLD,
                    "score":   round(live_score, 4),
                    "method":  "onnx",
                }
            except Exception as exc:
                log.warning("Liveness inference error: %s", exc)

    # Heuristic fallback
    score = _sharpness_score(frame)
    return {
        "is_live": score >= 0.45,
        "score":   round(score, 4),
        "method":  "heuristic",
    }


def check_frames(frames: list[np.ndarray]) -> dict:
    """
    Run liveness check over multiple frames and return the best result.

    Returns:
        is_live        (bool)
        score          (float — best frame score)
        mean_score     (float — average across all frames)
        frame_scores   (list of per-frame dicts)
        method         (str)
    """
    if not frames:
        return {"is_live": False, "score": 0.0, "mean_score": 0.0,
                "frame_scores": [], "method": "none", "error": "no_frames"}

    frame_scores = [check_liveness(f) for f in frames]
    best   = max(frame_scores, key=lambda r: r["score"])
    mean_s = float(np.mean([r["score"] for r in frame_scores]))

    return {
        "is_live":     best["is_live"],
        "score":       best["score"],
        "mean_score":  round(mean_s, 4),
        "frame_scores": frame_scores,
        "method":       best["method"],
    }
