"""Adds the audit log to the live API. Run from ~/app/production's parent
with the file paths as they are there; each edit must match exactly once."""
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."


def patch(path, edits):
    full = f"{ROOT}/{path}"
    s = open(full, encoding="utf-8").read()
    if "audit_log" in s:
        print(f"{path}: already patched")
        return
    for old, new in edits:
        n = s.count(old)
        if n != 1:
            sys.exit(f"{path}: expected 1 match, found {n}:\n{old[:200]}")
        s = s.replace(old, new)
    open(full, "w", encoding="utf-8").write(s)
    print(f"{path}: {len(edits)} edits")


ADMIN = [
    (
        "from production.api import ipban\n",
        "from production.api import ipban\nfrom production import audit_log\n",
    ),
    (
        '''@router.get("/me")''',
        '''def _audit(session: dict, action: str, *, firm_id: Optional[int] = None, **kw) -> None:
    """Best-effort audit entry for an admin action (production/audit_log.py)."""
    audit_log.record(
        action,
        actor=_actor_name(session),
        firm_id=firm_id if firm_id is not None else session.get("firm_id"),
        **kw,
    )


@router.get("/audit")
async def audit_feed(
    session:   dict           = Depends(require_admin),
    category:  Optional[str]  = None,
    action:    Optional[str]  = None,
    before:    Optional[str]  = None,
    date_from: Optional[date] = None,
    date_to:   Optional[date] = None,
    q:         Optional[str]  = None,
    firm_id:   Optional[int]  = None,
    limit:     int            = Query(50, ge=1, le=100),
):
    """Who did what, and when -- newest first, one page per `before` cursor.
    Firm sessions see their own firm only; managing it (head admin, or an
    employee trusted to manage logins) is what shows colleagues' activity."""
    _require_db()
    _require_can_create_users(session)
    return await audit_log.feed(
        firm_id=_effective_firm_id(session, firm_id),
        category=category, action=action, before=before,
        date_from=date_from, date_to=date_to, q=q, limit=limit,
    )


@router.get("/me")''',
    ),
    (
        '''    if not ok:
        raise HTTPException(404, "Verification not found or update failed")
    return {"ok": True}''',
        '''    if not ok:
        raise HTTPException(404, "Verification not found or update failed")
    outcome = {True: "Approved", False: "Rejected"}.get(body.verified, "Updated")
    fields = sorted((body.corrected_fields or {}).keys())
    _audit(
        session, "verification.reviewed", target_type="verification", target_id=result_id,
        summary=f"{outcome} verification #{result_id}" + (f" · corrected {', '.join(fields)}" if fields else ""),
        detail={"verified": body.verified, "corrected": fields,
                "outcome": {True: "ok", False: "error"}.get(body.verified)},
    )
    return {"ok": True}''',
    ),
    (
        '''        ok = await db.hard_delete_result(result_id)
        if not ok:
            raise HTTPException(404, "Verification not found")
        return {"ok": True, "permanent": True}''',
        '''        ok = await db.hard_delete_result(result_id)
        if not ok:
            raise HTTPException(404, "Verification not found")
        _audit(session, "verification.deleted", target_type="verification", target_id=result_id,
               summary=f"Verification #{result_id} deleted permanently", detail={"outcome": "error"})
        return {"ok": True, "permanent": True}''',
    ),
    (
        '''    ok = await db.soft_delete_result(result_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Verification not found")
''',
        '''    ok = await db.soft_delete_result(result_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Verification not found")
    _audit(session, "verification.binned", target_type="verification", target_id=result_id,
           summary=f"Verification #{result_id} moved to the recycle bin")
''',
    ),
    (
        '''    ok = await db.restore_result(result_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Verification not found")
    return {"ok": True}''',
        '''    ok = await db.restore_result(result_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Verification not found")
    _audit(session, "verification.restored", target_type="verification", target_id=result_id,
           summary=f"Verification #{result_id} restored from the recycle bin")
    return {"ok": True}''',
    ),
    (
        '''    if firm is None:
        raise HTTPException(500, "Failed to create firm")
''',
        '''    if firm is None:
        raise HTTPException(500, "Failed to create firm")
    _audit(session, "firm.created", firm_id=firm["id"], target_type="firm", target_id=firm["id"],
           summary=f"Created firm {firm['name']} ({firm['slug']})")
''',
    ),
    (
        '''    ok, error = await db.delete_firm(firm_id)
    if not ok:
        raise HTTPException(409, error or "Failed to delete firm")
    return {"ok": True}''',
        '''    ok, error = await db.delete_firm(firm_id)
    if not ok:
        raise HTTPException(409, error or "Failed to delete firm")
    _audit(session, "firm.deleted", target_type="firm", target_id=firm_id, summary=f"Deleted firm #{firm_id}")
    return {"ok": True}''',
    ),
    (
        '''    if firm is None:
        raise HTTPException(404, "Firm not found")
    return {"ok": True, "api_key": api_key}''',
        '''    if firm is None:
        raise HTTPException(404, "Firm not found")
    _audit(session, "api_key.rotated", firm_id=target_id, target_type="firm", target_id=target_id,
           summary="Generated a new API key (the old one stopped working)")
    return {"ok": True, "api_key": api_key}''',
    ),
    (
        '''    ok = await db.revoke_firm_api_key(target_id)
    if not ok:
        raise HTTPException(404, "Firm not found")
    return {"ok": True}''',
        '''    ok = await db.revoke_firm_api_key(target_id)
    if not ok:
        raise HTTPException(404, "Firm not found")
    _audit(session, "api_key.revoked", firm_id=target_id, target_type="firm", target_id=target_id,
           summary="Removed the API key", detail={"outcome": "warning"})
    return {"ok": True}''',
    ),
    (
        '''    if user is None:
        raise HTTPException(500, "Failed to create employee login")
''',
        '''    if user is None:
        raise HTTPException(500, "Failed to create employee login")
    _audit(session, "user.created", target_type="user", target_id=user["id"],
           summary=f"Added team member {user['display_name']} ({user['username']})"
                   + (" · can manage logins" if user["can_create_users"] else ""))
''',
    ),
    (
        '''    if user is None:
        raise HTTPException(404, "Employee not found for this firm")
    return {"ok": True, "user": user}''',
        '''    if user is None:
        raise HTTPException(404, "Employee not found for this firm")
    changes = []
    if "active" in fields:
        changes.append("enabled" if fields["active"] else "disabled")
    if "can_create_users" in fields:
        changes.append("can manage logins" if fields["can_create_users"] else "can no longer manage logins")
    _audit(session, "user.updated", target_type="user", target_id=user_id,
           summary=f"Team member {user.get('username') or user_id}: {', '.join(changes)}")
    return {"ok": True, "user": user}''',
    ),
    (
        '''    ok = await db.delete_firm_user(user_id, firm_id)
    if not ok:
        raise HTTPException(404, "Employee not found for this firm")
    return {"ok": True}''',
        '''    ok = await db.delete_firm_user(user_id, firm_id)
    if not ok:
        raise HTTPException(404, "Employee not found for this firm")
    _audit(session, "user.deleted", target_type="user", target_id=user_id, summary=f"Removed team member #{user_id}")
    return {"ok": True}''',
    ),
    (
        '''    if row is None:
        raise HTTPException(500, "Failed to create session")
''',
        '''    if row is None:
        raise HTTPException(500, "Failed to create session")
    _audit(session, "link.created", firm_id=firm_id, target_type="link", target_id=row.get("id"),
           summary="Verification link generated" + (f" for {body.user_ref}" if body.user_ref else ""))
''',
    ),
    (
        '''    ok = await db.soft_delete_session(session_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Link not found")
''',
        '''    ok = await db.soft_delete_session(session_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Link not found")
    _audit(session, "link.binned", target_type="link", target_id=session_id,
           summary="Verification link moved to the recycle bin")
''',
    ),
    (
        '''    ok = await db.restore_session(session_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Link not found")
    return {"ok": True}''',
        '''    ok = await db.restore_session(session_id, firm_id=_effective_firm_id(session))
    if not ok:
        raise HTTPException(404, "Link not found")
    _audit(session, "link.restored", target_type="link", target_id=session_id,
           summary="Verification link restored from the recycle bin")
    return {"ok": True}''',
    ),
    (
        '''        raise HTTPException(400, "IP is not a valid public address, or is already banned")
    return {"ok": True}''',
        '''        raise HTTPException(400, "IP is not a valid public address, or is already banned")
    _audit(session, "ip.banned", target_type="ip", target_id=ip, ip=ip,
           summary=f"Blocked sign-ins from {ip}" + (f" · {body.reason}" if body.reason else ""),
           detail={"outcome": "warning"})
    return {"ok": True}''',
    ),
    (
        '''        raise HTTPException(404, "No active ban for that IP")
    return {"ok": True}''',
        '''        raise HTTPException(404, "No active ban for that IP")
    _audit(session, "ip.unbanned", target_type="ip", target_id=ip.strip(), ip=ip.strip(),
           summary=f"Lifted the sign-in block on {ip.strip()}")
    return {"ok": True}''',
    ),
    (
        '''    _require_super_admin(session)
    return await _ai_templates("PUT", f"/{template_id}/boxes", json={"boxes": body.boxes})''',
        '''    _require_super_admin(session)
    out = await _ai_templates("PUT", f"/{template_id}/boxes", json={"boxes": body.boxes})
    _audit(session, "template.edited", target_type="template", target_id=template_id,
           summary=f"Edited the redaction boxes of a template ({len(body.boxes)} boxes)")
    return out''',
    ),
    (
        '''    _require_super_admin(session)
    return await _ai_templates(
        "POST", f"/{template_id}/approve",
        json={"by": _actor_name(session), "label": body.label, "replace_id": body.replace_id},
    )''',
        '''    _require_super_admin(session)
    out = await _ai_templates(
        "POST", f"/{template_id}/approve",
        json={"by": _actor_name(session), "label": body.label, "replace_id": body.replace_id},
    )
    where = f"{out.get('country', '')} {str(out.get('doc_type', '')).replace('_', ' ')} {out.get('side', '')}".strip() \\
        if isinstance(out, dict) else ""
    _audit(session, "template.approved", target_type="template", target_id=template_id,
           summary=f"Approved a template sample{f' · {where}' if where else ''}"
                   + (" (replaced an older sample)" if body.replace_id else ""),
           detail={"replaced": body.replace_id, "outcome": "ok"})
    return out''',
    ),
    (
        '''    _require_super_admin(session)
    return await _ai_templates("PATCH", f"/{template_id}", json={"label": body.label})''',
        '''    _require_super_admin(session)
    out = await _ai_templates("PATCH", f"/{template_id}", json={"label": body.label})
    _audit(session, "template.renamed", target_type="template", target_id=template_id,
           summary=f"Renamed a template to {body.label!r}")
    return out''',
    ),
    (
        '''    _require_super_admin(session)
    return await _ai_templates("DELETE", f"/{template_id}")''',
        '''    _require_super_admin(session)
    out = await _ai_templates("DELETE", f"/{template_id}")
    _audit(session, "template.deleted", target_type="template", target_id=template_id,
           summary="Deleted a template sample or draft")
    return out''',
    ),
    (
        '''    data = {"country": row["country"], "doc_type": row["doc_type"], "source": f"verification:{result_id}"}
    return await _ai_templates("POST", "/backfill", data=data, files=files)''',
        '''    data = {"country": row["country"], "doc_type": row["doc_type"], "source": f"verification:{result_id}"}
    out = await _ai_templates("POST", "/backfill", data=data, files=files)
    _audit(session, "template.backfilled", target_type="verification", target_id=result_id,
           summary=f"Offered verification #{result_id} as a template draft")
    return out''',
    ),
]

