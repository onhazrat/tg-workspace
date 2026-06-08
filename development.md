# TG Summarizer — Development

## Docker Compose

Start the full local stack with file watching:

```bash
docker compose watch
```

| Service | URL |
|---------|-----|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| Adminer | http://localhost:8080 |
| Traefik dashboard | http://localhost:8090 |
| Mailcatcher | http://localhost:1080 |

Logs:

```bash
docker compose logs backend
```

## Mailcatcher

Local SMTP is routed to Mailcatcher (port 1025). View captured emails at http://localhost:1080.

## Native dev (without Docker)

### Backend

From the repo root (uv workspace — creates `.venv` at the root):

```bash
uv sync
cd backend
uv run python -m uvicorn app.main:app --reload --port 8000
```

Or use the FastAPI CLI: `uv run fastapi dev app/main.py --port 8000`.

Set `GEMINI_API_KEY` in the root `.env` for AI features.

### Frontend

```bash
bun install
bun run dev
```

Or from the repo root:

```bash
bun run dev
```

Stop a Compose service and run its native equivalent on the same port — e.g. `docker compose stop frontend` then `bun run dev`.

## VS Code debugging

Open the repo root in VS Code. Configurations in [`.vscode/`](.vscode/):

| Launch config | What it does |
|---------------|--------------|
| **Debug FastAPI Project backend** | Starts Postgres via Docker, then runs the backend with debugpy on port 8000 |
| **Debug Frontend** | Starts `bun run dev` (Vite on 5173), then opens Chrome |
| **Debug Full Stack** | Both of the above in one compound session |

Uses root `.env` for backend env vars. Ensure the workspace venv exists (`uv sync` from the repo root creates `.venv/`). Install [Bun](https://bun.sh) for the frontend debug task.

## Local Traefik subdomains

Set in `.env`:

```dotenv
DOMAIN=localhost.tiangolo.com
```

Restart the stack. Traefik routes `api.localhost.tiangolo.com` → backend and `dashboard.localhost.tiangolo.com` → frontend.

## OpenAPI client generation

After backend API changes:

```bash
bash scripts/generate-client.sh
```

This exports `frontend/openapi.json` and regenerates `frontend/src/client/`.

## Playwright E2E

With the stack running (backend + mailcatcher at minimum):

```bash
docker compose run --rm playwright bunx playwright test
```

Or locally:

```bash
cd frontend
bunx playwright test
```

HTML report (local): `bunx playwright show-report`

## Auth

* Browser login: `/login` → JWT in `localStorage.access_token`
* Scripts: optional `X-API-Key` header when `API_KEY` is set
* Primary app: `/summarizer` (full-screen TG UI)
* Admin dashboard: `/`, `/items`, `/admin`, `/settings`

### Local registration and login

**Signup** (`/signup`) is enabled when `USERS_OPEN_REGISTRATION=true` (default in `.env.example`). Leave `VITE_API_URL` empty in `.env` so the Vite dev server proxies `/api` to the backend on port 8000.

**Bootstrap superuser** — Docker Compose runs `scripts/prestart.sh`, which creates the first admin if missing:

| Variable | Default |
|----------|---------|
| `FIRST_SUPERUSER` | `admin@example.com` |
| `FIRST_SUPERUSER_PASSWORD` | `changethis` |

For native backend dev (without Docker), run once after migrations:

```bash
cd backend
uv run python app/initial_data.py
```

Then log in at `/login` with those credentials, or sign up a new account when open registration is enabled.

If signup is disabled (`USERS_OPEN_REGISTRATION=false`), use the bootstrap superuser or ask an admin to create your account.

## Pre-commit

```bash
cd backend
uv run prek install -f
uv run prek run --all-files
```
