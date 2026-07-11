FROM python:3.11-slim

# opencv needs libGL/libglib at runtime even in "headless" builds
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

# production/models/ is gitignored (352MB, one file over GitHub's 100MB
# limit) — fetch it into the image at build time instead.
RUN python production/download_models.py

EXPOSE 8000

CMD uvicorn main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8000} \
    --workers 1 \
    --timeout-keep-alive 30
