# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted Telegram channel summarizer, migrated from a standalone app (`TG-Summarizer/`, a parity reference, may be absent from some clones) into a FastAPI + React monorepo. See `README.md` and `development.md` for the full operator/setup guide; `docs/migration/` holds the ADRs and locked decisions (`DECISIONS.md`).

This file is an **index of invariants**, not an explanation of them. Every rule
below is a claim plus the test that enforces it; the argument for a rule lives in
that test's docstring and in the module it guards.
`docs/agents/architecture-rationale.md` archives the long-form reasoning, and it
is kept short here on purpose, because every byte is loaded into every session.

## Layout

- `backend/` — FastAPI API, AI providers, scraping, APScheduler jobs, PostgreSQL (SQLModel + Alembic). Managed by **uv as a workspace whose `.venv` lives at the repo root** — run `uv sync` from the root, not from `backend/`.
- `frontend/` — React 19 + Vite, managed by **bun** (root `package.json` declares the `frontend` workspace).
- Root `.env` is authoritative for **both** halves: backend reads it via `app.core.config.Settings`; the frontend reads `VITE_*` vars from the same file (`vite.config.ts` sets `envDir` to the repo root). Do not create `frontend/.env`. `.env.example` documents every tunable.

## Common commands

Backend (native, from repo root unless noted):
```bash
uv sync                                              # install (creates root .venv)
uv run fastapi dev backend/app/main.py --port 8000   # dev server (or: cd backend && uv run fastapi dev app/main.py)
cd backend && uv run pytest tests/ -q                # tests (see isolation note below)
cd backend && uv run pytest tests/api/routes/test_items.py::test_name  # single test
cd backend && bash scripts/lint.sh                   # mypy + ty + ruff check + ruff format --check
cd backend && uv run alembic revision --autogenerate -m "msg"   # new migration after model change
cd backend && uv run alembic upgrade head            # apply migrations
```

Frontend (from repo root or `frontend/`):
```bash
bun install
bun run dev                          # Vite on :5173, proxies /api → :8000
bun run --filter tg-summarizer-frontend test:unit    # bun test src
bun run lint                         # biome check --write (no semicolons, double quotes)
cd frontend && bunx tsc -p tsconfig.build.json --noEmit   # typecheck
cd frontend && bunx playwright test  # e2e; needs backend up (docker compose up -d db prestart backend)
```

Full stack via Docker: `docker compose watch` (frontend :5173, API :8000, Swagger :8000/docs, Adminer :8080). Lint/format everything: `cd backend && uv run prek run --all-files`.

## Backend architecture

Every rule below is a claim plus where it is enforced. **The argument for a rule
lives in the enforcing test's docstring and in the module it guards.** Read
those before changing one, because they are longer and better organised than any
summary here. `docs/agents/architecture-rationale.md` archives the long-form
reasoning for the parts that live nowhere else; `docs/*-plan.md` and
`docs/multi-user-tenancy-tickets.md` hold the ticket-by-ticket narrative.

### Models, authorisation, and View-as

- **Four model modules, split by what the models *are*.** `models.py` (template auth: `User`, `Item`), `models_tg.py` (all TG domain plus `AppSetting`), `models_rbac.py` (`Role`, `UserRole`), `models_view_as.py` (the View-as audit row). **Alembic's `env.py` must import every one.** A module it misses is invisible to autogenerate, which silently produces an *empty migration* rather than an error. The split is by category, not by count: a new category gets a new module, a model that fits an existing one does not.
- **Authorisation names a permission, never a role.** *Enforced: `tests/api/test_permission_checks.py`.* `core/permissions.py` holds the `Permission` constants and the three seeded roles, `services/rbac.py` resolves them, routes gate on `Depends(require_permission(Permission.X))`. **Nothing reads `is_superuser` to decide access.** Permissions are code (a closed set), roles are data (a fourth role is an `INSERT`). `reconcile_seeded_roles` runs on every boot and touches only the three seeded ids.
- **A View-as session is a token whose subject is somebody else.** *Enforced: `tests/api/test_view_as.py`.* `sub` is the **target** account and `act` is the acting Owner, so the tenancy seam, the follow scoping, every by-id read and the browser storage namespace already answer for it without ~40 read paths needing to be audited. The refusal lives in `get_current_user` and **nowhere else** (not middleware, not per-router). It refuses any non-safe method minus `VIEW_AS_READ_ONLY_PATHS`, which is an *inventory* the guard derives, not a set of special cases. The browser layers `view_as_token` over `access_token` and never replaces it; expiry falls back to the Owner's token exactly as exiting does. `VIEW_AS_ENDED_DETAILS` is an exact pair asserted on both sides so `api/base.ts::isAuthFailure` does not sign the Owner out over the target's account. `view_as_sessions` is the one per-User table that takes `SET NULL` rather than `CASCADE`, and denormalises both addresses.
- **Elevation is a second exchange, and the row it writes says who really wrote it.** *Enforced: `tests/api/test_view_as_elevation.py`.* `POST /view-as/{id}/elevate` is authorised by the Owner's **own** token, so a session can never widen itself; `minutes` is chosen per exchange under a ceiling the `Settings` validator keeps strictly shorter than the read-only session. Refused for a target holding **any** permission — that is "is an Admin" derived rather than named. `/view-as/*` and the `/users/me` credential routes stay refused however the session was elevated, and `view_as_allows` is still the one function that answers. Attribution rides `session.info` (`core/acting_owner.py`), **not** a `contextvar`: `get_current_user` is a `def`, so FastAPI solves it in a threadpool and a context set there lands on a copy the endpoint never reads. `acted_by_*` is stamped on **every** write, so a User editing their own row clears it.

