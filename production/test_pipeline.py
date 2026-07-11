#!/usr/bin/env python3
"""
Test the KYC verify pipeline using saved payload files.

Default target: AWS EC2 server via SSH tunnel on port 9090
  → multipart POST to /api/v1/verify  (FastAPI)

Local fallback: simple HTTP server on port 5000
  → JSON POST to /verify

Usage:
    # Against AWS (via SSH tunnel on 9090):
    python production/test_pipeline.py

    # Against local dev server:
    python production/test_pipeline.py --local

    # Specific payload timestamp:
    python production/test_pipeline.py --ts 2026-06-30_16-09-45
"""

import argparse
import base64
import json
import sys
from pathlib import Path

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    import urllib.request as _urllib
    import urllib.error
    HAS_REQUESTS = False


HERE        = Path(__file__).parent
PAYLOAD_DIR = HERE / 'payload'


# ── Payload loading ───────────────────────────────────────────────────────────

def load_payload(ts_prefix: str = '') -> tuple:
    if ts_prefix:
        candidates = list(PAYLOAD_DIR.glob(f'{ts_prefix}_payload.json'))
    else:
        candidates = sorted(PAYLOAD_DIR.glob('*_payload.json'))

    if not candidates:
        print(f'ERROR: no *_payload.json found in {PAYLOAD_DIR}')
        sys.exit(1)

    meta_path = candidates[-1]
    meta      = json.loads(meta_path.read_text(encoding='utf-8'))
    pfx       = meta.get('_ts') or meta_path.stem.replace('_payload', '')
    print(f'  Payload  : {meta_path.name}  (ts={pfx})')
    return meta, pfx


def to_b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode()


def to_uri(path: Path) -> str:
    return f'data:image/jpeg;base64,{to_b64(path)}'


def build_request(meta: dict, pfx: str) -> dict:
    id_front = PAYLOAD_DIR / f'{pfx}_id_front.jpg'
    id_back  = PAYLOAD_DIR / f'{pfx}_id_back.jpg'

    if not id_front.exists():
        print(f'ERROR: {id_front.name} not found in {PAYLOAD_DIR}')
        sys.exit(1)

    body = {
        'country':  meta.get('country', ''),
        'doc_type': meta.get('doc_type', 'national_id'),
        'id_frame': to_uri(id_front),
    }
    if id_back.exists():
        body['id_frame_back'] = to_uri(id_back)
        print(f'  ID back  : {id_back.name}  ({id_back.stat().st_size // 1024} KB)')

    face_files = sorted(PAYLOAD_DIR.glob(f'{pfx}_face_*.jpg'))
    body['face_frames'] = [to_uri(f) for f in face_files]

    print(f'  ID front : {id_front.name}  ({id_front.stat().st_size // 1024} KB)')
    for f in face_files:
        print(f'  Face     : {f.name}  ({f.stat().st_size // 1024} KB)')
    print(f'  Country  : {body["country"]}   doc_type: {body["doc_type"]}')
    return body


# ── HTTP transport ────────────────────────────────────────────────────────────

def _uri_bytes(uri: str) -> bytes:
    payload = uri.split(',', 1)[1] if ',' in uri else uri
    return base64.b64decode(payload)


_API_KEY = '5446f4efb4598f6a8fa5fd9b840f2b4e31950859081179c24d73dc110301e8f0'


def post_aws(body: dict, base_url: str) -> dict:
    """
    Multipart POST to /api/v1/verify  (FastAPI on EC2).

    mode=3 → ID image + liveness_frames
    """
    url = f'{base_url}/api/v1/verify'
    print(f'\n  POST {url}  (multipart/form-data, mode=3)')

    if not HAS_REQUESTS:
        return {'ok': False, 'error': 'pip install requests'}

    data = {
        'country':    body['country'],
        'doc_type':   body['doc_type'],
        'mode':       '3',
        'user_ref':   'test_pipeline',
        'issue_year': '2020',
    }

    files = [
        ('id_image', ('id_front.jpg', _uri_bytes(body['id_frame']), 'image/jpeg')),
    ]
    for i, uri in enumerate(body.get('face_frames', [])):
        files.append(('liveness_frames', (f'face_{i+1:02d}.jpg', _uri_bytes(uri), 'image/jpeg')))

    headers = {'X-Api-Key': _API_KEY}

    try:
        resp = requests.post(url, data=data, files=files, headers=headers, timeout=180)
        try:
            return resp.json()
        except Exception:
            return {'ok': False, 'error': f'HTTP {resp.status_code}: {resp.text[:400]}'}
    except Exception as exc:
        return {'ok': False, 'error': str(exc)}


def post_local(body: dict, base_url: str) -> dict:
    """JSON POST to /verify  (local simple HTTP server)."""
    url = f'{base_url}/verify'
    print(f'\n  POST {url}  (JSON)')
    payload_bytes = json.dumps(body).encode()

    if HAS_REQUESTS:
        resp = requests.post(url, data=payload_bytes,
                             headers={'Content-Type': 'application/json'}, timeout=120)
        return resp.json()
    else:
        req = _urllib.Request(url, data=payload_bytes,
                              headers={'Content-Type': 'application/json'})
        try:
            with _urllib.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            return json.loads(e.read())


