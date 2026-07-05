"""
Admin API proxy — forwards every /api/v1/admin/* call to the AWS box that
runs the actual verification engine (DB, OpenSanctions PEP screen, OCR,
forensics, doc matching). This service does none of that itself — it's a
thin static-file server + HTTP relay, so it has no ONNX/OpenCV/doctr
dependency and stays deployable on a free/low-memory tier.
"""

from __future__ import annotations

import os

import httpx
from fastapi import APIRouter, Request, Response

router = APIRouter()

AWS_ADMIN_BASE = os.getenv("AWS_ADMIN_API_BASE", "http://18.185.59.156/api/v1/admin").rstrip("/")

# Headers that must not be copied verbatim between hops.
_HOP_BY_HOP = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade",
    "content-length", "content-encoding", "host",
}


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE"])
async def proxy_admin(path: str, request: Request):
    url = f"{AWS_ADMIN_BASE}/{path}"
    body = await request.body()
    forward_headers = {
        k: v for k, v in request.headers.items() if k.lower() not in _HOP_BY_HOP
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
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
