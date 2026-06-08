# FastAPI Template Study (Phase 0.2)

## Backend layout

- `backend/app/main.py` — FastAPI app, CORS, router mount at `/api/v1`
- `backend/app/api/main.py` — aggregates route modules
- `backend/app/models.py` — SQLModel User/Item (demo; TG models in `models_tg.py`)
- `backend/app/core/config.py` — pydantic-settings from `.env`
- `backend/app/alembic/` — migrations via `alembic upgrade head`

## Auth flow

- JWT in `login.py`, `deps.py` `CurrentUser`
- Bootstrap superuser from `FIRST_SUPERUSER` env
- TG app adds optional `X-API-Key` middleware for light auth

## Frontend client

- Auto-generated `src/client/` from OpenAPI — used for admin only
- TG routes use hand-written `src/api/`

## Docker/dev

- `compose.yml` + `compose.override.yml` — db, backend:8000, frontend:5173
- `docker compose watch` for live reload

## Strip for TG Summarizer

- Demo Items CRUD (keep routes disabled or unused)
- Email recovery flows (optional in local dev only)
- Playwright tests for Items → replace with TG smoke tests later
