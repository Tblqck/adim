FROM python:3.11-slim

WORKDIR /app

# Install Python deps before copying code (layer cache)
COPY production/web/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . /app

EXPOSE 8000

# PORT env var is set by Render (10000).
# Shell form lets ${PORT:-8000} expand at runtime.
CMD uvicorn production.api.main:app \
    --host 0.0.0.0 \
    --port ${PORT:-8000} \
    --workers 1 \
    --timeout-keep-alive 30
