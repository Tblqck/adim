"""
Document alignment — Unet document segmentation + homography warp.

Model: document_seg_unet.onnx (Unet/ResNet34, from ternaus/midv-500-models,
trained on MIDV-500 — photos of ID documents incl. passports under
real-world capture conditions). Loads from production/models/ if present.
Falls back to a plain resize when no model is loaded or no confident
document region is found.

Usage:
    from production.core.alignment import align_document
    flat = align_document(img_np)                    # fixed ID-1 card shape (800x506)
    flat = align_document(img_np, auto_aspect=True)   # preserve detected doc's own aspect ratio
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

from production.core.geometry import warp_to_quad, warp_to_rect

log = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
_MODEL_PATH = _MODELS_DIR / "document_seg_unet.onnx"

# Target output size for the aligned card (ID-1 landscape) — used unless
# auto_aspect=True is requested.
_OUT_W = 800
_OUT_H = 506

# Unet input size + ImageNet normalisation (matches the training config)
_IN_SIZE = 512
_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_STD  = np.array([0.229, 0.224, 0.225], dtype=np.float32)

# Reject a detected region smaller than this share of the frame — almost
# certainly a false positive, not the actual document.
_MIN_AREA_FRAC = 0.10

_session = None


def _load_model():
    global _session
    if _session is not None:
        return _session
    if not _MODEL_PATH.exists():
        log.warning("document_seg_unet.onnx not found — alignment will use full image")
        return None
    try:
        import onnxruntime as ort
        _session = ort.InferenceSession(
            str(_MODEL_PATH),
            providers=["CPUExecutionProvider"],
        )
        log.info("Document alignment model loaded: %s", _MODEL_PATH.name)
    except Exception as exc:
        log.warning("Failed to load alignment model: %s", exc)
        _session = None
    return _session


def _preprocess(img: np.ndarray) -> np.ndarray:
    """Resize to the Unet's input size and ImageNet-normalise. Returns NCHW float32 blob."""
    resized = cv2.resize(img, (_IN_SIZE, _IN_SIZE)).astype(np.float32) / 255.0
    normed  = (resized - _MEAN) / _STD
    return normed.transpose(2, 0, 1)[np.newaxis].astype(np.float32)


def _predict_mask(sess, img: np.ndarray) -> "np.ndarray | None":
    """Run the Unet and return a (h, w) uint8 mask (0/255) at the original image size."""
    h, w = img.shape[:2]
    blob = _preprocess(img)
    try:
        logits = sess.run(None, {sess.get_inputs()[0].name: blob})[0]
    except Exception as exc:
        log.warning("Alignment inference failed: %s", exc)
        return None

    probs = 1.0 / (1.0 + np.exp(-logits[0, 0]))  # sigmoid, (_IN_SIZE, _IN_SIZE)
    mask  = (probs > 0.5).astype(np.uint8) * 255
    mask  = cv2.resize(mask, (w, h), interpolation=cv2.INTER_NEAREST)

    # Close small gaps (glare/text breaking up the mask), then open to drop speckle noise.
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    mask   = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    mask   = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
    return mask


def _four_corners(mask: np.ndarray) -> np.ndarray | None:
    """Extract the 4 corner points of the largest contour in the mask."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    if cv2.contourArea(cnt) < mask.shape[0] * mask.shape[1] * _MIN_AREA_FRAC:
        return None
    peri = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
    if len(approx) != 4:
        rect = cv2.minAreaRect(cnt)
        box = cv2.boxPoints(rect)
        return np.int32(box)
    return approx.reshape(4, 2)


def _fallback(img: np.ndarray, auto_aspect: bool) -> np.ndarray:
    """No model / no detection — return the image resized to the target shape."""
    if auto_aspect:
        return img
    return cv2.resize(img, (_OUT_W, _OUT_H))


def align_document(img: np.ndarray, auto_aspect: bool = False) -> np.ndarray:
    """
    Detect the document region and warp it to a flat rectangle.

    img must be RGB np.ndarray (H, W, 3).
    auto_aspect=False (default): warp to the fixed ID-1 card shape (800x506) —
        used by the card/blueprint OCR path.
    auto_aspect=True: warp to a rectangle matching the detected region's own
        aspect ratio — used by the passport path, where the visible page(s)
        aren't a fixed known shape.
    """
    sess = _load_model()
    if sess is None:
        return _fallback(img, auto_aspect)

    mask = _predict_mask(sess, img)
    if mask is None:
        return _fallback(img, auto_aspect)

    corners = _four_corners(mask)
    if corners is None:
        return _fallback(img, auto_aspect)

    if auto_aspect:
        return warp_to_quad(img, corners)
    return warp_to_rect(img, corners, _OUT_W, _OUT_H)
