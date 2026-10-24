# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Self-hosted Telegram channel summarizer, migrated from a standalone app (`TG-Summarizer/`, a parity reference, may be absent from some clones) into a FastAPI + React monorepo. See `README.md` and `development.md` for the full operator/setup guide; `docs/adr/` holds the ADRs and `docs/migration/DECISIONS.md` the locked migration decisions.

This is an **index of invariants**: every rule names its guard. Reasoning lives
there; history is in `docs/agents/architecture-rationale.md`. Every session
loads this file, so the architecture lives beside the code it governs:

- `backend/CLAUDE.md`: the backend's invariants. Read it before changing anything under `backend/`.
- `frontend/CLAUDE.md`: the frontend's invariants. Read it before changing anything under `frontend/`.
- `docs/agents/architecture-guards.md`: every guard and what it enforces. Read it when a guard fails, and before you add, change or delete one.

Claude Code loads the first two by itself once it reads a file in that tree; the pointers cover every other way in.

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

## Testing & migrations

- **pytest never touches the dev database.** `tests/conftest.py` points it at `app_test` (once: `createdb app_test && cd backend && POSTGRES_DB=app_test uv run alembic upgrade head`), or in a worktree at the `app_test_<worktree>` that `bash scripts/worktree-setup.sh` creates and `--teardown` drops. Each test truncates `tg_*` tables.
- After changing any model, generate an Alembic revision and commit it; migrations live in `backend/app/alembic/versions/`.
- Maintenance/backfill scripts live in `backend/scripts/` (run with `uv run python backend/scripts/<name>.py`, usually `--dry-run` first) — indexed in `development.md`.

## Architecture guards

Some rules are **enforced** by a compile error or a failing test; the rest are
prose and rely on you. Prose decayed here before, so when a guard fires, the
answer is almost never to delete the guard. The guard table, and the patterns
worth copying from it, are in `docs/agents/architecture-guards.md`.

**Mutation-test every guard before trusting it.** A green suite proves nothing
until you have watched it go red. This caught a false pass in six separate units
of the simplification programme — including one guard that could not fail at all.
Commit before you mutate, so `git checkout <file>` takes back the mutation and
nothing else. Then write each check into the commit body as
`Mutation-checked: <what you broke> went red`, because a mutation leaves no
diff and the reviewer reads only the diff and the log.

## Conventions

- Python: mypy `strict`, `ty check`, ruff (isort, bugbear, no `print` — `T201`). Alembic dir excluded from lint/type-check.
- TS/React: biome, **no semicolons, double quotes**.
- **CI runs again** since 2026-09-05, when publishing the repo ended a billing block that had failed every job from 2026-07-30. Still run lint and tests locally before pushing: CI is now a second opinion, not the first one.
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

Single-context: `CONTEXT.md` at the root, ADRs in `docs/adr/`, the locked `DECISIONS.md` in `docs/migration/`. See `docs/agents/domain.md`.
