# TG Summarizer → FastAPI Migration

Documentation for migrating the browser-first TG-Summarizer app to the FastAPI + PostgreSQL monorepo.

## Migration status

**Complete (2026-06-08):** Phases **0–7** in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md) are done (including Phase 4.5). Critical-path work (0 → 1 → 4 → 4.5 → 6) and parallel phases (2, 3, 5, 7) are shipped.

**Template re-sync (2026-07-26):** the project is back in step with upstream — Python 3.14, upstream dependency floors and tooling. See [PYTHON-314-TEMPLATE-RESYNC.md](./PYTHON-314-TEMPLATE-RESYNC.md).

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
| [PYTHON-314-TEMPLATE-RESYNC.md](./PYTHON-314-TEMPLATE-RESYNC.md) | Python 3.14 upgrade + re-sync with upstream template (2026-07-26) — preserved divergences, PEP 758/649 consequences, how to diff against upstream |

## Architectural decision records

The ADRs and their index live in [`docs/adr/`](../adr/README.md).

## Code references

| Area | Path |
|------|------|
| Backend data API | `backend/app/api/routes/data/` (one module per resource family) |
| Domain models | `backend/app/models_tg.py` |
| Frontend API clients | `frontend/src/client/` (generated), `frontend/src/api/` (hand-written) |
| Scheduler (placeholders) | `backend/app/jobs/scheduler.py` |
| Original reference app | `TG-Summarizer/` (kept indefinitely) |
