# Locked Migration Decisions

**Date:** 2026-06-08  
**Status:** Locked — do not revisit without explicit stakeholder sign-off.

## Remediation deployment mode — **Mode A** (2026-06-09)

**Choice:** Hardened single-operator ([REMEDIATION-PLAN.md](./REMEDIATION-PLAN.md) Phase 0.1).

**Implications:**

- Production requires `API_KEY`, `TOKEN_ENCRYPTION_KEY`, and a non-default `SECRET_KEY`.
- `USERS_OPEN_REGISTRATION=false` in production; single superuser owns all data.
- Nullable `user_id` on TG tables is forward-compatible metadata; reads remain unscoped.
- WS-B tasks marked **(Mode B only)** are deferred unless multi-user is explicitly chosen later.

These decisions resolve open questions from [TARGET-ARCHITECTURE.md](./TARGET-ARCHITECTURE.md), [DATA-MODEL.md](./DATA-MODEL.md), and the ADR series. Implementation details live in [IMPLEMENTATION-PLAN.md](./IMPLEMENTATION-PLAN.md).

## Summary table

| # | Topic | Choice |
|---|--------|--------|
| 1 | Multi-user scope | **C** — single-operator now; nullable `user_id` columns for future multi-user |
| 2 | Bot token migration | **A** — auto-upload from IndexedDB on first login, then purge locally |
| 3 | Encryption key | **B** — dedicated `TOKEN_ENCRYPTION_KEY` env var |
| 4 | Transition writes | **C** — API-first; IndexedDB fallback + user-visible warning on failure |
| 5 | Offline mode | **C** — browse cached data; disable sync/scrape/summary/publish when API down |
| 6 | Auto-summary | **C** — per-channel `autoRegenerate` / publish flags respected server-side |
| 7 | Translation | **C** — scheduler batch now; on-demand hover translations deferred |
| 8 | Tor deployment | **A** — optional feature flag, off by default in Compose |
| 9 | Sync job state | **C** — in-memory in Phase 4; Postgres `SyncJob` table before Phase 6 |
| 10 | TG-Summarizer/ dir | **C** — keep as historical reference indefinitely |
| 11 | Proxy URLs | Per-user `proxyUrls` in Postgres; `DEFAULT_PROXY_URLS` env fallback only |

---

## 1. Multi-user scope — **C**

**Rationale:** The deployment target is a self-hosted single operator ([ADR-002](./ADR-002-auth.md)). Building full multi-tenancy now would delay the Postgres migration without immediate benefit. Adding nullable `user_id` columns to mutable TG tables in Phase 0 keeps the schema forward-compatible without requiring row-level security, per-user JWT scoping, or UI changes today.

**Affects:** `backend/app/models_tg.py`, Alembic migrations, `backend/app/api/routes/data.py`.

---

## 2. Bot token migration — **A**

**Rationale:** Bot tokens currently live in IndexedDB (`frontend/src/lib/db.ts`, store `bot_credentials`) and are sent to the server per request. Auto-upload on first authenticated session gives a one-time, low-friction migration path: the user logs in, the client reads local credentials, POSTs them to the server, and deletes the IndexedDB rows on success. Manual export/import remains available via `DatabaseManagement.tsx` as a fallback.

**Affects:** Phase 2 — `frontend/src/components/BotManagement.tsx`, new `POST /api/v1/data/bot-credentials/migrate` (or equivalent), `backend/app/models_tg.py` (`BotCredential`).

**Related:** [SECRETS-MATRIX.md](./SECRETS-MATRIX.md).

---

## 3. Encryption key — **B**

**Rationale:** Bot tokens must be encrypted at rest in PostgreSQL. Reusing `SECRET_KEY` couples JWT rotation to credential decryption and makes key compromise catastrophic. A dedicated `TOKEN_ENCRYPTION_KEY` env var (documented in `.env.example`, loaded via `backend/app/core/config.py`) isolates token encryption from auth secrets and matches common Fernet/AES patterns.

**Affects:** Phase 2 — `backend/app/core/config.py`, new `backend/app/services/crypto.py` (or similar), `compose.yml` env passthrough.

**Related:** [SECRETS-MATRIX.md](./SECRETS-MATRIX.md).

---

## 4. Transition writes — **C**

**Rationale:** During the hybrid-sync transition ([ADR-003](./ADR-003-hybrid-sync.md)), writes must prefer the API so PostgreSQL becomes authoritative. When the API is unreachable, falling back to IndexedDB prevents data loss for the operator, but silent divergence is worse than a visible warning. The UI shows a toast/banner when a write lands only in cache.

**Affects:** Phase 1 — `frontend/src/lib/repository.ts`, all contexts that persist data (`DataContext.tsx`, `AIContext.tsx`, etc.).

---

## 5. Offline mode — **C**

**Rationale:** IndexedDB already holds posts, channels, summaries, and embeddings. When the backend health check fails, the app should remain usable for read-only browsing of cached data. Mutating operations — channel sync, scrape, summary generation, publish — are disabled with clear UI affordances rather than queuing writes for later replay (deferred per ADR-003).

