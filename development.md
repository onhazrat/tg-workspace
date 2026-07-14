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

**Postgres schema (native dev)** — keep `POSTGRES_DB=app` in `.env` for the API (pytest uses `POSTGRES_DB_TEST=app_test` separately; do not point `POSTGRES_DB` at the test database). If only the Compose `db` container is running, apply migrations to `app` before startup:

```bash
cd backend && uv run alembic upgrade head
```

A startup error `relation "user" does not exist` means `app` exists but has no tables yet (run the command above).

Set `GEMINI_API_KEY` in the root `.env` for AI features.

**Tunable defaults** — sync concurrency, scheduler intervals, RAG limits, network retries, job enabled defaults (`JOBS_*_ENABLED_DEFAULT`), and frontend poll intervals are documented in [`.env.example`](.env.example). Backend reads them via `app.core.config.Settings`; frontend reads `VITE_*` vars from the **same root `.env`** (`frontend/vite.config.ts` sets `envDir` to the repo root) through `frontend/src/lib/env.ts` (build-time for production Docker images). On a fresh database, scheduler job enabled flags come from those env vars until persisted in the `jobs` AppSetting row (embeddings and translation batch default to off).

For **bot token encryption** (Phase 2), set `TOKEN_ENCRYPTION_KEY` in `.env` to a Fernet key (generate command in `.env.example`). Required when `ENVIRONMENT` is not `local`; local dev may leave it empty and the backend uses a dev-only fallback. Staging/production without this key will fail when storing or migrating bot credentials.


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

**Signup** (`/signup`) is enabled when `USERS_OPEN_REGISTRATION=true` (default in `.env.example`). Copy [`.env.example`](.env.example) to `.env` at the **repo root** only (not under `frontend/`). Leave `VITE_API_URL` empty so the Vite dev server proxies `/api` to the backend on port 8000.

**Bootstrap superuser** — on backend startup (native dev, VS Code debug, and Docker), the app ensures the first admin exists if missing. Docker Compose also runs `scripts/prestart.sh` before the process starts (same idempotent check).

| Variable | Default |
|----------|---------|
| `FIRST_SUPERUSER` | `admin@example.com` |
| `FIRST_SUPERUSER_PASSWORD` | `changethis` |

Log in at `/login` with those credentials, or sign up a new account when open registration is enabled. An existing superuser password is never overwritten.

If signup is disabled (`USERS_OPEN_REGISTRATION=false`), use the bootstrap superuser or ask an admin to create your account.

## Sprint 3 / UI

