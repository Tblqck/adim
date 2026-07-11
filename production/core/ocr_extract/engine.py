"""
Standalone multi-language OCR engine — no blueprint/template required.

Primary:  RapidOCR (PaddleOCR PP-OCRv6 weights exported to ONNX). Single
          detector + recognizer pair covers ~50 Latin/European-script
          languages natively (see PP_OCRV6_LANGS in rapidocr's
          model_resolver.py). Chosen over the paddleocr package directly
          because paddlepaddle has no wheel for some Python versions —
          rapidocr ships the same PP-OCR weights but runs them on
          onnxruntime, already a dependency across this project.

Fallback: EasyOCR, used only when the primary pass reads too little text
          (script mismatch — Arabic/Cyrillic/Devanagari/CJK IDs that the
          Latin-tuned PP-OCRv6 model can't read). Optional dependency —
          if easyocr/torch aren't installed, the fallback is skipped and
          the primary result is returned as-is (see run_ocr).

Public API:
    run_ocr(image: np.ndarray) -> list[Word]
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import numpy as np

log = logging.getLogger(__name__)

# Below this average confidence (or word count), treat the primary pass as
# a probable script mismatch and retry with the broader-coverage fallback.
_MIN_WORDS = 3
_MIN_AVG_CONF = 0.55

# EasyOCR language groups it can load together in one Reader — scripts
# cannot be mixed across groups (e.g. 'ar' cannot load with 'ru').
_EASYOCR_LANG_GROUPS = [
    ["en"],
    ["ar", "en"],
    ["ru", "en"],
    ["hi", "en"],
    ["ch_sim", "en"],
]


@dataclass
class Word:
    text: str
    confidence: float
    # Normalised bbox (0-1 image-relative), axis-aligned envelope of the
    # detector's quad — good enough for line-grouping and template storage.
    x: float
    y: float
    w: float
    h: float

    @property
    def cx(self) -> float:
        return self.x + self.w / 2

    @property
    def cy(self) -> float:
        return self.y + self.h / 2


_rapid_engine = None
_easyocr_readers: dict[tuple, "object"] = {}


def _load_rapidocr():
    global _rapid_engine
    if _rapid_engine is not None:
        return _rapid_engine
    from rapidocr import RapidOCR, EngineType, OCRVersion, ModelType, LangDet

    _rapid_engine = RapidOCR(params={
        "Det.engine_type": EngineType.ONNXRUNTIME,
        "Det.ocr_version": OCRVersion.PPOCRV6,
        "Det.model_type": ModelType.MEDIUM,
        "Det.lang_type": LangDet.EN,
        "Rec.engine_type": EngineType.ONNXRUNTIME,
        "Rec.ocr_version": OCRVersion.PPOCRV6,
        "Rec.model_type": ModelType.MEDIUM,
        "Rec.lang_type": "en",
    })
    log.info("RapidOCR (PP-OCRv6 medium, multi-language) loaded")
    return _rapid_engine


def _load_easyocr(langs: list[str]):
    key = tuple(langs)
    if key in _easyocr_readers:
        return _easyocr_readers[key]
    import easyocr
    reader = easyocr.Reader(langs, gpu=False, verbose=False)
    _easyocr_readers[key] = reader
    log.info("EasyOCR reader loaded for langs=%s", langs)
    return reader


def _quad_to_norm_bbox(quad, img_w: int, img_h: int) -> tuple[float, float, float, float]:
    xs = [float(p[0]) for p in quad]
    ys = [float(p[1]) for p in quad]
    x1, x2 = max(0.0, min(xs)), min(float(img_w), max(xs))
    y1, y2 = max(0.0, min(ys)), min(float(img_h), max(ys))
    return (x1 / img_w, y1 / img_h, (x2 - x1) / img_w, (y2 - y1) / img_h)


def _run_rapidocr(img: np.ndarray) -> list[Word]:
    engine = _load_rapidocr()
    result = engine(img)
    if result is None or result.boxes is None:
        return []
    h, w = img.shape[:2]
    words = []
    for quad, txt, score in zip(result.boxes, result.txts, result.scores):
        x, y, bw, bh = _quad_to_norm_bbox(quad, w, h)
        words.append(Word(text=txt.strip(), confidence=float(score), x=x, y=y, w=bw, h=bh))
    return [wd for wd in words if wd.text]


def _run_easyocr(img: np.ndarray, langs: list[str]) -> list[Word]:
    reader = _load_easyocr(langs)
    h, w = img.shape[:2]
    raw = reader.readtext(img)
    words = []
    for quad, txt, score in raw:
        x, y, bw, bh = _quad_to_norm_bbox(quad, w, h)
        txt = (txt or "").strip()
        if txt:
            words.append(Word(text=txt, confidence=float(score), x=x, y=y, w=bw, h=bh))
    return words


def run_ocr(image: np.ndarray, langs_hint: Optional[list[str]] = None) -> list[Word]:
    """
    Run OCR on an RGB np.ndarray and return detected words with normalised
    bounding boxes, in the engine's native reading order (top-to-bottom,
    left-to-right).

    langs_hint: optional list of EasyOCR language codes to try first if the
    primary pass looks like a script mismatch (e.g. ["ar", "en"] for a
    document expected to carry Arabic script).
    """
    words = _run_rapidocr(image)
    avg_conf = sum(wd.confidence for wd in words) / len(words) if words else 0.0

    if len(words) >= _MIN_WORDS and avg_conf >= _MIN_AVG_CONF:
        return words

    log.info(
        "Primary OCR pass weak (words=%d, avg_conf=%.2f) — trying EasyOCR fallback",
        len(words), avg_conf,
    )

    groups = [langs_hint] if langs_hint else []
    groups += [g for g in _EASYOCR_LANG_GROUPS if g != langs_hint]

    best = words
    best_score = len(words) * avg_conf
    for group in groups:
        try:
            fallback_words = _run_easyocr(image, group)
        except Exception as exc:
            log.warning("EasyOCR fallback unavailable/failed for langs=%s: %s", group, exc)
            continue
        fb_avg = (
            sum(wd.confidence for wd in fallback_words) / len(fallback_words)
            if fallback_words else 0.0
        )
        score = len(fallback_words) * fb_avg
        if score > best_score:
            best, best_score = fallback_words, score
        if len(fallback_words) >= _MIN_WORDS and fb_avg >= _MIN_AVG_CONF:
            break

    return best