### The tenancy seam

- **Row visibility has one seam, and it is on.** *Enforced: `tests/services/test_tenancy_seam.py`, `tests/api/test_account_isolation.py`.* `services/tenancy.py` answers "which rows may this User see"; `TENANCY_ENFORCED` ships **`True`**. Off is the **rollback**, not a preference: the disabled branch is asserted byte-identical to the pre-seam queries for all 27 models, and its cost is stated in `test_account_isolation.py::test_turning_the_flag_off_reopens_cross_account_reads`. The flag is read in **exactly one function**, `tenancy_enforced()`, and a guard greps all of `app/` to keep it that way.
- **Dispatch is by model class, never `.where(Model.user_id == ...)`.** `SCOPES` classifies every table as `USER_OWNED`, `FOLLOW_SCOPED` (an `EXISTS` correlating on `FOLLOW_KEYS`, because `Channel` spells the key `id` and the corpus tables spell it `channel_name`) or `CORPUS`. A table nobody placed fails the guard; `OUT_OF_SCOPE` excuses the five that are not the seam's business, each with a reason.
- **Four primitives, and which one you take is the rule.** `scoped_select` for lists. `assert_owner(detail=...)` for by-id **reads**, and it is flag-gated. `detail` is a required keyword with no default, it answers **404 not 403**, and the string must match what that family already answers for an absent row. `assert_owner_on_write` for by-id **writes**, and it is **ungated**, because a flag may gate visibility and never identity. `may_act_on` is the same rule without the raise, for callers with no response to put a 404 in; it has a **declared caller list walked from the AST**, because a read adopting it would narrow a response while enforcement is off. `unscoped_select(reason=...)` is the greppable escape hatch.
- **Scoping the read a function is named for is the easy half.** Scope every read it makes on the way, inside window subqueries as well as outside them, and remember the aggregation that runs *after* and overwrites the scoped answer. Four separate copies of "do I follow this handle?" were found this way; it is `follows.visible_channel_names` now.
- **An adoption must not change a response while the flag is off.** Exactly two exceptions exist, `/data/artifacts` and `list_setting_groups`, and each argues for itself where it is made. Identity questions never adopt the seam at all: the dismissal composite key and the setting-group name-collision check both answer *which row is yours*, and gating that makes the key decoration.
- **The write door is not the read door.** *Enforced: `tests/services/test_import_write_scoping.py`, `tests/services/test_auto_publish_scoping.py`.* `POST /data/import` and `/data/bot-credentials/migrate` reach rows by id and overwrite them; every table they write is checked or excused, derived from the AST. Import stamps new rows with the **subject**, never the document — the caller unless an Admin named somebody, which ticket 28 made expressible. `publish_summary_text` refuses a foreign credential **before `decrypt_token`**, and files a failed publish log rather than returning quietly, because the scheduler is unattended.
- **Every user-owned row has an owner before the flag flips.** *Enforced: `tests/services/test_owner_backfill.py`.* The backfill is a migration over the 14 tables `owner_backfill_inventory()` derives from `SCOPES`; the migration **freezes** its list and the guard derives one, because an applied revision must keep meaning what it meant. Payload rows inherit the parent's owner before the operator pass runs. `tg_channel_setting_groups` cannot be stamped (its unique index on `(COALESCE(user_id::text,'global'), lower(name))` refuses it) and is reconciled row by row instead. A used deployment with no resolvable superuser is refused loudly; a fresh install is not, because `prestart.sh` migrates before `init_db`.
- **An export is about one account, and the wide read has to be typed.** *Enforced: `tests/api/test_admin_scoped_export.py`.* `subject` omitted is the **caller**, a user id is that account, `all` is every account through `unscoped_select(reason=...)`; an unshowable subject answers one 404. Scoping is `subject_select`, the **ungated** twin of `scoped_select`, because a flag may gate visibility and never identity — so the follow-scoped `EXISTS` is already "the Posts of Channels the subject Follows". `export_sections` is one inventory the streamer, the pre-count and the coverage guard all walk; `EXPORT_OMISSIONS` is the other half. The row count travels in `X-Export-Rows`, which a `StreamingResponse` sends **before** the generator runs, and it is a pre-count under READ COMMITTED rather than a manifest. An import follows the handles its own Posts name (`POST /data/posts/bulk` does not, and says why).
- **The columns stay nullable, and eliminating the `user_id=None` creation paths is still open.**

