"""
Document alignment — YOLOv8n segmentation + homography warp.

Loads yolov8n-document-seg.onnx from production/models/ if present.
Falls back to a center-crop that preserves the full image when no model is loaded.

Usage:
    from production.core.alignment import align_document
    flat = align_document(img_np)   # → np.ndarray (H, W, 3), standardised rectangle
"""

from __future__ import annotations

import logging
from pathlib import Path

import cv2
import numpy as np

log = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
_MODEL_PATH = _MODELS_DIR / "yolov8n-document-seg.onnx"

# Target output size for the aligned card (ID-1 landscape)
_OUT_W = 800
_OUT_H = 506

_session = None


def _load_model():
    global _session
    if _session is not None:
        return _session
    if not _MODEL_PATH.exists():
        log.warning("yolov8n-document-seg.onnx not found — alignment will use full image")
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


def _preprocess(img: np.ndarray, size: int = 640) -> tuple[np.ndarray, float, int, int]:
    """Resize keeping aspect ratio, pad to square. Returns (blob, scale, pad_w, pad_h)."""
    h, w = img.shape[:2]
    scale = size / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(img, (new_w, new_h))
    canvas = np.zeros((size, size, 3), dtype=np.uint8)
    pad_h = (size - new_h) // 2
    pad_w = (size - new_w) // 2
    canvas[pad_h:pad_h + new_h, pad_w:pad_w + new_w] = resized
    blob = canvas.astype(np.float32) / 255.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]  # NCHW
    return blob, scale, pad_w, pad_h


def _four_corners(mask: np.ndarray) -> np.ndarray | None:
    """Extract the 4 corner points of the largest contour in the mask."""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    cnt = max(contours, key=cv2.contourArea)
    peri = cv2.arcLength(cnt, True)
    approx = cv2.approxPolyDP(cnt, 0.02 * peri, True)
    if len(approx) != 4:
        rect = cv2.minAreaRect(cnt)
        box = cv2.boxPoints(rect)
        return np.int32(box)
    return approx.reshape(4, 2)


def _order_points(pts: np.ndarray) -> np.ndarray:
    """Order: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def _warp(img: np.ndarray, corners: np.ndarray) -> np.ndarray:
    src = _order_points(corners.astype(np.float32))
    dst = np.array([
        [0, 0],
        [_OUT_W - 1, 0],
        [_OUT_W - 1, _OUT_H - 1],
        [0, _OUT_H - 1],
    ], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (_OUT_W, _OUT_H))


def _fallback(img: np.ndarray) -> np.ndarray:
    """No model / no detection — return centre-cropped resize."""
    return cv2.resize(img, (_OUT_W, _OUT_H))


def align_document(img: np.ndarray) -> np.ndarray:
    """
    Detect card edges and warp to a standard rectangle.
    img must be RGB np.ndarray (H, W, 3).
    Returns RGB np.ndarray (_OUT_H, _OUT_W, 3).
    """
    sess = _load_model()
    if sess is None:
        return _fallback(img)

    blob, scale, pad_w, pad_h = _preprocess(img)

    try:
        outputs = sess.run(None, {sess.get_inputs()[0].name: blob})
    except Exception as exc:
        log.warning("Alignment inference failed: %s", exc)
        return _fallback(img)

    # YOLOv8-seg output: [1, num_classes+4+mask_dim, num_anchors] + [1, mask_dim, H/4, W/4]
    preds = outputs[0][0].T       # (anchors, 4+classes+mask_dim)
    conf  = preds[:, 4]           # class confidence (single class: document)
    best  = int(np.argmax(conf))
    if conf[best] < 0.25:
        log.debug("No document detected (conf=%.2f) — using fallback", conf[best])
        return _fallback(img)

    # Decode bounding box (xyxy in padded 640×640 space)
    cx, cy, bw, bh = preds[best, :4]
    x1 = int((cx - bw / 2 - pad_w) / scale)
    y1 = int((cy - bh / 2 - pad_h) / scale)
    x2 = int((cx + bw / 2 - pad_w) / scale)
    y2 = int((cy + bh / 2 - pad_h) / scale)

    h, w = img.shape[:2]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(w, x2), min(h, y2)

    if x2 <= x1 or y2 <= y1:
        return _fallback(img)

    # Use mask output for precise corners when available
    if len(outputs) > 1:
        try:
            proto      = outputs[1][0]                     # (mask_dim, H/4, W/4)
            mask_coefs = preds[best, 4 + 1:]               # mask coefficients
            mask       = (mask_coefs @ proto.reshape(proto.shape[0], -1)).reshape(proto.shape[1], proto.shape[2])
            mask       = (mask > 0.5).astype(np.uint8) * 255
            # Scale mask back to original image coordinates
            full_mask  = cv2.resize(mask, (640, 640))
            full_mask  = full_mask[pad_h:pad_h + int(h * scale), pad_w:pad_w + int(w * scale)]
            full_mask  = cv2.resize(full_mask, (w, h))
            corners    = _four_corners(full_mask)
            if corners is not None:
                return _warp(img, corners)
        except Exception as exc:
            log.debug("Mask corner extraction failed: %s", exc)

    # Fall back to bounding-box corners
    corners = np.array([[x1, y1], [x2, y1], [x2, y2], [x1, y2]])
    return _warp(img, corners)
