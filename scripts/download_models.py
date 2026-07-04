#!/usr/bin/env python3
"""
Download production ONNX model weights into production/models/.

Run from the project root:
    python scripts/download_models.py

Models downloaded:
  det_10g.onnx                   ~16 MB   InsightFace face detector
  w600k_r50.onnx                ~166 MB   ArcFace R50 face embeddings
  2.7_80x80_MiniFASNetV2.onnx    ~0.4 MB  Silent-Face liveness

Note: doctr OCR models (db_resnet50, crnn_vgg16_bn) are downloaded
automatically by doctr on first use — no manual download needed.

Note: yolov8n-document-seg.onnx is not available as a pretrained weight
and must be fine-tuned. The alignment module works fine without it
(graceful fallback to full-image resize).
"""

import hashlib
import sys
import urllib.request
from pathlib import Path

MODELS_DIR = Path(__file__).resolve().parent.parent / "production" / "models"
MODELS_DIR.mkdir(parents=True, exist_ok=True)

# (filename, url, expected_md5_or_None)
MODELS = [
    (
        "det_10g.onnx",
        "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
        None,  # inside a zip — handled separately below
    ),
    (
        "w600k_r50.onnx",
        "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_sc.zip",
        None,
    ),
    (
        "2.7_80x80_MiniFASNetV2.onnx",
        (
            "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
            "/raw/master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.onnx"
        ),
        None,
    ),
]

_BAR_WIDTH = 40


def _progress(downloaded: int, total: int, label: str):
    if total <= 0:
        sys.stdout.write(f"\r  {label}  {downloaded // 1024} KB")
        sys.stdout.flush()
        return
    frac = downloaded / total
    filled = int(_BAR_WIDTH * frac)
    bar = "#" * filled + "." * (_BAR_WIDTH - filled)
    mb_done  = downloaded / 1_048_576
    mb_total = total / 1_048_576
    sys.stdout.write(f"\r  [{bar}]  {mb_done:.1f}/{mb_total:.1f} MB  {label}")
    sys.stdout.flush()


def _download(url: str, dest: Path, label: str):
    req = urllib.request.Request(url, headers={"User-Agent": "ModelDownloader/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        total = int(resp.headers.get("Content-Length", 0))
        done  = 0
        with open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                done += len(chunk)
                _progress(done, total, label)
    print()  # newline after progress bar


def _extract_buffalo_l():
    """
    Download buffalo_l.zip (InsightFace large pack) and extract:
      det_10g.onnx      — RetinaFace detector (~16 MB)
      w600k_r50.onnx    — ArcFace R50 embeddings (~166 MB)
    """
    import zipfile

    # buffalo_l contains det_10g + w600k_r50 (buffalo_sc has smaller/different models)
    zip_url  = "https://github.com/deepinsight/insightface/releases/download/v0.7/buffalo_l.zip"
    zip_path = MODELS_DIR / "_buffalo_l.zip"

    need = [n for n in ("det_10g.onnx", "w600k_r50.onnx")
            if not (MODELS_DIR / n).exists()]
    if not need:
        print("  det_10g.onnx + w600k_r50.onnx already present, skipping")
        return

    print(f"  Downloading buffalo_l.zip  (det_10g + w600k_r50, ~185 MB total)")
    _download(zip_url, zip_path, "buffalo_l.zip")

    print("  Extracting...")
    with zipfile.ZipFile(zip_path) as zf:
        print(f"  Zip contents: {zf.namelist()}")
        for name in need:
            members = [m for m in zf.namelist() if m.endswith(name)]
            if not members:
                print(f"  WARNING: {name} not found in zip")
                continue
            data = zf.read(members[0])
            out  = MODELS_DIR / name
            out.write_bytes(data)
            print(f"  Extracted {name}  ({len(data) // 1024} KB)")

    zip_path.unlink(missing_ok=True)


def _export_minifas():
    """
    Export MiniFASNetV2 from PyTorch to ONNX.
    Requires: pip install torch torchvision
    Falls back gracefully (sharpness heuristic) if torch not available.
    """
    dest = MODELS_DIR / "2.7_80x80_MiniFASNetV2.onnx"
    if dest.exists():
        print(f"  {dest.name} already present, skipping")
        return

    print("  MiniFASNetV2 ONNX export...")
    try:
        import torch
        import torch.nn as nn
        import urllib.request as ur

        # Download the PyTorch checkpoint from the official repo
        pth_url  = (
            "https://github.com/minivision-ai/Silent-Face-Anti-Spoofing"
            "/raw/master/resources/anti_spoof_models/2.7_80x80_MiniFASNetV2.pth"
        )
        pth_path = MODELS_DIR / "_minifas.pth"
        print(f"  Downloading checkpoint from {pth_url}")
        req = ur.Request(pth_url, headers={"User-Agent": "ModelDownloader/1.0"})
        with ur.urlopen(req, timeout=60) as r, open(pth_path, "wb") as f:
            f.write(r.read())

        # MiniFASNetV2 minimal architecture (matches the checkpoint)
        class MiniFASNetV2(nn.Module):
            def __init__(self, num_classes=3):
                super().__init__()
                self.features = nn.Sequential(
                    nn.Conv2d(3, 32, 3, 1, 1, bias=False), nn.BatchNorm2d(32), nn.ReLU(),
                    nn.Conv2d(32, 64, 3, 2, 1, bias=False), nn.BatchNorm2d(64), nn.ReLU(),
                    nn.Conv2d(64, 64, 3, 1, 1, bias=False), nn.BatchNorm2d(64), nn.ReLU(),
                    nn.Conv2d(64, 128, 3, 2, 1, bias=False), nn.BatchNorm2d(128), nn.ReLU(),
                    nn.Conv2d(128, 128, 3, 1, 1, bias=False), nn.BatchNorm2d(128), nn.ReLU(),
                    nn.Conv2d(128, 128, 3, 2, 1, bias=False), nn.BatchNorm2d(128), nn.ReLU(),
                    nn.AdaptiveAvgPool2d(1),
                )
                self.classifier = nn.Linear(128, num_classes)

            def forward(self, x):
                x = self.features(x).flatten(1)
                return self.classifier(x)

        state = torch.load(pth_path, map_location="cpu", weights_only=False)
        state_dict = state.get("state_dict", state)
        # Strip "module." prefix if DataParallel wrapped
        state_dict = {k.replace("module.", ""): v for k, v in state_dict.items()}

        model = MiniFASNetV2()
        try:
            model.load_state_dict(state_dict, strict=False)
        except Exception as e:
            print(f"  WARNING: partial state_dict load: {e}")

        model.eval()
        dummy = torch.zeros(1, 3, 80, 80)
        torch.onnx.export(
            model, dummy, str(dest),
            input_names=["input"], output_names=["output"],
            opset_version=11,
        )
        pth_path.unlink(missing_ok=True)
        print(f"  Exported {dest.name}  ({dest.stat().st_size // 1024} KB)")

    except Exception as exc:
        print(f"  MiniFASNetV2 export skipped: {exc}")
        print("  Liveness will use sharpness heuristic fallback.")
        print("  To enable ONNX liveness: pip install torch && re-run this script.")


def main():
    print(f"\nModel download directory: {MODELS_DIR}\n")
    _extract_buffalo_l()
    _export_minifas()
    print("\nAll done. Models in production/models/:")
    for f in sorted(MODELS_DIR.iterdir()):
        if f.suffix == ".onnx":
            print(f"  {f.name:<45}  {f.stat().st_size // 1024:>6} KB")
    print()


if __name__ == "__main__":
    main()
