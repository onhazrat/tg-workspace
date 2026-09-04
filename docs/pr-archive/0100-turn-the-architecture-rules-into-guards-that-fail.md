# #100 ✅ Turn the architecture rules into guards that fail

**State:** merged 2026-08-02 · **Branch:** `architecture-guards` into `main` · **Diff:** +591 / -36 across 11 files · **Opened:** 2026-08-02

---

## Why

The simplification programme ended with one clear pattern:

> **Every decision that became a compile error or a failing test survived. Every decision that stayed prose either decayed or was one careless PR from decaying.**

The proof was already in this repo. `CLAUDE.md` has said *"never inline `BaseModel` in a route module"* since B1 — and **three modules were violating it**: `routes/rag.py` twice, `routes/private.py` once. That rule sits in the file every contributor and every AI agent loads at the start of a session. It decayed anyway.

That is not a discipline problem — the same people wrote both the rule and the violations. It is what prose does.

## What this adds

| Guard | Enforces |
|---|---|
| `backend/tests/api/test_route_module_hygiene.py` | no models in route modules; every handler annotates its return |
| `backend/tests/services/test_service_kinds.py` | every service module declares one of H3's five kinds |
| `frontend/src/lib/architecture-invariants.test.ts` | no browser DB; `DataContext` stays small; one theme owner |

**Route hygiene** fixes the three live violations by moving the models to `app/schemas/`, then blocks recurrence. `-> Any` is deliberately allowed (the template's `response_model=` says the same thing); silence is not.

**Service kinds** keeps the inventory *in the test*, so a new module fails until someone decides what it is. Two kinds are then checked mechanically — pure transforms do no I/O, read models never commit. `EXCEPTIONS` carries a written reason each: an exception with a reason is a decision, one without is drift.

**Frontend invariants** protect what A3/A4/G2 bought — the browser-database guard is two cheap assertions against re-importing 2,491 lines and the silent data-loss path A4 fixed (Import DB never reached the server).

## Three corrections found while classifying

Recorded rather than papered over:

- **`stats.py` is not a read model.** `CLAUDE.md` listed it as one; `clear_table` deletes across every aggregate's table and commits. Now a declared exception, and the claim in `CLAUDE.md` is corrected.
- **My own pure-transform check was wrong first.** It banned importing `sqlalchemy`, and flagged `post_filters.py` — which builds `ColumnElement` predicates and executes nothing. The check was wrong, not the module. `Session` is the load-bearing signal, because without one nothing can be executed.
- **`test_schema_aliases.py` sweeps more than it says.** It describes itself as covering response models but walks every `BaseModel` in `app.schemas`. Moving `PrivateUserCreate` there pulled in the template's snake_case `/private` surface — whose only caller (`frontend/tests/utils/privateApi.ts`) posts `full_name` literally, so aliasing would have broken e2e rather than fixed a mismatch. Exempted with the reason; the framing gap noted in place.

## `CLAUDE.md`

Each rule now names the guard that enforces it, and there is a guard index. Rules that are **not** enforced say so — an agent told a rule is unchecked knows to be careful, which is more useful than implying everything is equally safe.

The ADR-006 paragraph is also refreshed: it still described the pre-F2 split ("generated client for the admin shell only"), which stopped being true last PR.

## Mutation-tested

Six mutations, six caught, each with an actionable message:

- new unclassified service module → *"New service module(s) with no declared kind: ['__mutant.py']…"*
- pure transform gains a `Session` → *"channel_tags.py is declared a pure transform but imports ['Session']"*
- read model commits → *"operator.py is declared a read model but commits at line(s) [125]"*
- inline `BaseModel` in a route → *"app/api/routes/rag.py declares SneakyInline (line 29) inline"*
- handler loses its return annotation → *"rag_status (line 49)"*
- `DataContext` regrows a field / `indexedDB` reappears → both named in the diff

A green suite proves nothing until you have watched it go red.

## One thing I could not do

Disabling merge-commit and rebase-merge on the repo — the mechanical form of *"land PRs with squash merge only"* — needs a repo-settings API call that was blocked. **Both are currently enabled.** One toggle each in **Settings → General → Pull Requests**, and the signing rule enforces itself.

Branch protection proper needs GitHub Pro on a private repo, so it is not available either way.

## Verification

- Backend **872 passed / 2 skipped** (`TEST_POSTGRES_DB=app_test_entropy`)
- Frontend **823 pass / 0 fail**
- `tsc` clean, biome clean, mypy strict, ruff, `ty` — all clean
- All pre-commit hooks pass. The client regenerates with **only added descriptions**: moving a Pydantic class between modules does not change its OpenAPI schema name, as claimed.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
