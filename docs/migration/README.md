# TG Summarizer → FastAPI Migration

Documentation for migrating the browser-first TG-Summarizer app to the FastAPI + PostgreSQL monorepo.

## Migration status

**Complete (2026-06-08):** Phases **0–7** in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) are done (including Phase 4.5). Critical-path work (0 → 1 → 4 → 4.5 → 6) and parallel phases (2, 3, 5, 7) are shipped.

## Start here

| Document | Description |
|----------|-------------|
| **[DECISIONS.md](./DECISIONS.md)** | Locked migration choices (2026-06-08) with rationale |
| **[IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md)** | Phased execution plan (Phases 0–7, **all complete**); critical path 0 → 1 → 4 → 6 |
| **[REMEDIATION-PLAN.md](./REMEDIATION-PLAN.md)** | Post-migration audit fixes — 9 parallel workstreams, sprint allocation, quick wins |
| **[TARGET-ARCHITECTURE.md](./TARGET-ARCHITECTURE.md)** | End-state module map and data flow |

## Discovery and inventory

| Document | Description |
|----------|-------------|
| [INVENTORY.md](./INVENTORY.md) | IndexedDB stores, Express routes, contexts, browser jobs |
| [DATA-MODEL.md](./DATA-MODEL.md) | PostgreSQL schema draft |
| [SECRETS-MATRIX.md](./SECRETS-MATRIX.md) | Secret locations before/after migration |
| [MIGRATION-RISKS.md](./MIGRATION-RISKS.md) | Risk register and mitigations |
| [SPIKE-NOTES.md](./SPIKE-NOTES.md) | Phase 0.3 spike results (scrape, Gemini SSE, Tor) |
| [TEMPLATE-STUDY.md](./TEMPLATE-STUDY.md) | FastAPI template adoption notes |

## Architectural decision records

| ADR | Topic |
|-----|-------|
| [ADR-001](./ADR-001-repo-layout.md) | Repository layout |
| [ADR-002](./ADR-002-auth.md) | Authentication |
| [ADR-003](./ADR-003-hybrid-sync.md) | Hybrid sync (API-first + cache) |
| [ADR-004](./ADR-004-job-runner.md) | APScheduler job runner |
| [ADR-005](./ADR-005-vector-search.md) | Vector search |
| [ADR-006](./ADR-006-api-client.md) | API client style |
| [ADR-007](./ADR-007-tor-deployment.md) | Tor deployment |
| [ADR-008](./ADR-008-ai-providers.md) | AI provider abstraction |

## Code references

| Area | Path |
|------|------|
| Backend data API | `backend/app/api/routes/data.py` |
| Domain models | `backend/app/models_tg.py` |
| Hybrid sync (frontend) | `frontend/src/lib/repository.ts`, `frontend/src/lib/db.ts` |
| Scheduler (placeholders) | `backend/app/jobs/scheduler.py` |
| Original reference app | `TG-Summarizer/` (kept indefinitely) |