# ── Result display ────────────────────────────────────────────────────────────

def print_result(result: dict):
    print('\n' + '=' * 60)
    print('  VERIFICATION RESULT')
    print('=' * 60)

    verdict  = result.get('overall_verdict', 'unknown').upper()
    score    = result.get('overall_score')
    verified = result.get('verified')
    icon     = '[PASS]' if ('pass' in verdict.lower() or verified) else '[FAIL]'
    print(f'  {icon}  Overall verdict : {verdict}')
    if score is not None:
        print(f'     Overall score  : {score:.3f}')
    if verified is not None:
        print(f'     Verified       : {verified}')
    if result.get('result_id'):
        print(f'     Result ID (DB) : {result["result_id"]}')
    if result.get('mode'):
        print(f'     Mode           : {result["mode"]}')

    print()

    doc_r = result.get('document')
    if doc_r and doc_r.get('verdict') not in ('skipped', None):
        print('  [1] Document match')
        print(f'      verdict : {doc_r.get("verdict")}')
        print(f'      score   : {doc_r.get("score")}')
        print(f'      refs    : {doc_r.get("refs_checked")}')
        if doc_r.get('error'):
            print(f'      note    : {doc_r["error"]}')
    elif doc_r is None:
        print('  [1] Document match : skipped (passport)')

    face_r = result.get('face') or {}
    print()
    print('  [2] Face match')
    print(f'      verdict      : {face_r.get("verdict")}')
    print(f'      score        : {face_r.get("score")}')
    if face_r.get('best_frame_index') is not None:
        print(f'      best frame   : #{face_r.get("best_frame_index")}')
    if face_r.get('frames_checked'):
        print(f'      frames       : {face_r.get("frames_checked")}')
    if 'selfie_face_found' in face_r:
        print(f'      selfie found : {face_r.get("selfie_face_found")}')
        print(f'      id face found: {face_r.get("id_face_found")}')
    if face_r.get('similarity') is not None:
        print(f'      similarity   : {face_r.get("similarity")}')

    live_r = result.get('liveness')
    if live_r:
        print()
        print('  [3] Liveness')
        print(f'      is_live : {live_r.get("is_live")}')
        print(f'      score   : {live_r.get("score")}')

    mrz_r = result.get('mrz')
    if mrz_r:
        print()
        print('  [4] MRZ (passport)')
        print(f'      verdict    : {mrz_r.get("verdict")}')
        print(f'      confidence : {mrz_r.get("confidence")}')
        for k, v in (mrz_r.get('fields') or {}).items():
            if not k.startswith('_'):
                print(f'      {k:<20}: {v}')

    # Both local and AWS field naming
    ocr = result.get('ocr_fields') or result.get('extracted_text', {}).get('fields') or {}
    if ocr:
        print()
        print('  [5] Extracted / OCR fields')
        for k, v in ocr.items():
            if v:
                print(f'      {k:<20}: {v}')

    refs = result.get('refs') or {}
    if refs:
        print()
        print(f'  Refs: {refs.get("count", 0)} images  '
              f'source={refs.get("source")}  fetched={refs.get("fetched", 0)}')

    if result.get('error'):
        print(f'\n  ERROR: {result["error"]}')

    print('=' * 60)
    print()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Test the KYC verify pipeline')
    parser.add_argument('--port',  type=int, default=80,
                        help='Port (default 80 = EC2 direct)')
    parser.add_argument('--host',  default='3.72.34.178')
    parser.add_argument('--ts',    default='', help='Payload timestamp prefix')
    parser.add_argument('--https', action='store_true')
    parser.add_argument('--local', action='store_true',
                        help='Use local dev server on port 5000 (JSON mode)')
    args = parser.parse_args()

    if args.local:
        port   = args.port if args.port != 80 else 5000
        scheme = 'https' if args.https else 'http'
        base_url = f'{scheme}://{args.host}:{port}'
        api = 'local'
    else:
        scheme = 'https' if args.https else 'http'
        base_url = f'{scheme}://{args.host}:{args.port}'
        api = 'aws'

    print()
    print('  KYC Pipeline Test')
    print(f'  Target   : {base_url}  ({"AWS FastAPI" if api == "aws" else "local server"})')
    print(f'  Payload  : {PAYLOAD_DIR}')
    print()

    meta, pfx = load_payload(args.ts)
    body      = build_request(meta, pfx)

    if api == 'aws':
        result = post_aws(body, base_url)
    else:
        result = post_local(body, base_url)

    print_result(result)

    out_path = PAYLOAD_DIR / f'{pfx}_result.json'
    out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding='utf-8')
    print(f'  Full result saved to: {out_path.name}')


if __name__ == '__main__':
    main()
