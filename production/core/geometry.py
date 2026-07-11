"""
Shared quadrilateral ordering + perspective-warp helpers, used by
core/alignment.py to warp a detected document quad to a flat rectangle.
"""

from __future__ import annotations

import cv2
import numpy as np


def order_points(pts: np.ndarray) -> np.ndarray:
    """Order 4 points as: top-left, top-right, bottom-right, bottom-left."""
    rect = np.zeros((4, 2), dtype=np.float32)
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def warp_to_rect(img: np.ndarray, corners: np.ndarray, out_w: int, out_h: int) -> np.ndarray:
    """Perspective-warp the quadrilateral `corners` in `img` to an out_w x out_h rectangle."""
    src = order_points(corners.astype(np.float32))
    dst = np.array([
        [0, 0],
        [out_w - 1, 0],
        [out_w - 1, out_h - 1],
        [0, out_h - 1],
    ], dtype=np.float32)
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(img, M, (out_w, out_h))


def warp_to_quad(img: np.ndarray, corners: np.ndarray, max_dim: int = 1200) -> np.ndarray:
    """
    Perspective-warp `corners` to a rectangle sized to match the quad's own
    aspect ratio (unlike warp_to_rect, which forces a fixed target shape).

    Useful when the detected document isn't a known fixed shape (e.g. an
    open passport booklet, which can be closer to square/landscape than a
    single portrait bio page). Output is capped at max_dim on the long side.
    """
    src = order_points(corners.astype(np.float32))
    tl, tr, br, bl = src

    width_top    = np.linalg.norm(tr - tl)
    width_bottom = np.linalg.norm(br - bl)
    max_width    = max(width_top, width_bottom)

    height_left  = np.linalg.norm(bl - tl)
    height_right = np.linalg.norm(br - tr)
    max_height   = max(height_left, height_right)

    scale = max_dim / max(max_width, max_height, 1.0)
    out_w = max(1, int(round(max_width * scale)))
    out_h = max(1, int(round(max_height * scale)))

    return warp_to_rect(img, corners, out_w, out_h)
