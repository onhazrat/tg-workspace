# #15 ⬆️ Upgrade Python to 3.14

**State:** merged 2026-07-25 · **Branch:** `pr1/python-314` into `main` · **Diff:** +42 / -1216 across 20 files · **Opened:** 2026-07-25

---

Matches the upstream template's move to 3.14 ([`14728b63`](https://github.com/fastapi/full-stack-fastapi-template/commit/14728b636cab02f0ce7633c134b5d28855ba2ac7)).

This is PR 1 of a 7-PR sequence bringing the project to the state it would be in if generated from today's template. Each PR is a clean revert point.

## Why

We were pinned to **3.10** in CI and Docker, while the local `.venv` had silently resolved to **3.12.10** and the machine's `python3` is **3.14.6** — three versions in play, with no `.python-version` to anchor any of them. This closes that.

## Changes

| File | Change |
|---|---|
| `backend/pyproject.toml` | `requires-python = ">=3.14,<4.0"`, ruff `target-version = "py314"` |
| `.python-version` | **new**, `3.14` |
| `backend/Dockerfile` | `FROM python:3.14` |
| `.github/workflows/{test-backend,pre-commit,playwright}.yml` | `python-version: 3.14` |
| `backend/pyproject.toml` | `apscheduler` → `>=3.11.3,<4.0.0` |
| `uv.lock` | relocked |

`apscheduler` is tightened because 4.x is a full rewrite and an unbounded `>=3.10.0` floor is a resolver hazard on a fresh 3.14 resolution.

Relocking dropped the `exceptiongroup` and `tomli` backports and collapsed the multi-version resolution markers.

## Ruff `py314` autofixes

17 findings, applied. Most of them **converge template-derived files onto upstream's current state**:

- `datetime.timezone.utc` → `UTC` in `core/security.py`, `utils.py`, `models.py`
- `typing_extensions.Self` → `typing.Self` in `core/config.py`
- `Generator[Session, None, None]` → `Generator[Session]` in `api/deps.py`

`models.py` now matches upstream master byte-for-byte apart from the `UserUpdate`/`ItemUpdate` refactor, which lands in PR 3. The deliberate auth status-code divergence in `deps.py` (403→401, 404→401, 400→403) is untouched.

Two functions moved to PEP 695 generics (`services/async_db.py`, `services/logs.py`); their now-dead `TypeVar` declarations are removed.

### One change worth a reviewer's eye

`models.py` now has `items: list[Item]` **unquoted**, with `Item` defined later in the file. This matches upstream, and resolves under **PEP 649** deferred annotations, which 3.14 enables by default. Verified at runtime, not just by the type checkers — `models.py` has no `from __future__ import annotations`, so it is one of only two PEP 649-exposed modules in the codebase.

## Verification

CI test workflows are billing-blocked and never run, so everything below was checked locally.

- `mypy` strict, `ty`, `ruff check`, `ruff format --check` — all clean across 99 files
- `pytest` — **500 passed, 1 skipped**
- `docker compose build backend` on `python:3.14` — image runs 3.14.6 and imports `stem`, `langdetect`, `socksio`, `lxml`, `numpy`, `psycopg`

That last one mattered: `stem` is sdist-only and unmaintained since ~2023, so whether it builds on 3.14 was the main open question going in. It builds on both macOS and in the Linux image.

## Not in scope

The 3121 `DeprecationWarning`s are `datetime.utcnow()` at 49 sites. Still deprecated-not-removed in 3.14. Those values land in `TIMESTAMP WITHOUT TIME ZONE` columns, so naive→aware is a data-semantics change needing its own migration decision — tracked separately. Correspondingly, do not add `filterwarnings = ["error"]` before that lands.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