### Follows, settings, retention

- **A Follow is the relation; the Channel and its Posts are not.** *Enforced: `tests/services/test_channel_creation_paths.py`, `tests/services/test_follows.py`, `tests/services/test_unfollow.py`.* `tg_channel_follows` carries everything private about watching a channel; `services/follows.py` is the **sole writer**, and a guard fails any module outside it that so much as names `ChannelFollow`. Every path that creates a Channel must write a Follow *and* be declared with a reason. `resolve_follow_owner` is the one rule for an ownerless Channel. `DELETE /data/channels/{id}` drops one follow and nothing else, 404 for a channel you do not follow.
- **Retention reclaims a Channel only once nobody follows it,** and only when `follows_backfilled()` says the table is authoritative. *Enforced: `tests/jobs/test_retention_collects_unfollowed.py`.* Ungated, retention fires ~60s after boot and deletes every channel and post on a database whose backfill has not run.
- **A follow always resolves a setting group.** *Enforced: `tests/services/test_follow_always_has_a_group.py`.* `Channel.setting_group_id` is gone, so a NULL on the follow makes `run_auto_sync` skip the channel forever and `get_group_for_channel` answer 500. `find_group_for_channel` is the non-raising half.
- **Superseded columns are gone.** *Enforced: `tests/services/test_superseded_columns.py`.* The seven follow-scoped tables carry no owner stamp and `Channel` none of the six per-User fields; the four sync cursors stay on `tg_channels` because they describe the shared backward walk. A guard fails any module naming a dropped attribute **or passing one as a constructor keyword**, because SQLModel accepts an unknown keyword and silently drops it.
- **Settings are two tables, and a key belongs to exactly one.** *Enforced: `tests/services/test_settings_table_split.py`.* `tg_app_settings` (PK `key`, deployment policy) and `tg_user_settings` (PK `(key, user_id)`, personal); `services/settings_registry.py` classifies every key with a sentence, and the two aggregates refuse each other's keys. The `sync` blob is three rows (`sync` policy, `sync_runtime` counters, `sync_prefs` per-User), reassembled by a **facade** so the wire shape never changed. A per-User key with no owner **raises**; it does not fall back to the operator.
- **Retention deletes on four windows, chosen by what the rows are.** *Enforced: `tests/jobs/test_retention_split_four_ways.py`.* Corpus on the deployment's `postRetentionDays` with **no owner filter**; personal logs and Discover reports on their owner's; sync logs, network logs and any ownerless row on `sharedLogRetentionDays`. `SHARED_LOG_TYPES`/`PERSONAL_LOG_TYPES` are derived from `tenancy.SCOPES`, never listed. A retention field with no owner raises rather than being dropped.

### Quota

- **The ledger counts Requests, and one Request is one `fetch_with_retry` call.** *Enforced: `tests/services/test_quota_ledger.py`, `tests/api/test_quota_usage_route.py`.* `tg_quota_usage`, PK `(user_id, day, budget)`, `services/quota.py` sole writer, `day` a DATE because the reset is UTC midnight. Charged **per attempt Telegram answered** (404, 429 and a soft block all count) from inside the retry loop, never once per call. The count travels by `contextvars` (`core/request_meter.py`) and meters **nest**; no meter active means no counting. Three Budgets derive totally from `SyncJobState.sync_mode`. Charged from a `finally`; a charge of zero writes no row. **Never pruned**, and the guard asserts it is on neither retention inventory.
- **Over Budget is a slower lane, never a refusal.** *Enforced: `tests/services/test_lane_selection.py`.* `lane_for_job` is the one seam every enqueue passes. `spent >= allowance`, and the `>=` is load-bearing, because it makes an allowance of **zero** mean "always best-effort, never blocked" by arithmetic; **negative is unlimited**. Usage is read for the account `resolve_charge_owner` says will be **charged**. A failed ledger read picks the **normal** lane, because nothing is refused at this rung. `RUN_SYNC_JOB_CALLERS` declares the two paths that sync without enqueueing; an undeclared third fails.
- **Past the ceiling nothing runs.** *Enforced: `tests/services/test_quota_ceilings.py`.* `resolve_budget_limits` reads the per-account row, then the `quota` settings row, then `config.py`, **each number independently**. The ceiling is an absolute count and **nothing derives it from the allowance** (a `10 x allowance` ceiling turns a zero allowance into a block). Checked in `sync_single_channel`, not only at enqueue, and **before `create_job`** in the scheduler, or a blocked account files ~1,400 failed job rows a day. This rung **fails closed**, deliberately unlike the lane rung. A refused Channel is *skipped*, not failed. The daily lift is a `requests = 0` row. `status` is computed server-side with **no pydantic default**.

### Routes and services

