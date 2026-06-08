# Target Architecture

## Monorepo layout

```
/
├── backend/          # FastAPI + SQLModel + jobs + AI providers
├── frontend/         # TG-Summarizer React UI (ported from TG-Summarizer/)
├── docs/migration/   # ADRs and discovery
├── compose.yml       # Self-hosted always-on stack
└── TG-Summarizer/    # Original reference (deprecated after port)
```

## Module map (backend)

```
backend/app/
├── api/routes/
│   ├── telegram.py    # scrape, channel-info, bot-info, publish
│   ├── network.py     # proxy, tor
│   ├── ai.py          # summary, chat, embeddings, translate
│   ├── data.py        # CRUD + import/export + sync
│   ├── jobs.py        # scheduler status/control
│   └── rag.py         # vector search
├── ai/                # Pluggable LLM providers (Gemini first)
├── services/          # scraper, network, publish
├── jobs/              # APScheduler tasks
├── models_tg.py       # Domain SQLModel tables
└── core/config.py     # Extended settings
```

## Data flow (hybrid sync)

1. UI calls `repository.ts` (API-first).
2. On success, `cache.ts` updates IndexedDB.
3. On read, cache served if fresh; else fetch from API.
4. Server PostgreSQL is authoritative.

## Deployment

Docker Compose: `db`, `backend`, `frontend`, optional `tor` sidecar, Traefik for production HTTPS.
