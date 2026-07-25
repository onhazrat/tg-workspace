# Python 3.14 upgrade and template re-sync

**Status:** complete (2026-07-26) · **Shipped as:** PRs #15, #19, #17, #18, #20, #21 + follow-up cleanup

Record of bringing the project to the state it would be in if generated from
today's [`fastapi/full-stack-fastapi-template`][template] — Python 3.14,
upstream dependency floors, upstream tooling, and the substantive template code
changes — while preserving every deliberate divergence.

[template]: https://github.com/fastapi/full-stack-fastapi-template

---

## Why

The project was forked from the template at **`38302d7` (2026-05-29)**. Upstream
moved to Python 3.14 on 2026-06-25 (`14728b63`) and by the time this work
started was **84 commits ahead**.

Meanwhile the repo had **three different Python versions in play**: `3.10`
pinned in CI and `backend/Dockerfile`, `3.12.10` silently resolved into the
local `.venv`, and `3.14.6` as the machine's `python3`. There was no
`.python-version` to anchor any of them.

There was also a hard forcing function: `emails` 0.6 imports the `cgi` module,
**removed in Python 3.13**. Staying on `emails` 0.6 meant staying below 3.13
regardless of anything else.

## What made it tractable

Two findings, established before any code changed, set the difficulty:

1. **Upstream added zero Alembic migrations** across all 84 commits — verified
   via the GitHub compare API and again locally. Our 16 project migrations chain
   cleanly off the template head `fe56fa70289e`. No divergent heads, no merge
   revision. This was the single biggest structural risk and it did not exist.
2. **Upstream touched only 44 files**, and just **5** under `backend/app/`:
   `models.py`, `api/deps.py`, `core/config.py`, `core/security.py`, `utils.py`.
   Four of the five were still byte-identical in our tree, so they could be
   taken wholesale.

Supporting checks: every binary dependency had cp314 wheels (lxml, numpy,
cryptography, psycopg, bcrypt); and PEP 649 was a non-issue because 51 files
under `backend/app/` carry `from __future__ import annotations` (which opts them
out) and `TYPE_CHECKING` appears **zero** times, so the classic mixed-mode
forward-reference hazard cannot arise.

## Phase 0 — the go/no-go gate

Run in a throwaway worktree before committing to the sequence, because a
metadata-only resolution check would not have proven anything: the real question
was whether unmaintained sdist-only dependencies would *build* on 3.14.

| Check | Result |
|---|---|
| No new upstream migrations | confirmed (`backend/app/alembic/` diff empty over 84 commits) |
| `uv` 0.7.5 → 0.9.26 (matching the Dockerfile pin) | clean |
| 3.14 resolution | 101 packages; dropped the `exceptiongroup` / `tomli` backports |
| **`stem` 1.8.2 builds** — sdist-only, unmaintained since ~2023 | **yes**, on macOS *and* in the `python:3.14` Linux image |
| `langdetect`, `socksio` | both import |
| `import app.main` under PEP 649 | clean |
| `AsyncIOScheduler()` at module import time | **no failure** — the suspected 3.12+ `get_event_loop()` hazard did not materialise |
| Full test suite on 3.14, *before* any dependency bumps | **500 passed, 1 skipped** |

No fallbacks were needed for `stem`, `langdetect` or `socksio`. Contingency
plans existed (vendor ~150 lines of the Tor control protocol; swap `langdetect`
for `py3langid`) and went unused.

## The sequence

CI test workflows are billing-blocked and never start, so the only automated
signal is the self-hosted staging deploy. That inverts the usual calculus: a
large PR is not "one review", it is *one undiagnosable staging failure*. The
work was therefore split so each PR is a clean revert point.

