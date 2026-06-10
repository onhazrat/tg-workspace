# TG Summarizer (FastAPI Migration)

Self-hosted Telegram channel summarizer migrated to a FastAPI + React monorepo.

## Structure

- `backend/` — FastAPI API, AI providers, scraping, jobs, PostgreSQL
- `frontend/` — React 19 + Vite UI (ported from TG-Summarizer)
- `docs/` — [Ideas log](docs/ideas-log/), [migration ADRs](docs/migration/)
- `TG-Summarizer/` — Original reference implementation

## Quick start (local)

### Backend

```bash
cd backend
uv sync
uv run fastapi dev app/main.py --port 8000
```

### Frontend

```bash
bun install
bun run dev
```

Set `GEMINI_API_KEY` in `.env` for AI features.

### Docker Compose

```bash
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- API docs: http://localhost:8000/docs

## API

- Legacy routes: `/api/scrape`, `/api/channel-info`, etc.
- Versioned routes: `/api/v1/telegram/*`, `/api/v1/network/*`, `/api/v1/ai/*`, `/api/v1/data/*`, `/api/v1/rag/*`, `/api/v1/jobs/*`

## Deployment & development

- [deployment.md](deployment.md) — Traefik, Docker Compose production stack, GitHub Actions CD
- [development.md](development.md) — local Docker, bun dev, Playwright, OpenAPI client generation

## Documentation

- [Ideas log](docs/ideas-log/) — backlog for future work sessions
- [Migration docs](docs/migration/) — ADRs, data model, and risks
