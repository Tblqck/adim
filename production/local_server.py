# Local test server — saves all captures to payload/
# Run: python -m uvicorn local_server:app --port 8000
# Open: http://localhost:8000/test_init
import base64, binascii, json
from datetime import datetime
from pathlib import Path
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

ROOT     = Path(__file__).parent
WEB_DIR  = ROOT / "web_test"
SAVE_DIR = ROOT / "payload"
SAVE_DIR.mkdir(exist_ok=True)

app = FastAPI(title="KYC Local Test")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

def _decode(uri):
    if not uri: return None
    try:
        payload = uri.split(",", 1)[1] if "," in uri else uri
        return base64.b64decode(payload)
    except Exception:
        return None

async def _do_save(request: Request):
    try:
        data = await request.json()
    except Exception as e:
        print(f"[SAVE ERROR] could not parse JSON: {e}")
        return {"ok": False, "error": str(e)}

    ts    = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    saved = []

    print(f"[SAVE] keys received: {[k for k in data.keys()]}")
    print(f"[SAVE] country={data.get('country')} doc_type={data.get('doc_type')} mode={data.get('mode')}")
    print(f"[SAVE] id_frame={'YES' if data.get('id_frame') else 'NO'}")
    print(f"[SAVE] id_frame_back={'YES' if data.get('id_frame_back') else 'NO'}")
    print(f"[SAVE] face_frames count={len(data.get('face_frames') or [])}")

    blob = _decode(data.get("id_frame"))
    if blob:
        p = SAVE_DIR / f"{ts}_id_front.jpg"
        p.write_bytes(blob); saved.append(p.name)
        print(f"[SAVE] wrote {p.name} ({len(blob)} bytes)")

    blob = _decode(data.get("id_frame_back"))
    if blob:
        p = SAVE_DIR / f"{ts}_id_back.jpg"
        p.write_bytes(blob); saved.append(p.name)
        print(f"[SAVE] wrote {p.name} ({len(blob)} bytes)")

    frames = data.get("face_frames") or []
    if not frames and data.get("face_frame"):
        frames = [data["face_frame"]]
    pack = data.get("capture_pack") or []
    for i, uri in enumerate(frames):
        blob = _decode(uri)
        if not blob:
            print(f"[SAVE] face frame {i} failed to decode")
            continue
        label = pack[i].get("type", "frame") if i < len(pack) else f"frame_{i+1}"
        p = SAVE_DIR / f"{ts}_face_{i+1:02d}_{label}.jpg"
        p.write_bytes(blob); saved.append(p.name)
        print(f"[SAVE] wrote {p.name} ({len(blob)} bytes)")

    meta = {k: v for k, v in data.items()
            if k not in {"id_frame","id_frame_back","face_frame","face_frames"}}
    meta["_saved_files"] = saved
    meta["_ts"] = ts
    p = SAVE_DIR / f"{ts}_payload.json"
    p.write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    saved.append(p.name)
    print(f"[SAVE] wrote {p.name}")
    print(f"[SAVE] done — {len(saved)} files saved to {SAVE_DIR}")

    return {"ok": True, "files": saved}

@app.get("/health")
def health():
    files = [f.name for f in SAVE_DIR.iterdir()]
    return {"status": "ok", "save_dir": str(SAVE_DIR), "files_in_payload": files}

@app.get("/config.js", include_in_schema=False)
def config_js():
    return Response("window.API_BASE = 'http://localhost:8000';\n", media_type="text/javascript")

@app.post("/save")
async def save(request: Request):
    return await _do_save(request)

@app.post("/api/v1/save")
async def save_v1(request: Request):
    return await _do_save(request)

@app.post("/api/v1/verify")
async def verify():
    return {"ok": True, "verified": True, "overall_verdict": "local_test_pass",
            "overall_score": 1.0, "document": {"verdict": "local_test", "score": 1.0},
            "face": {"verdict": "local_test", "score": 1.0},
            "liveness": {"is_live": True, "score": 1.0},
            "ocr_fields": {}, "result_id": None}

app.mount("/payload",  StaticFiles(directory=str(SAVE_DIR)), name="payload")

liveness_dir = WEB_DIR / "liveness"
if liveness_dir.exists():
    app.mount("/liveness", StaticFiles(directory=str(liveness_dir)), name="liveness")

for _stem in ("index","id-capture","liveness","handoff","test_init"):
    _html = WEB_DIR / f"{_stem}.html"
    if not _html.exists(): continue
    _rpath = "/" if _stem == "index" else f"/{_stem}"
    def _mk(p=_html, rp=_rpath):
        async def _r(): return FileResponse(str(p))
        _r.__name__ = p.stem
        app.get(rp, include_in_schema=False)(_r)
    _mk()

for _f in ("sw.js","manifest.json"):
    _fp = WEB_DIR / _f
    if _fp.exists():
        def _ms(p=_fp):
            async def _r(): return FileResponse(str(p))
            _r.__name__ = p.name
            app.get(f"/{p.name}", include_in_schema=False)(_r)
        _ms()

app.mount("/", StaticFiles(directory=str(WEB_DIR)), name="static")