**Affects:** Phase 1 — `frontend/src/lib/repository.ts`, `frontend/src/App.tsx`, `ScraperContext.tsx`, `AIContext.tsx`, connectivity indicator in the shell.

---

## 6. Auto-summary — **C**

**Rationale:** `autoRegenerate` and `autoPublish` flags on `Summary` objects (`frontend/src/types.ts`) currently drive 60 s polling in `AIContext.tsx`. Moving this logic to APScheduler ([ADR-004](./ADR-004-job-runner.md)) ensures summaries regenerate and publish even when the browser tab is closed. The server must read the same flags from Postgres (`Summary.extra` JSON or dedicated columns) and respect per-summary configuration.

**Affects:** Phase 6 — `backend/app/jobs/scheduler.py`, `backend/app/api/routes/ai_routes.py`, `backend/app/api/routes/telegram.py` (publish).

---

## 7. Translation — **C**

**Rationale:** `TranslationContext.tsx` already batches on-demand hover requests with a 1 s debounce. Moving the batch processor to the server scheduler covers background translation of new posts. On-demand hover translations (per-post, interactive) are deferred to reduce Phase 6 scope; the UI can show untranslated text until the batch job runs.

**Affects:** Phase 6 — `backend/app/jobs/scheduler.py`, `backend/app/api/routes/ai_routes.py` (`/translate`). Hover path stays in `TranslationContext.tsx` as a stub until a later phase.

---

## 8. Tor deployment — **A**

**Rationale:** Tor is a niche requirement with high operational complexity ([ADR-007](./ADR-007-tor-deployment.md), [MIGRATION-RISKS.md](./MIGRATION-RISKS.md)). Making it an optional Compose profile or `TOR_ENABLED` feature flag (off by default) keeps the default stack simple. Operators who need Tor opt in via env + sidecar; `TOR_CONTROL_PASSWORD` stays server-side only.

**Affects:** `compose.yml`, `backend/app/api/routes/network.py`, `backend/app/services/network.py`. Spike notes in [SPIKE-NOTES.md](./SPIKE-NOTES.md).

---

## 9. Sync job state — **C**

**Rationale:** Phase 4 introduces server-side scrape orchestration with in-memory job tracking — sufficient for a single backend instance and fast to ship. Before Phase 6 (persistent APScheduler jobs that must survive restarts), add a `SyncJob` Postgres table so job history, status, and crash recovery are durable. This two-step approach avoids over-engineering Phase 4 while meeting always-on deployment needs.

**Affects:** Phase 4 — in-memory dict in `backend/app/api/routes/telegram.py` or `backend/app/services/scraper.py`. Phase 5.5 (pre-6) — `SyncJob` model in `backend/app/models_tg.py`, Alembic migration, job persistence layer.

**Related:** [ADR-004](./ADR-004-job-runner.md).

---

## 11. Per-user proxy URLs — **override (2026-06-09)**

**Rationale:** Phase 2 moved proxy URLs to server-only `DEFAULT_PROXY_URLS`, which blocked operators from configuring proxies in the UI. Each authenticated user now stores `proxyUrls` in the `network` `AppSetting` row (with `user_id` set on save). Server env `DEFAULT_PROXY_URLS` remains a **fallback** when proxies are enabled but the user list is empty. Scheduler `auto_sync` uses the network setting owner’s `user_id` (or per-channel `user_id` when set). Multi-user isolation will require a composite `(key, user_id)` PK on `tg_app_settings` in a later phase.

**Affects:** `backend/app/services/network_settings.py`, `backend/app/api/routes/data.py`, `backend/app/services/sync_orchestrator.py`, `backend/app/jobs/auto_sync.py`, `frontend/src/contexts/SettingsContext.tsx`, `frontend/src/components/SettingsView.tsx`.

**Related:** [SECRETS-MATRIX.md](./SECRETS-MATRIX.md).

---

## 10. TG-Summarizer/ directory — **C**

**Rationale:** The original Express + Vite app in `TG-Summarizer/` is the behavioral reference for scrape parsing, UI flows, and test fixtures. Keeping it indefinitely ([ADR-001](./ADR-001-repo-layout.md)) costs little disk space and aids diffing during parity work. It is not deployed and not imported by the monorepo build.

**Affects:** Documentation only. No deletion timeline.

---

## ADR alignment

| Decision | ADR / doc updated or confirmed |
|----------|-------------------------------|
| 1 | Confirms [ADR-002](./ADR-002-auth.md) light auth; extends [DATA-MODEL.md](./DATA-MODEL.md) |
| 4, 5 | Refines [ADR-003](./ADR-003-hybrid-sync.md) offline and fallback behavior |
| 6, 7, 9 | Refines [ADR-004](./ADR-004-job-runner.md) job scope and persistence |
| 8 | Confirms [ADR-007](./ADR-007-tor-deployment.md) optional deployment |
