"""
Face detection + ArcFace embedding pipeline (InsightFace ONNX).

Models (place in production/models/):
  det_10g.onnx     — SCRFD face detector from InsightFace buffalo_l (~17 MB)
  w600k_r50.onnx   — ArcFace R50 backbone, 512-D embeddings (~167 MB)

Falls back to OpenCV Haar cascade + histogram NCC if ONNX models not present.

Public API:
    detect_faces(img)             -> list of (x1,y1,x2,y2, score)
    embed_face(img, bbox)         -> np.ndarray shape (512,) or None
    cosine_similarity(a, b)       -> float  [-1, 1]
    compare_faces(selfie, id_img) -> {"score": float, "verdict": str, ...}
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

log = logging.getLogger(__name__)

_MODELS_DIR = Path(__file__).resolve().parents[1] / "models"
_DET_PATH   = _MODELS_DIR / "det_10g.onnx"
_EMBED_PATH = _MODELS_DIR / "w600k_r50.onnx"

_det_sess   = None
_embed_sess = None

# SCRFD strides and anchors-per-cell
_STRIDES     = [8, 16, 32]
_NUM_ANCHORS = 2

# ArcFace input size
_FACE_SIZE = (112, 112)


# ── Model loading ─────────────────────────────────────────────────────────────

def _load_det():
    global _det_sess
    if _det_sess is not None:
        return _det_sess
    if not _DET_PATH.exists():
        log.warning("det_10g.onnx not found — face detection will use Haar fallback")
        return None
    try:
        import onnxruntime as ort
        _det_sess = ort.InferenceSession(str(_DET_PATH), providers=["CPUExecutionProvider"])
        log.info("Face detector loaded: %s", _DET_PATH.name)
    except Exception as exc:
        log.warning("Failed to load face detector: %s", exc)
    return _det_sess


def _load_embed():
    global _embed_sess
    if _embed_sess is not None:
        return _embed_sess
    if not _EMBED_PATH.exists():
        log.warning("w600k_r50.onnx not found — face match will use NCC fallback")
        return None
    try:
        import onnxruntime as ort
        _embed_sess = ort.InferenceSession(str(_EMBED_PATH), providers=["CPUExecutionProvider"])
        log.info("ArcFace model loaded: %s", _EMBED_PATH.name)
    except Exception as exc:
        log.warning("Failed to load ArcFace model: %s", exc)
    return _embed_sess


# ── SCRFD anchor grid ─────────────────────────────────────────────────────────

def _gen_anchors(input_h: int, input_w: int) -> list[np.ndarray]:
    """Anchor center coordinates (in input-image space) for each stride level."""
    anchors = []
    for stride in _STRIDES:
        feat_h = input_h // stride
        feat_w = input_w // stride
        grid_y, grid_x = np.mgrid[:feat_h, :feat_w]
        centers = np.stack([grid_x, grid_y], axis=-1).astype(np.float32) * stride
        centers = centers.reshape(-1, 2)
        if _NUM_ANCHORS > 1:
            centers = np.repeat(centers, _NUM_ANCHORS, axis=0)
        anchors.append(centers)
    return anchors


# ── NMS ───────────────────────────────────────────────────────────────────────

def _nms(dets: list, iou_thresh: float = 0.45) -> list:
    if not dets:
        return []
    boxes  = np.array([[x1, y1, x2, y2] for x1, y1, x2, y2, _ in dets], dtype=np.float32)
    scores = np.array([s for _, _, _, _, s in dets], dtype=np.float32)
    areas  = (boxes[:, 2] - boxes[:, 0]) * (boxes[:, 3] - boxes[:, 1])
    order  = scores.argsort()[::-1]
    keep   = []
    while order.size:
        i = order[0]
        keep.append(i)
        xx1   = np.maximum(boxes[i, 0], boxes[order[1:], 0])
        yy1   = np.maximum(boxes[i, 1], boxes[order[1:], 1])
        xx2   = np.minimum(boxes[i, 2], boxes[order[1:], 2])
        yy2   = np.minimum(boxes[i, 3], boxes[order[1:], 3])
        inter = np.maximum(0.0, xx2 - xx1) * np.maximum(0.0, yy2 - yy1)
        iou   = inter / (areas[i] + areas[order[1:]] - inter + 1e-6)
        order = order[1:][iou <= iou_thresh]
    return [dets[i] for i in keep]


# ── Detection ─────────────────────────────────────────────────────────────────

def _preprocess_det(img: np.ndarray) -> tuple[np.ndarray, float, int, int]:
    """Letterbox-resize to 640x640 and normalise to InsightFace convention."""
    h, w    = img.shape[:2]
    scale   = min(640 / h, 640 / w)
    new_h   = int(h * scale)
    new_w   = int(w * scale)
    resized = cv2.resize(img, (new_w, new_h))
    pad_h   = (640 - new_h) // 2
    pad_w   = (640 - new_w) // 2
    canvas  = np.zeros((640, 640, 3), dtype=np.uint8)
    canvas[pad_h:pad_h + new_h, pad_w:pad_w + new_w] = resized
    blob = (canvas.astype(np.float32) - 127.5) / 128.0
    blob = blob.transpose(2, 0, 1)[np.newaxis]   # NCHW
    return blob, scale, pad_w, pad_h


def detect_faces(img: np.ndarray, score_thresh: float = 0.5) -> list[tuple[int, int, int, int, float]]:
    """
    Returns list of (x1, y1, x2, y2, score) sorted by score descending.
    img: RGB np.ndarray (H, W, 3).
    """
    sess = _load_det()
    if sess is None:
        return _haar_detect(img)

    blob, scale, pad_w, pad_h = _preprocess_det(img)
    try:
        outputs = sess.run(None, {sess.get_inputs()[0].name: blob})
    except Exception as exc:
        log.warning("Detection inference failed: %s", exc)
        return _haar_detect(img)

    # SCRFD det_10g outputs (9 tensors):
    #   [0..2]  score (N_i, 1)   for strides [8, 16, 32]
    #   [3..5]  bbox  (N_i, 4)   raw distance predictions (l,t,r,b)
    #   [6..8]  kps   (N_i, 10)  (unused)
    anchors = _gen_anchors(640, 640)

    results = []
    for i, (stride, anchor_centers) in enumerate(zip(_STRIDES, anchors)):
        scores   = outputs[i][:, 0]         # (N,)
        bbox_raw = outputs[i + 3] * stride  # (N, 4)

        mask = scores >= score_thresh
        if not np.any(mask):
            continue

        ac = anchor_centers[mask]
        bp = bbox_raw[mask]
        sc = scores[mask]

        # distance2bbox
        x1 = ac[:, 0] - bp[:, 0]
        y1 = ac[:, 1] - bp[:, 1]
        x2 = ac[:, 0] + bp[:, 2]
        y2 = ac[:, 1] + bp[:, 3]

        # Map back to original image coords
        x1 = np.clip((x1 - pad_w) / scale, 0, img.shape[1]).astype(int)
        y1 = np.clip((y1 - pad_h) / scale, 0, img.shape[0]).astype(int)
        x2 = np.clip((x2 - pad_w) / scale, 0, img.shape[1]).astype(int)
        y2 = np.clip((y2 - pad_h) / scale, 0, img.shape[0]).astype(int)

        for j in range(len(sc)):
            if x2[j] > x1[j] and y2[j] > y1[j]:
                results.append((int(x1[j]), int(y1[j]), int(x2[j]), int(y2[j]), float(sc[j])))

    results = _nms(results)
    results.sort(key=lambda r: r[4], reverse=True)
    return results


# ── Haar fallback detection ───────────────────────────────────────────────────

def _haar_detect(img: np.ndarray) -> list[tuple[int, int, int, int, float]]:
    gray = cv2.cvtColor(img, cv2.COLOR_RGB2GRAY)
    cc   = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    results = []
    for sf, mn in [(1.1, 5), (1.15, 4), (1.2, 3)]:
        faces = cc.detectMultiScale(gray, scaleFactor=sf, minNeighbors=mn, minSize=(30, 30))
        if len(faces):
            for (x, y, w, h) in faces:
                results.append((x, y, x + w, y + h, 0.8))
            break
    results.sort(key=lambda r: (r[2] - r[0]) * (r[3] - r[1]), reverse=True)
    return results


# ── Embedding ─────────────────────────────────────────────────────────────────

def _crop_align(img: np.ndarray, bbox: tuple, pad: float = 0.20) -> np.ndarray:
    """Crop face with padding, resize to 112x112 for ArcFace."""
    x1, y1, x2, y2 = bbox[:4]
    h, w = img.shape[:2]
    bw, bh = x2 - x1, y2 - y1
    x1 = max(0, int(x1 - bw * pad))
    y1 = max(0, int(y1 - bh * pad))
    x2 = min(w, int(x2 + bw * pad))
    y2 = min(h, int(y2 + bh * pad))
    crop = img[y1:y2, x1:x2]
    if crop.size == 0:
        return np.zeros((*_FACE_SIZE, 3), dtype=np.uint8)
    return cv2.resize(crop, _FACE_SIZE)


def _enhance_id_crop(crop: np.ndarray) -> np.ndarray:
    """
    Preprocessing for a face cropped from a printed ID card photo.

    The face on an ID card is photographed → printed on plastic → photographed
    again through a phone lens. Each step degrades the embedding quality:
      - Printing loses fine texture and sharpness
      - Re-photographing adds blur, perspective distortion, and uneven lighting
      - Glare from the plastic surface washes out contrast locally

    Steps applied (in order):
      1. Upscale if the crop is small — preserves detail before 112x112 resize
      2. Bilateral denoise — removes JPEG/print noise without blurring edges
      3. CLAHE — corrects uneven lighting and low local contrast from glare
      4. Unsharp mask — recovers edge sharpness lost through printing + re-photo
    """
    # 1. Upscale small crops before resizing to 112x112
    h, w = crop.shape[:2]
    if min(h, w) < 80:
        scale = 160 / min(h, w)
        crop  = cv2.resize(crop, (int(w * scale), int(h * scale)),
                           interpolation=cv2.INTER_CUBIC)

    # 2. Bilateral filter — smooths noise while keeping edges sharp
    denoised = cv2.bilateralFilter(crop, d=7, sigmaColor=40, sigmaSpace=40)

    # 3. CLAHE on the L channel (LAB) — fixes local contrast / glare patches
    lab  = cv2.cvtColor(denoised, cv2.COLOR_RGB2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(4, 4))
    l     = clahe.apply(l)
    enhanced = cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2RGB)

    # 4. Unsharp mask — sharpens edges without amplifying noise
    blurred   = cv2.GaussianBlur(enhanced, (0, 0), sigmaX=1.2)
    sharpened = cv2.addWeighted(enhanced, 1.6, blurred, -0.6, 0)

    return sharpened


def embed_face(
    img: np.ndarray,
    bbox: Optional[tuple] = None,
    enhance: bool = False,
) -> Optional[np.ndarray]:
    """
    Return normalised 512-D ArcFace embedding or None if face crop fails.
    If bbox is None, detects the first face automatically.
    Pass enhance=True for faces cropped from printed ID card photos.
    """
    if bbox is None:
        faces = detect_faces(img)
        if not faces:
            return None
        bbox = faces[0]

    face_crop = _crop_align(img, bbox)
    if enhance:
        face_crop = _enhance_id_crop(face_crop)

    sess = _load_embed()
    if sess is None:
        return _ncc_embedding(face_crop)

    # ArcFace: (1, 3, 112, 112) float32, normalised (x - 127.5) / 127.5
    blob = face_crop.astype(np.float32)
    blob = (blob - 127.5) / 127.5
    blob = blob.transpose(2, 0, 1)[np.newaxis]

    try:
        emb  = sess.run(None, {sess.get_inputs()[0].name: blob})[0][0]
        norm = np.linalg.norm(emb)
        return emb / norm if norm > 0 else emb
    except Exception as exc:
        log.warning("Embedding inference failed: %s", exc)
        return _ncc_embedding(face_crop)


def _ncc_embedding(face: np.ndarray) -> np.ndarray:
    """Pseudo-embedding fallback: flattened normalised grayscale patch."""
    gray = cv2.cvtColor(face, cv2.COLOR_RGB2GRAY).astype(np.float32)
    gray = cv2.resize(gray, (32, 32)).flatten()
    gray -= gray.mean()
    std = gray.std()
    return gray / std if std > 0 else gray


# ── Similarity ────────────────────────────────────────────────────────────────

def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    na = np.linalg.norm(a)
    nb = np.linalg.norm(b)
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


# ── High-level compare ────────────────────────────────────────────────────────

_VERDICTS = [
    (0.72, "strong_match"),
    (0.55, "likely_match"),
    (0.38, "possible_match"),
    (0.0,  "no_match"),
]


def compare_faces(selfie: bytes, id_img: bytes) -> dict:
    """
    Compare a selfie / liveness frame against the face on an ID document.
    selfie / id_img: raw JPEG/PNG bytes.
    Returns dict with score, verdict, and debug flags.
    """
    import io
    from PIL import Image

    def _load(b: bytes) -> Optional[np.ndarray]:
        try:
            return np.array(Image.open(io.BytesIO(b)).convert("RGB"))
        except Exception:
            return None

    selfie_np = _load(selfie)
    id_np     = _load(id_img)

    if selfie_np is None or id_np is None:
        return {"score": None, "verdict": "error", "error": "Could not decode image bytes"}

    selfie_faces = detect_faces(selfie_np)
    id_faces     = detect_faces(id_np)

    selfie_found = bool(selfie_faces)
    id_found     = bool(id_faces)

    if not selfie_found or not id_found:
        return {
            "score":             None,
            "verdict":           "no_match",
            "selfie_face_found": selfie_found,
            "id_face_found":     id_found,
            "error":             "Face not detected in one or both images",
        }

    emb_selfie = embed_face(selfie_np, selfie_faces[0])
    emb_id     = embed_face(id_np,     id_faces[0], enhance=True)

    if emb_selfie is None or emb_id is None:
        return {"score": None, "verdict": "error", "error": "Embedding failed"}

    raw_sim = cosine_similarity(emb_selfie, emb_id)
    score   = (raw_sim + 1.0) / 2.0

    verdict = "no_match"
    for threshold, label in _VERDICTS:
        if score >= threshold:
            verdict = label
            break

    return {
        "score":             round(score, 4),
        "verdict":           verdict,
        "cosine_similarity": round(raw_sim, 4),
        "selfie_face_found": True,
        "id_face_found":     True,
    }