Frontend hardening from Sprint 3 (full workstream log: [REMEDIATION-PLAN.md Appendix C](docs/migration/REMEDIATION-PLAN.md#appendix-c-sprint-3-implementation-log-2026-06-09)).

### Summarizer tabs (URL)

The active summarizer tab comes from the `tab` search param on `/summarizer`, not from `localStorage`. Valid values: `summary`, `posts`, `channels`, `history`, `chat`, `settings` (default when missing or invalid). Legacy `?tab=network` maps to `settings` with `section=network`. Tab changes update the URL via `useSummarizerTab` (replace navigation). Example: `http://localhost:5173/summarizer?tab=settings`.

### Settings sub-tabs (URL)

When the settings workspace tab is active, the Engine Room sidebar section is driven by the `section` search param. Valid values: `appearance`, `sync`, `ai`, `network`, `db`, `publishing`, `diagnostics` (default `appearance` when missing or invalid). Example deep link: `http://localhost:5173/summarizer?tab=settings&section=network`. Section changes update the URL via `useSettingsSection` (replace navigation).

Successful login redirects to `/summarizer?tab=summary`.

### Theme

Light / dark / system theme is owned by `theme-provider` in `main.tsx` (`frontend/src/components/theme-provider.tsx`). Preference persists in `localStorage` under `vite-ui-theme`. Do not reintroduce a separate theme toggle in `SettingsContext`.

## Sync job progress (SSE)

Channel sync progress is pushed over **Server-Sent Events** instead of client polling:

| Endpoint | Purpose |
|----------|---------|
| `POST /api/v1/jobs/sync` | Start a sync job |
| `GET /api/v1/jobs/sync/{job_id}/events` | SSE stream of full `SyncJobStatus` snapshots |
| `GET /api/v1/jobs/sync/{job_id}` | One-shot status (reconnect / fallback polling) |

Backend tunables (root `.env`): `SYNC_JOB_SSE_THROTTLE_MS` (default 1000), `SYNC_JOB_PERSIST_INTERVAL_MS` (default 5000). Frontend: `VITE_SYNC_JOB_TIMEOUT_MS`, `VITE_SYNC_JOB_FALLBACK_POLL_MS`, `VITE_SYNC_META_MIN_INTERVAL_MS` (default 5000 — throttles etag polling).

## Bulk re-backfill (2000+ channels)

After correcting **Default Channel Start Time** in Settings → Scraping & Sync, run a full re-backfill:

```bash
# API (preferred)
curl -X POST http://localhost:8000/api/v1/data/channels/bulk-reset-sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

`POST /api/v1/data/channels/bulk-reset-sync` with `{"confirm": true}` clears posts, nulls `startId`, and queues one sync job per channel. UI button in Settings → Scraping & Sync.

**Deprecated:** `bulk_reresolve_start_ids.py` and `POST /api/v1/data/channels/bulk-reresolve-start-ids` are backward-compat no-ops — use bulk reset-sync instead. See [MEMORY.md](MEMORY.md) maintenance scripts table.

**Auto-follow forwarded:** enable per channel on each **ChannelCard** (`autoFollowForwarded` toggle). There is no global Settings toggle. To clean up channels discovered via forwards: `uv run python backend/scripts/cleanup_auto_follow_channels.py --dry-run` then `--freeze` or `--delete` (add `--auto-follow-only` to limit scope).

## Legacy API (`/api/*`)

**Supported surface:** `/api/v1/*` only. Use hand-written `frontend/src/api/` for the summarizer and generated `frontend/src/client/` for the admin shell ([ADR-006](docs/migration/ADR-006-api-client.md)).

- **Local dev:** `legacy.router` mounts `/api/*` aliases with `Deprecation` headers pointing to `/api/v1/*`.
- **Production:** middleware returns **410 Gone** for any `/api/*` path (not under `/api/v1/`).
- **OpenAPI client regen:** `scripts/generate-client.sh` sets `ENVIRONMENT=production` so committed `frontend/openapi.json` excludes legacy routes.
- **`bulk-reresolve-start-ids`:** deprecated no-op; use `bulk-reset-sync` instead.

The `TG-Summarizer/` reference tree may be absent from some clones; it is kept for parity reference, not deployment.

## Testing

Backend pytest **always** uses a separate Postgres database (`app_test` by default). It never reads or writes the dev database (`app`).

### One-time setup

**Native Postgres** (from repo root):

```bash
createdb app_test
cd backend && POSTGRES_DB=app_test uv run alembic upgrade head
```

**Docker Compose** — new volumes run `scripts/postgres-init/01-create-test-db.sh` on first boot. If the volume already existed before that script was added:

```bash
docker compose exec db psql -U postgres -d app -c "CREATE DATABASE app_test;"
docker compose run --rm prestart bash -c "POSTGRES_DB=app_test alembic upgrade head"
```

Set `POSTGRES_DB_TEST=app_test` in `.env` (see `.env.example`). `conftest.py` overrides `POSTGRES_DB` to that value for every pytest run.

### Run tests

```bash
cd backend && uv run pytest tests/ -q
```

Each test truncates all `tg_*` tables afterward so suites cannot pollute each other.

### Clean test pollution from dev DB

If pytest previously ran against `app`, remove leftover test channels once:

```bash
uv run python backend/scripts/cleanup_test_channels.py --dry-run
uv run python backend/scripts/cleanup_test_channels.py
uv run python backend/scripts/backfill_user_id.py --reassign-all
```

`cleanup_test_channels.py` deletes known test channel IDs/names, dependent posts/embeddings/summaries/sync logs, and network log `nl-test-1`, then optionally reassigns `user_id` on remaining rows.

## Pre-commits and code linting

We use [prek](https://prek.j178.dev/) (modern alternative to [Pre-commit](https://pre-commit.com/)) for code linting and formatting.

When you install it, it runs right before making a commit in git. This way it ensures that the code is consistent and formatted even before it is committed.

You can find a file `.pre-commit-config.yaml` with configurations at the root of the project.

#### Install prek to run automatically

`prek` is already part of the dependencies of the project.

After having the `prek` tool installed and available, you need to "install" it in the local repository, so that it runs automatically before each commit.

Using `uv`, you could do it with (make sure you are inside `backend` folder):

```bash
❯ uv run prek install -f
prek installed at `../.git/hooks/pre-commit`
```

The `-f` flag forces the installation, in case there was already a `pre-commit` hook previously installed.

Now whenever you try to commit, e.g. with:

```bash
git commit
```

...prek will run and check and format the code you are about to commit, and will ask you to add that code (stage it) with git again before committing.

Then you can `git add` the modified/fixed files again and now you can commit.

#### Running prek hooks manually

you can also run `prek` manually on all the files, you can do it using `uv` with:

```bash
❯ uv run prek run --all-files
check for added large files..............................................Passed
check toml...............................................................Passed
check yaml...............................................................Passed
fix end of files.........................................................Passed
trim trailing whitespace.................................................Passed
typos....................................................................Passed
biome check..............................................................Passed
ruff check...............................................................Passed
ruff format..............................................................Passed
mypy check...............................................................Passed
ty check.................................................................Passed
```

## Mode A deployment (hardened single-operator)

Remediation chose **Mode A** on 2026-06-09 ([DECISIONS.md](docs/migration/DECISIONS.md)). Expectations:

| Environment | Auth | Secrets |
|-------------|------|---------|
| `local` | JWT for UI; `API_KEY` optional | `TOKEN_ENCRYPTION_KEY` optional (dev fallback) |
| `staging` / `production` | JWT or `X-API-Key`; fail-closed without either | `TOKEN_ENCRYPTION_KEY` required; `API_KEY` required in `production` |

- Set `USERS_OPEN_REGISTRATION=false` in production.
- All AI, RAG, network, telegram, and jobs routes require authentication.
- Raw bot tokens in request bodies are rejected outside `local`; use stored `credentialId`.
- Single superuser owns all Postgres data; per-user row scoping is deferred to Mode B.
- After importing legacy IndexedDB data, backfill `user_id` so scheduler/sync jobs see your channels (script loads the repo-root `.env`):

  ```bash
  # from repo root
  uv run python backend/scripts/backfill_user_id.py --dry-run
  uv run python backend/scripts/backfill_user_id.py

  # or from backend/
  cd backend && uv run python scripts/backfill_user_id.py --dry-run
  cd backend && uv run python scripts/backfill_user_id.py
  ```

  If sync returns `No channels to sync` despite visible channels (stale `user_id` from old test accounts), add `--reassign-all` (always `--dry-run` first).

## Documentation

- **Ideas log** — [`docs/ideas-log/`](docs/ideas-log/README.md) for backlog items to pick up in a later session (reference an `IDEA-NNN` id when starting work with the agent).
- **Migration** — [`docs/migration/`](docs/migration/README.md). Locked decisions: [DECISIONS.md](docs/migration/DECISIONS.md). Phased plan: [IMPLEMENTATION-PLAN.md](docs/migration/IMPLEMENTATION-PLAN.md). Remediation: [REMEDIATION-PLAN.md](docs/migration/REMEDIATION-PLAN.md).
