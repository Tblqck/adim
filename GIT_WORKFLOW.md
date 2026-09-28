# Git workflow for this folder

This folder is a standalone git repository, separate from the larger `id/` tree it sits in.

## Remote

- **origin** is `https://github.com/Tblqck/adim.git`
- **branch** is `main`
- **legacy-fastapi-admin** is the old FastAPI + HTML dashboard, as it was before this Next.js app replaced it. Deploy that branch on Render to roll back.

## Everyday workflow

Run git from inside this folder. Check `git status` before staging, and stage specific files rather than everything.

## Deployment (Render)

`adim-admin` in `render.yaml` builds from the `Dockerfile` at the repo root (`runtime: docker`). You don't configure a build command, start command or root directory.

- **Env var:** only `API_SERVER_URL`, the EC2 API's admin routes, e.g. `https://18.185.59.156/api/v1/admin`. The API's self-signed certificate is pinned from `certs/aws_admin_cert.pem`.
- **Health check:** `/health`.
- **Base path:** the image serves at the root by default. The copy on the EC2 box is built with `--build-arg BASE_PATH=/v2` and served at `/v2`.
- **Old addresses:** `/admin/list`, `/admin/detail?id=…` and the like redirect to the new pages (`next.config.ts`).

## Running it locally

`npm install`, then:
- `npm run dev` runs the dashboard on the live API.
- `npm run sample` runs it on specimen data (ports 5070 and 5099).

See `README.md`.