| PR | Change | Notes |
|---|---|---|
| [#15] | ⬆️ Python 3.14 | `requires-python`, ruff `target-version`, new `.python-version`, `FROM python:3.14`, 3 workflows; `apscheduler` tightened to `>=3.11.3,<4.0.0` (4.x is a rewrite and an unbounded floor is a resolver hazard) |
| [#19] | ⬆️ Backend deps to upstream floors | starlette 0.46→1.3 (major), pytest 7.4→9.1 (two majors), mypy 1.19→2.3, `emails` 0.6→1.1.2 |
| [#17] | ♻️ Template re-sync | `models.py` from `77be7243`; `[tool.fastapi] entrypoint`; `prek` → root; typos hook; client regenerated **once** |
| [#18] | ⬆️ Frontend dep catch-up | 29 packages |
| [#20] | ⬆️ zod v4 | |
| [#21] | ⬆️ lucide-react v1 | |

[#15]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/15
[#17]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/17
[#18]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/18
[#19]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/19
[#20]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/20
[#21]: https://github.com/onhazrat/tg_summarizer_migrate_to_fastapi/pull/21

Two ordering constraints drove this: 3.14 landed **before** the dependency
floors (3.14 changes the resolution space, so deps-first would mean relocking
twice), and the generated client was regenerated **once, in #17**, after both
FastAPI 0.139 and the `models.py` refactor had settled.

### Follow-up cleanup

- `datetime.utcnow()` removed from all 48 call sites outside `models_tg.py`
- `ty` unpinned to `>=0.0.63`
- duplicate `settings-search-results` test id split (fixed 2 e2e failures)

## Things worth knowing

### PEP 758 is not optional

ruff 0.16 under `target-version = "py314"` **rewrites** `except (A, B):` to
`except A, B:`. The original plan was to keep the parentheses; the formatter
overrules that. Four sites were converted, including `api/deps.py`, which now
matches upstream master exactly.

**Consequence: the backend is syntactically 3.14-only.** It will not parse on
3.13 or earlier. This is intended given `requires-python = ">=3.14"`, but it
means there is no quiet path back.

### `models.py` has an unquoted forward reference

`items: list[Item]` is unquoted with `Item` defined later in the file. This
matches upstream and resolves under PEP 649 deferred annotations, which 3.14
enables by default. `models.py` is one of only two PEP 649-exposed modules in
the codebase, so this was verified at runtime, not just by the type checkers.

### The `utc_now()` helper deliberately returns a *naive* datetime

The `tg_*` tables declare no `timezone=True` columns, so their timestamps are
`TIMESTAMP WITHOUT TIME ZONE`. `utc_now()` is therefore
`datetime.now(UTC).replace(tzinfo=None)` — exactly equivalent to the
`datetime.utcnow()` it replaced, keeping stored values byte-identical.

Returning an aware datetime instead would be a **data-semantics change**
requiring a schema migration and a backfill decision. It was deliberately not
done. The helper carries a docstring saying so; do not "fix" it casually.

This contrasts with the template's `models.py`, which *does* use
`sa_type=DateTime(timezone=True)` and `datetime.now(UTC)`.

### `ty` and mypy disagree about sqlmodel scalar selects

`ty` ≥ 0.0.63 resolves `session.exec(select(Model.col)).all()` to
`Sequence[Sequence[Unknown]]` rather than a sequence of scalars, producing 6
diagnostics that `ty` 0.0.54 and `mypy --strict` both accept.

Neither annotating nor casting resolves it, because the checkers disagree in
opposite directions: mypy already infers correctly and rejects a `cast` as
`redundant-cast` under strict, while `ty` rejects an explicit `Sequence[str]`
annotation as an invalid assignment. Satisfying both would mean paired
`cast` + `type: ignore[redundant-cast]` comments, or disabling
`warn_redundant_casts` globally — degrading the primary type checker to
accommodate a pre-1.0 tool.

The six sites keep their original code and carry a narrow `# ty: ignore[...]`
directive. `ty` reports unused directives, so these will not rot silently:
remove them once its sqlmodel inference improves.

### `emails` 0.6 → 1.1.2 is an API change, not a bump

`emails.Message` → `emails.message.Message`, plus an assert for the `mail_from`
tuple. Upstream's `utils.py` already handled it and we hold that file
near-identical, so the fix came for free.

**Its only consumer is password recovery, which cannot be verified locally.**
Exercise a real recovery email on staging.

## Divergences preserved on purpose

Do not "fix" these back toward upstream:

| File | Divergence | Why |
|---|---|---|
| `backend/app/api/deps.py` | auth codes 403→401, 404→401, 400→403 | deliberate |
| `backend/app/core/config.py` | ~85 appended project settings | project |
| `backend/app/main.py` | lifespan, APScheduler, `APIKeyMiddleware`, 410 legacy guard | project |
| `backend/pyproject.toml` | `httpx[socks]` + explicit `socksio` | Tor SOCKS egress |
| `backend/pyproject.toml` | 9 extra runtime deps, `[[tool.mypy.overrides]]` | project |
| `backend/tests/conftest.py` | `app_test` isolation, `python-dotenv` | test safety |
| `frontend/` | `@vitejs/plugin-react` (not `-swc`); vite **ahead** of upstream | ours is newer |
| `.pre-commit-config.yaml` | `local-ty`, `generate-frontend-sdk` hooks | project |

Upstream's library-skills commit (`8c6e31a8`) is **deliberately skipped**: it
tracks `.claude/skills/`, and our `.claude/` is untracked *and not gitignored*,
so adopting it risks committing `settings.local.json` and `worktrees/`.

## End state

Against upstream master, these are now **byte-identical**: `models.py`,
`crud.py`, `core/security.py`, `routes/{items,login,utils,private}.py`,
`backend/Dockerfile`, `.python-version`, and `backend/scripts/*.sh`.

**17 of 20 shared backend dependencies match upstream exactly.** The three that
differ are intentional: `httpx[socks]`, a *higher* pytest floor
(`>=9.0.3` vs upstream's `>=7.4.3`), and `ty>=0.0.63`. `requires-python` and
ruff's `target-version` match exactly.

Verification at completion — all local, since CI never runs:

- `mypy --strict`, `ty`, `ruff check`, `ruff format --check` — clean, 99 files
- `pytest` — **500 passed, 1 skipped**; warnings down **3122 → 408**
- `bun test src` — **482 passed**; `tsc` and `biome` clean; build succeeds
- Playwright — **83 passed, 0 failed** (`workers=1`, `PLAYWRIGHT_CHANNEL=chrome`)
- `docker compose build backend` on `python:3.14`; container serves `200`

## Known gaps

- **`PrivateService` e2e gap** (pre-existing): `items`, `admin` and
  `user-settings` specs import `tests/utils/privateApi.ts`, but the committed
  client is generated with `ENVIRONMENT=production`, which excludes private
  routes. Unrelated to this work.
- **starlette 1.x deprecates `httpx` with `starlette.testclient`** in favour of
  `httpx2`. Warning only.
- **Unregistered `pytest.mark.security`** — part of the surviving 408 warnings.
- **Password-recovery email** is unverifiable locally; check on staging.

## Reproducing the upstream comparison

`_template_tmp/` is a gitignored clone of the template used for 3-way diffs. It
goes stale — refresh before trusting it:

```bash
git -C _template_tmp fetch origin && git -C _template_tmp checkout -B master origin/master
git -C _template_tmp rev-list --count 38302d7..HEAD          # commits since the fork point
git -C _template_tmp log --oneline 38302d7..HEAD -- backend/app/alembic/versions/
diff backend/app/models.py _template_tmp/backend/app/models.py
```

There is **no `.copier-answers.yml`**, so `copier update` is not available; any
future upstream pull is a manual 3-way merge against this clone.