- **Thin routes, fat services.** `app/api/routes/*.py` are thin; logic lives in `app/services/*.py`. `/data` is a package, one module per resource family, and the parent router owns the prefix so operation ids stay `data-<function_name>`. **Never rename a route function without regenerating the client.** *Enforced: `tests/api/test_route_inventory.py`.*
- **Every route declares a response model.** *Enforced: `tests/api/test_route_module_hygiene.py`.* Request and response models live in `app/schemas/<resource>.py`; never inline a `BaseModel` in a route module and never return `dict[str, Any]`, which becomes `Record<string, unknown>` in the generated client.
  - **A list view must not carry a field only its detail view renders.** Same fix twice (26 MB and 56 MB pages). The shape is *list light + `GET .../{id}` full*, with search pushed into SQL. Pushing the projection into SQL does **not** dodge a TOAST detoast. Split the field into a companion **table**, not a sibling column.
  - **Models with an open `extra` column** use `ConfigDict(extra="allow")` and declare only always-present fields; a declared optional field serialises as an explicit `null` and changes the wire format.
- **Every service module is one of five kinds.** Aggregate (sole writer of one table, and it owns its companion payload table), read model, integration, pure transform, orchestrator. *Enforced: `tests/services/test_service_kinds.py`, which holds the per-module inventory and the declared exceptions, and that file is the authority.* **Never split a module because it got long.**
- **Router assembly.** `app/api/main.py` builds `/api/v1`; `private` routes mount only when `ENVIRONMENT == "local"`; `app/main.py` adds `APIKeyMiddleware`, CORS **outermost** so preflight beats auth, the lifespan, and a 410 for any `/api/*` outside `/api/v1/*`.
- **Two gates decide reachability, and they must agree.** *Enforced (both directions): `tests/api/test_public_route_exemptions.py`.* `APIKeyMiddleware` runs before routing; the route's dependencies decide the rest. They drifted once and left forgot-password 401ing outside `local` for months. Both answer 401, so **assert the `detail`**, not the status (`"Authentication required"` is the middleware, `"Not authenticated"` is the route). Middleware exemptions must be **settings-independent**, because policy belongs in the handler.
- **Registration and approval are two separate switches** (ADR-011). `USERS_OPEN_REGISTRATION` and `USERS_REQUIRE_APPROVAL`. Approval is not enforced at login; every data-bearing router refuses with `PENDING_APPROVAL_DETAIL`, mounted **per router** so an unrecognised router is a hole rather than an exemption. *Enforced: `tests/api/test_approval_gate.py`.* `POST /users/signup` answers 202 with one fixed message for every address. *Enforced: `tests/api/test_registration.py`.*

### The worker, the queue, and the proxies

- **Two processes: the API serves, the worker syncs.** *Enforced: `tests/deployment/test_worker_count.py`.* APScheduler, every lane consumer and `reconcile_interrupted_jobs` live in `app/worker.py`; the API starts none of them. The image runs `--workers 1` for the job registry and the per-proxy semaphores, so the **sync tier is pinned to one replica**. Scale the API tier, never the sync tier (`docs/scaling-to-multiple-workers.md`). Native dev must start the worker separately or the app silently syncs nothing.
- **Every sync mode enqueues, one message per Channel.** `app/jobs/sync_queue.py` consumes all six lanes; the last Channel to finish makes the job terminal. An enqueue **rings the worker over `NOTIFY`** and never drains locally; the 30s sweep is the backstop.
- **Six lanes, drained weighted rather than ordered.** *Enforced: `tests/services/test_sync_lanes.py`, `tests/services/test_lane_draining.py`.* `services/sync_lanes.py` is a pure transform holding both the names and the policy: strict between tiers, smooth-WRR 3:2:1 within one (single, bulk, auto). Strict order within a tier is the obvious implementation and it **starves auto-sync**. A slot is filled the moment it frees, one message at a time. Interleaving across accounts happens at the **read** (`_read_interleaved`), not the enqueue; not `pgmq.read_grouped_rr`, which serialises an account to one message. Pause is lossless, drain purges **and cancels the jobs it orphans**.
- **One sync per Channel at a time, and the claim is a row.** *Enforced: `tests/services/test_channel_mutual_exclusion.py`.* `Channel.sync_claimed_at`/`sync_claimed_by`, taken by a conditional `UPDATE ... RETURNING` in `sync_single_channel` (the function that walks the pages, not its callers). The 5-minute lease is **not** the ~2.4h visibility timeout. It bounds how long a *dead* holder blocks the Channel, and a live sync renews at a third of it. Release and renew are conditional on the holder. A second request coalesces onto the first, is not charged, and puts its concurrency permit down while it waits. **The claim is not the deadline**, and only `_finalize_channel_success` advances `next_*_sync_at`.
- **One worker per proxy, and the worker count derives from the proxies.** *Enforced: `tests/services/test_proxy_worker_partition.py`.* `proxy_pool.build_workers` deals workers round-robin across lanes; a worker owns its lane for the whole message but takes the semaphore permit **per request**. A bound worker **never hops, including on retry**, because hopping moves a dead proxy's load onto healthy ones exactly when Telegram is pushing back. The binding travels by `contextvars` and binds the **slot**, because a coalesced waiter may take a different worker back.
- **A status code is Telegram answering; it is not a proxy fault.** *Enforced: `tests/services/test_adaptive_proxy_wait.py`.* `services/proxy_pacing.py` (pure transform) classifies into seven outcomes. Only a `TRANSPORT_FAULT` arms cooldown on its own; a `REJECTION` or `SOFT_BLOCK` widens the per-proxy wait; an `ANSWERED_ERROR` (404, 410, 451) changes nothing. Cooldown is the **top rung of the wait ladder**, armed off the pace as it was *before* the failure. The wait is served **outside** the lane permit, timed out of the latency it feeds on, and given back when cancelled. Only `is_telegram_web_url` hosts are paced. **The retry predicate is deliberately unchanged**, because it also prices the quota ledger.
- **Ownership is granted by `claim_job`, never by creating a job.** *Enforced: `tests/services/test_cross_process_progress.py`.* `create_job` runs wherever the request landed; only the consumer claims.
- **Progress crosses processes over `LISTEN`/`NOTIFY`** (`app/core/pg_notify.py`; *enforced: `tests/core/test_pg_notify.py`*). The notification carries the changed **Channel**, not only the job id, because `sync_job_events` already falls back to a row read and would just serve stale state. Cancellation travels the same channel the other way.
- **Sync progress is pushed over SSE**, not polled; `GET .../{id}` is the reconnect fallback. There is **no list endpoint**, so job history is a write-only trail, pruned by `SYNC_JOB_RETENTION_DAYS` and **only in a terminal state**. *Enforced: `tests/services/test_sync_job_retention.py`.*

