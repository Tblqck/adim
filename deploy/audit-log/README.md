# Audit log: server side

The Audit Log page calls `GET /api/v1/admin/audit`. These files add it to the live EC2 API.

- `audit_log.py` goes to `~/app/production/audit_log.py`. It builds the feed and does best-effort recording.
- `patch_audit.py` patches the live `api/routers/admin.py` and `admin_auth.py`. It adds the `/audit` route and recording hooks on sign-in, review, bin, restore, delete, firm, team member, API key, link, IP ban and template actions. Each edit must match exactly once, and running it again does nothing.

Deploy on EC2, from `~/app/production`:
1. Back up `api/routers/admin.py` and `admin_auth.py`.
2. `cp audit_log.py .` and `python3 patch_audit.py .`
3. `docker cp` the three files into `app-api-1:/app/production/...`
4. `docker restart app-api-1`

Then, once, run Migration 2026-09a (`audit_events`, at the end of `db/schema.sql`) in the Supabase SQL editor. Until you do, the feed still shows screens, checks, verifications, links and bin moves. The page says that sign-ins and account changes aren't being recorded yet.
