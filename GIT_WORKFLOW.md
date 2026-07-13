# Git workflow for this folder

This folder is a **standalone git repository** — it has its own `.git`,
separate from the larger `id/` project tree it happens to sit inside. It is
not a subfolder of some bigger monorepo history; as far as git is concerned,
`development/admin/` *is* the repo root.

This matches how the rest of the project is organized: each piece (the
verification capture app, the verification API, this admin dashboard, the
database scripts, ...) lives in its own folder locally and pushes to its
own dedicated repo. Nothing here points outward at sibling folders, and
nothing outside this folder should assume it can `git add`/`git commit` on
its behalf.

## Remote

- **origin** → `https://github.com/Tblqck/adim.git`
- **branch** → `main`

## Everyday workflow

Run all git commands *from inside this folder* (`development/admin/`), not
from the parent `id/` directory — that parent knows nothing about this repo
(it's git-ignored there — see the top-level `.gitignore`).

```bash
cd development/admin       # if you're not already here
git status                  # see what changed
git add <files>              # stage specific files (check status first
                              # rather than blindly `git add -A`)
git commit -m "..."
git push origin main
```

## Deployment (Render)

This service (`adim-admin` in `render.yaml`) builds straight from the
`Dockerfile` at this repo's root — `runtime: docker`, no Root Directory or
Build/Start Command to configure, since the repo root already is the app.
One env var: `API_SERVER_URL` (defaults to the production EC2 verification
API if unset — see `.env.example`).

## What's gitignored here

- `.venv/`, `__pycache__/`, `*.pyc` — routine local Python clutter.
- `.env` — real `API_SERVER_URL` (and anything else local), never committed;
  `.env.example` is the tracked template.
- `.claude/` — Claude Code session files.
- `doc/` — local working notes, not part of the shipped app.

## Why this folder, specifically

`development/admin/` is the *only* thing that needs to exist to run the
admin dashboard: `main.py`/`admin_proxy.py` (the FastAPI app that proxies
to the real verification API's `/api/v1/admin/*` routes), the HTML/JS/CSS
pages (`list`, `detail`, `screen`, `kyb`, `document-check`, `generate-link`,
`databases`, `docs`, `users`), and `aws_admin_cert.pem` (the pinned TLS cert
for talking to the self-signed EC2 API). Nothing outside this folder is
required to build, run, or deploy it.