### Cost and performance

- **Never hold a session open across `await`ed work.** An `idle in transaction` transaction pins the xmin horizon so autovacuum reclaims nothing: `tg_sync_meta` reached 10 live rows and 4,743 dead. The symptom is single-row primary-key updates that stall for 21 seconds with no I/O and nothing in `pg_blocking_pids`. Read, project to plain values, close, *then* do the slow thing.
- **A scheduled job pays its cost every tick, forever.** Nobody is waiting on it, so a "compute it for everything, read one field" defect runs for months: the auto-sync tick spent **69 minutes of database time per 10 hours** on stats it discarded. Before batching a computation across every row, check what the caller reads and when it could possibly matter (`sync_schedule.needs_dynamic_stats` is that check made explicit, 2,077 channels down to six).
- **Three layers answer "why is this slow", and they are not interchangeable.** See **Finding slow endpoints** in `deployment.md`. Traefik's JSON access log is the only one that sees *transfer* cost; `app/middleware/timing.py` gives `Server-Timing`; `pg_stat_statements` names the query. Reach for the edge log first, but it **cannot see background work at all**, so when the layers disagree about whether the system is busy, the one counting requests is the one that is blind.
- **Compression is Traefik's job, not the app's.** Gzip comes from a `compress` middleware on the `backend`/`frontend` service labels. **Do not add Starlette's `GZipMiddleware`.** It double-encodes behind the proxy and, unlike Traefik, buffers, which would stall the SSE routes. `fastapi dev` serves uncompressed; that is expected.

## Frontend architecture

- **Two API clients, split per *call* by contract** (ADR-006). *Enforced: `src/api/client-split.conform.ts`.* Generated `src/client/` (committed, **do not hand-edit**) wherever its type is at least as useful; hand-written `src/api/` for SSE, blobs, and calls whose generated type would be a *downgrade* (an **open** model, or a **closed but all-optional** one). Measure openness with `string extends keyof T`, never by grepping for `[key: string]`. Regenerate with `bash scripts/generate-client.sh`.
- **Server state = TanStack Query, always.** *Enforced (partially): `src/lib/architecture-invariants.test.ts` pins `DataContext`'s field set.* It derives from queries and exposes setters as query-cache write-throughs; keys in `hooks/queryKeys.ts`.
- **PostgreSQL is the only client-side store.** *Enforced: `src/lib/architecture-invariants.test.ts`.* No `idb`/`localforage`/`dexie`, no `indexedDB`, no DB worker. The browser keeps settings and the current selection, nothing else.
- **Nothing says `localStorage` except four modules.** *Enforced: `src/lib/architecture-invariants.test.ts`.* Use `scopedStorage` (`lib/storage/scoped.ts`), which namespaces every key under `u:<userId>:` from the unverified JWT `sub`. The rule is "do not name `localStorage`" rather than "namespace your keys" because only the first can be checked. The four exceptions are **device-scoped on purpose** and `DEVICE_SCOPED_KEYS` is asserted as an exact pair. Signing out clears the **query cache**, not just the token; stored preferences are deliberately kept. Every accessor swallows storage errors, because reads run inside `useState` initialisers. Playwright seeds through `tests/utils/scoped-storage.ts`, never bare keys.
- **Settings are schema-driven.** Declare them in `src/lib/settings/schema.ts` (zod: key, default, legacy keys, backend section), not as new `useState` hooks. Theme is owned by `theme-provider` in `main.tsx`; do not add a second theme toggle (*that one is enforced*, the schema rule is **not**).
- **Routing and tabs come from the URL.** TanStack Router; the summarizer tab is `?tab=` on `/summarizer`, settings sub-sections are `?section=`.