AUTH = [
    (
        '''    if ipban.is_banned(client_ip):''',
        '''    from production import audit_log

    def _record_failure(firm_id=None, banned=False):
        audit_log.record(
            "login.failed",
            actor=username or firm or "back office",
            firm_id=firm_id, ip=client_ip,
            summary="Sign-in failed" + (f" for {firm}" if firm else " (back office)"),
            detail={"firm": firm, "username": username, "outcome": "error", **({"blocked_ip": True} if banned else {})},
        )

    if ipban.is_banned(client_ip):
        _record_failure(banned=True)''',
    ),
    (
        '''    def _fail(detail: str) -> HTTPException:
        ipban.record_failure(client_ip)
        return HTTPException(401, detail)''',
        '''    def _fail(detail: str, firm_id=None) -> HTTPException:
        ipban.record_failure(client_ip)
        _record_failure(firm_id)
        if ipban.is_banned(client_ip):
            audit_log.record(
                "ip.auto_banned", actor="system", actor_type="system", firm_id=firm_id,
                target_type="ip", target_id=client_ip, ip=client_ip,
                summary=f"Blocked sign-ins from {client_ip} after repeated failed attempts",
                detail={"outcome": "error"},
            )
        return HTTPException(401, detail)''',
    ),
    (
        '''            if not user_row or not user_row.get("active"):
                raise _fail("Incorrect firm, username, or password")
            if not verify_password(password, user_row["password_hash"], user_row["password_salt"]):
                raise _fail("Incorrect firm, username, or password")''',
        '''            if not user_row or not user_row.get("active"):
                raise _fail("Incorrect firm, username, or password", firm_row["id"])
            if not verify_password(password, user_row["password_hash"], user_row["password_salt"]):
                raise _fail("Incorrect firm, username, or password", firm_row["id"])''',
    ),
    (
        '''            if not verify_password(password, firm_row["admin_password_hash"], firm_row["admin_password_salt"]):
                raise _fail("Incorrect firm or password")''',
        '''            if not verify_password(password, firm_row["admin_password_hash"], firm_row["admin_password_salt"]):
                raise _fail("Incorrect firm or password", firm_row["id"])''',
    ),
    (
        '''    ipban.clear_failures(client_ip)
    token = _serializer().dumps(payload)''',
        '''    ipban.clear_failures(client_ip)
    audit_log.record(
        "login.success", actor=payload.get("display_name") or payload.get("username"),
        firm_id=payload.get("firm_id"), ip=client_ip,
        summary="Signed in" + (" to the back office" if is_super_admin else ""),
        detail={"username": payload.get("username"), "outcome": "ok"},
    )
    token = _serializer().dumps(payload)''',
    ),
    (
        '''@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)''',
        '''@router.post("/logout")
async def logout(request: Request, response: Response):
    try:
        session = require_admin(request)
    except HTTPException:
        session = None
    if session:
        from production import audit_log
        audit_log.record(
            "logout", actor=session.get("display_name") or session.get("username"),
            firm_id=session.get("firm_id"), ip=ipban.client_ip(request), summary="Signed out",
        )
    response.delete_cookie(COOKIE_NAME)''',
    ),
]

patch("api/routers/admin.py", ADMIN)
patch("api/routers/admin_auth.py", AUTH)
