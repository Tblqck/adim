"""
Admin API proxy — forwards every /api/v1/admin/* call to the API server that
runs the actual verification engine (DB, OpenSanctions PEP/KYB screen, OCR,
forensics, doc matching — see development/production/). This service does
none of that itself — it's a thin static-file server + HTTP relay, so it has
no OpenCV/DB/ML dependency and stays deployable on a free/low-memory tier.
"""

from __future__ import annotations

import os
from pathlib import Path

import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

API_SERVER_BASE = os.getenv("API_SERVER_URL", "https://18.185.59.156/api/v1/admin").rstrip("/")

# The AWS box has no CA-trusted cert (no domain name to issue one against),
# so this pins its actual self-signed cert instead of disabling verification
# outright — that still defeats both passive eavesdropping AND an active
# MITM presenting a different certificate, unlike verify=False.
_PINNED_CERT = Path(__file__).parent / "aws_admin_cert.pem"
_VERIFY = str(_PINNED_CERT) if _PINNED_CERT.exists() else True

if API_SERVER_BASE.startswith("http://") and "127.0.0.1" not in API_SERVER_BASE and "localhost" not in API_SERVER_BASE:
    raise RuntimeError(
        "API_SERVER_URL is plain HTTP against a non-local host — this would relay "
        "the admin password and session cookie unencrypted. Use https:// (see aws_admin_cert.pem)."
    )

# Headers that must not be copied verbatim between hops.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-length", "content-encoding", "host",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_admin(path: str, request: Request):
    url = f"{API_SERVER_BASE}/{path}"
    body = await request.body()
    forward_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP
    }

    async with httpx.AsyncClient(timeout=60.0, verify=_VERIFY) as client:
        upstream = await client.request(
            request.method,
            url,
            params=request.query_params,
            content=body,
            headers=forward_headers,
            cookies=request.cookies,
        )

    resp = Response(content=upstream.content, status_code=upstream.status_code)
    for key, value in upstream.headers.items():
        if key.lower() in _HOP_BY_HOP:
            continue
        if key.lower() == "set-cookie":
            resp.headers.append(key, value)
        else:
            resp.headers[key] = value
    return resp