## Testing & migrations

- **pytest uses a separate database (`app_test`) always** — `tests/conftest.py` overrides `POSTGRES_DB` to it and each test truncates `tg_*` tables afterward. Never point the dev server at `app_test`, and keep `POSTGRES_DB=app` for dev. One-time: `createdb app_test && cd backend && POSTGRES_DB=app_test uv run alembic upgrade head`.
- After changing any model, generate an Alembic revision and commit it; migrations live in `backend/app/alembic/versions/`.
- Maintenance/backfill scripts live in `backend/scripts/` (run with `uv run python backend/scripts/<name>.py`, usually `--dry-run` first) — see `MEMORY.md`.

## Architecture guards — read this before "simplifying" something

The rules above are not all equal. Some are **enforced** by a compile error or a
failing test; the rest are prose and rely on you. Prose decayed here before: this
file said *"never inline `BaseModel` in a route module"* from B1 onward, and three
modules were violating it when the guards below were written. So when a guard
fires, the answer is almost never to delete the guard.

Each row names the invariant and where it is asserted. **The row is the pointer,
not the summary.** Open the file for the full list of what it checks and why.

| Guard | Enforces | Kind |
|---|---|---|
| `frontend/src/types.conform.ts` | hand-written domain types match the server | compile error |
| `frontend/src/api/client-split.conform.ts` | the two-client split, **in both directions** | compile error |
| `frontend/src/lib/architecture-invariants.test.ts` | no browser DB; `DataContext` stays small; one theme owner; storage has exactly four owners; logout and stale-session clear the query cache | test |
| `backend/tests/api/test_route_module_hygiene.py` | no models in route modules; handlers annotate returns | test |
| `backend/tests/services/test_service_kinds.py` | every service module declares one of the five kinds | test |
| `backend/tests/api/test_route_inventory.py` | declared routes are actually mounted | test |
| `backend/tests/api/test_*_projection.py` | response key sets, no invented `null`s | test |
| `backend/tests/services/test_photo_cache_lookup_cost.py` | image-cache lookups don't scan the directory, in **both** twin modules | test |
| `backend/tests/services/test_summary_list_payload_cost.py` | listing summaries never opens the corpus table, **and the detail call does** | test |
| `backend/tests/services/test_log_list_payload_cost.py` | log lists drop the bodies, the detail route keeps them, search still reaches them | test |
| `backend/tests/services/test_sync_schedule_stats_narrowing.py` | the scheduler fetches stats only where they can change its answer, and **still fetches them where they can** | test |
| `backend/tests/services/test_sync_job_flush_cost.py` | job progress rides the flush interval; terminal states still write immediately | test |
| `backend/tests/services/test_sync_meta_commit_cost.py` | the etag moves in the same transaction as the change it announces | test |
| `backend/tests/jobs/test_auto_sync_session_scope.py` | the scheduler closes its planning transaction before syncing | test |
| `backend/tests/deployment/test_worker_count.py` | the scheduler has left the API; enqueueing never drains locally; the sync tier is one replica; the concurrency gate became a partition and has not come back beside it | test |
| `backend/tests/services/test_proxy_worker_partition.py` | one worker per proxy slot; a cut partition spreads instead of stacking; a parked worker comes back; a bound walk never hops; the binding follows a slot that swapped workers | test |
| `backend/tests/services/test_adaptive_proxy_wait.py` | a 404 neither parks nor paces its proxy at the **production** retry count; the ladder widens, caps and converges over a run of successes; cooldown is its top rung; the wait sits outside the lane permit and outside its own latency; only the web view is paced | test |
| `backend/tests/services/test_channel_mutual_exclusion.py` | one sync per Channel outside process memory; a live claim is not stolen and an expired one is; the second request rides the first uncharged; the claim never moves the schedule | test |
| `backend/tests/services/test_cross_process_progress.py` | a watcher sees progress the row does not have yet; creating a job does not claim it; a cancel reaches the running process | test |
| `backend/tests/services/test_sync_lanes.py` | every drained lane was created by a migration; a lane name is its Budget and tier; six lanes are the full product; a trickle never starves auto-sync | test |
| `backend/tests/services/test_lane_draining.py` | the weighting holds under **real load**; new normal work preempts a best-effort backlog; one account's backlog blocks nobody else; pause keeps messages visible and purge cancels the jobs it orphans | test |
| `backend/tests/core/test_pg_notify.py` | notifications cross a connection boundary and fan out to every subscriber | test |
| `backend/tests/services/test_sync_job_retention.py` | sync jobs are pruned by age but never while unfinished; restarts reconcile | test |
| `backend/tests/api/test_public_route_exemptions.py` | routes with no auth dependency are middleware-public, **and** every exemption still has such a route | test |
| `backend/tests/api/test_view_as.py` | every mutating operation is refused, allowlisted with a reason, or derived as authenticating nobody; the token names the target in `sub` and the Owner in `act`; the audit row outlives both accounts; a dead target does not sign the Owner out | test |
| `backend/tests/api/test_view_as_elevation.py` | elevation is refused for a target holding any permission while an Admin stays viewable; a session cannot widen or nest itself; every artifact family records the acting Owner and an ordinary write clears it; an AST guard fails a committing write that does not stamp | test |
| `backend/tests/api/test_admin_scoped_export.py` | an export names one subject; the default is the caller, not everybody; Follows, all four artifact families and personal settings travel and nobody else's do; the count is readable with the body unconsumed; a posts-only import leaves rows its account can read | test |
| `backend/tests/api/test_permission_checks.py` | authorisation reads roles, never `is_superuser` or a role name; the superuser kept its access | test |
| `backend/tests/services/test_follows.py` | the follow row carries what is private about watching a channel; `follows.py` is its only writer | test |
| `backend/tests/services/test_channel_creation_paths.py` | every Channel-creation path writes a Follow; the follow table has one writer; the guard's own function names still exist | test |
| `backend/tests/services/test_settings_table_split.py` | every settings key is classified with a reason; the two tables refuse each other's keys; the sync **and retention** carves are partitions; one writer per table | test |
| `backend/tests/jobs/test_retention_split_four_ways.py` | the corpus sweep ignores who scraped the row; one account's log window never reaches another's; shared and ownerless rows run on the deployment window and nothing else does; report caps are per account | test |
| `backend/tests/services/test_unfollow.py` | removal drops the follow and nothing else; a foreign channel is 404; a second account's Posts survive | test |
| `backend/tests/jobs/test_retention_collects_unfollowed.py` | retention collects only the Channels nobody follows, with their dependent rows | test |
| `backend/tests/services/test_tenancy_seam.py` | every table is classified or excused with a reason; scoping is byte-identical while the flag is off; the flag has exactly one reader | test |
| `backend/tests/api/test_account_isolation.py` | **all 135 mounted operations are probed with two live accounts or excused with a typed reason, and a `PROBED` entry no request exercises fails**; a foreign row is 404 with that family's own detail on read, write and delete; turning the flag off reopens cross-account reads | test |
| `backend/tests/deployment/test_env_example_matches_defaults.py` | `.env.example` ships `config.py`'s value for every boolean **and every integer**, or names the divergence | test |
| `backend/tests/services/test_artifact_tenancy_scoping.py` | all four artifact families and the History scope by owner, per leg, with that family's own 404 detail; writes and deletes refuse a foreign row **even while the flag is off** | test |
| `backend/tests/services/test_post_tenancy_scoping.py` | the feed, lookup, counts and Discover scope in **both** query shapes; the followed-channel set is scoped too; probes stay corpus and say why | test |
| `backend/tests/services/test_sync_log_channel_telemetry.py` | a second Follower sees telemetry the first produced; search and `searchInDetails` stay inside the Follow; the row stores no owner even when handed one | test |
| `backend/tests/services/test_import_write_scoping.py` | an import never overwrites another account's row, in **both** flag states; every table it writes is checked or excused, derived from the AST; **only reads use the flag-gated ownership guard** | test |
| `backend/tests/services/test_discover_dismissals_are_per_account.py` | the dismissal key carries its owner and a second account can dismiss what the first already did, under **both** flag states | test |
| `backend/tests/services/test_credential_tenancy_scoping.py` | both credential lists read through the seam, not a hand-rolled owner filter; `user_id` is a required keyword; an ownerless row's fate is pinned in both flag states | test |
| `backend/tests/services/test_setting_group_and_job_scoping.py` | the group list reads through the seam and is **unfiltered** with the flag off; the lookup map stays unscoped and says why; the running-job read is the caller's; all three write doors refuse a foreign group in **both** flag states | test |
| `backend/tests/services/test_auto_publish_scoping.py` | a foreign credential is refused **before** it is decrypted and answers as an absent one; a refusal reaches the publish log; the send is attributed to the Summary's owner | test |
| `backend/tests/services/test_owner_backfill.py` | the migration's frozen table list is the one `SCOPES` derives; no unowned user-owned row survives it; a payload takes its parent's owner; a duplicate setting group is merged rather than stamped into a unique-index violation; a fresh install completes where a used deployment with no superuser is refused | test |
| `backend/tests/services/test_superseded_columns.py` | the dropped columns are derived from `SCOPES` rather than listed; no module names one **or passes one as a constructor keyword** | test |
| `backend/tests/services/test_follow_always_has_a_group.py` | the migration rescues a follow still holding NULL before the drop; the scraper skips a group-less follow instead of raising; a chat-id collision freezes **every** follower; `run_db` keeps the ParamSpec that checks its call sites | test |
| `backend/tests/services/test_quota_ledger.py` | one Request per fetch however many attempts; only what reached Telegram; concurrent meters stay apart; nothing prunes the ledger | test |
| `backend/tests/api/test_quota_usage_route.py` | `GET /quota/me` reports the ledger for the caller and nobody else | test |
| `backend/tests/services/test_lane_selection.py` | the **real** enqueue picks the lane; the boundary is `>=` on both sides; zero is always best-effort and negative unlimited; exhausting one Budget leaves the other two alone; a failed ledger read picks normal; no new path syncs outside the ladder; one account's backlog leaves another's tick alone | test |
| `backend/tests/services/test_quota_ceilings.py` | a zero allowance degrades where a zero ceiling blocks and a negative one never does; the three layers resolve each number independently; a lift reaches one account, one Budget, one **day**; the refusal reaches the walk and not only the enqueue; an unreadable ledger refuses | test |
| `backend/tests/deployment/test_tg_cleanup_inventory.py` | every `tg_*` table is truncated between tests or excused, in both directions; the failure it prevents is a **green** test in an unrelated module | test |
| `backend/tests/deployment/test_claude_md_budget.py` | this file stays inside its line and byte budget, cites no path that has moved, and keeps every guard in the table above | test |
| `backend/tests/api/test_send_email_call_sites.py` | every `send_email` caller checks `emails_enabled` first, the pair rather than the site | test |
| `backend/tests/api/test_approval_gate.py` | every data router requires an approved account; unknown routers fail, exemptions state a reason | test |
| `backend/tests/api/test_registration.py` | signup answers identically for a taken and a free address, and never returns an account | test |
| `backend/tests/core/test_permissions.py` | no stranded permission, no permission on the default role, seeded rows match the constants | test |
| `backend/tests/deployment/test_edge_rate_limit.py` | the auth paths are rate limited at Traefik, and that router keeps its service, priority, and compression | test |
| pre-commit `generate-frontend-sdk` | the committed client matches the backend | hook |

