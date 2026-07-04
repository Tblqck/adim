FROM python:3.11-slim

# System dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps before copying code (layer cache)
COPY production/web/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . /app

# ONNX model weights are too large for a normal git push (w600k_r50.onnx is
# ~174MB, over GitHub's 100MB per-file limit) — fetch them at build time.
RUN python scripts/download_models.py

EXPOSE 8000

# PORT env var is set by Render (10000) and EC2 docker-compose (8000).
# Shell form lets ${PORT:-8000} expand at runtime.
# --workers 1: each worker loads its own copy of the ONNX models (~200MB+),
# so a second worker roughly doubles memory footprint for no benefit on a
# memory-constrained instance.
CMD uvicorn production.api.main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8000} \
    --workers 1 \
    --timeout-keep-alive 30