**A fix applied to one of two twin modules is half a fix.** `channel_photos.py` and
`post_thumbnails.py` are the same module twice over (same `_META_SUFFIX`, `_meta_path`,
`_find_image_path`, `has_cached_*`, bounded extension set). The thumb cache was fixed to
probe extensions instead of globbing, with the reasoning in its docstring; the avatar
cache kept the glob for two more months and turned a channel list into 30 seconds. Its
guard is parametrised over *both* modules for that reason — when you fix one of a pair,
guard the pair.

`client-split.conform.ts` is the pattern worth copying. It asserts not only that
the *generated* models stayed closed, but that the *hand-written* ones are still
open — so closing one server-side breaks the build and tells you the call can now
move. **A deliberate exception that nothing checks becomes a leftover nobody dares
touch.** Assert the reason, not just the state.

**Mutation-test every guard before trusting it.** A green suite proves nothing
until you have watched it go red. This caught a false pass in six separate units
of the simplification programme — including one guard that could not fail at all.

## Conventions

- Python: mypy `strict`, `ty check`, ruff (isort, bugbear, no `print` — `T201`). Alembic dir excluded from lint/type-check.
- TS/React: biome, **no semicolons, double quotes**.
- CI test workflows are billing-blocked and never start, so as of 2026-07-30 their `push`/`pull_request` triggers are **commented out** (`grep -rn CI-DISABLED .github/workflows/`; see `.github/workflows/DISABLED.md` for the list and how to re-enable). Expect **no** checks on a PR; run lint/tests locally instead. Only the self-hosted staging deploy runs.
- **Every commit that lands on `main` must be signed** — but that does *not* mean signing every commit. Squash-merging a PR satisfies it automatically: GitHub authors the squash commit and signs it with its own key, so commits on a branch or in a `.claude/worktrees/` worktree need no signature and must never block on one. **Land PRs with squash merge only** — merge-commit mode puts the branch's own commits on `main` as-is, and rebase-merge replays them unsigned. When committing **directly to `main`**, sign locally (1Password); there a signing failure is a blocker to raise, not to bypass with `gpgsign=false`.
- Local `git log %G?` is **not** a valid signature check here — it reports `N` on genuinely SSH-signed commits (`gpg.ssh.allowedSignersFile` is unset) and `E` on GitHub's PGP-signed ones. Audit `main` against GitHub instead: `gh api 'repos/{owner}/{repo}/commits?sha=main&per_page=20' --jq '.[] | select(.commit.verification.verified | not) | .sha'` (empty output = clean).

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

## Agent skills

### Issue tracker

Local markdown under `.scratch/<feature-slug>/`, **not** GitHub Issues (which is enabled on the remote but unused). See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical labels, unchanged, recorded as a `Status:` line in each issue file. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at the root, ADRs and `DECISIONS.md` in `docs/migration/` (not `docs/adr/`). See `docs/agents/domain.md`.
