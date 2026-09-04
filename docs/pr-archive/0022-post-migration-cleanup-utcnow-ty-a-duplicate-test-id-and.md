# #22 ♻️ Post-migration cleanup: utcnow, ty, a duplicate test id, and the migration doc

**State:** merged 2026-07-25 · **Branch:** `cleanup/utcnow-and-ty` into `main` · **Diff:** +351 / -137 across 31 files · **Opened:** 2026-07-25

---

Closes out the follow-ups deferred during the Python 3.14 upgrade (#15/#19/#17/#18/#20/#21), and records the whole effort in the repo so it outlives the session.

Four independent commits, each revertable on its own.

---

### `7e28d2c` ♻️ Replace deprecated `datetime.utcnow()`

All **48 call sites** outside `models_tg.py` now use the `utc_now()` helper that already lived there as a `Field` default_factory. Every affected file already imported from `app.models_tg`, so this only extends existing imports.

**Test-suite warnings: 3122 → 408.**

The helper's body becomes `datetime.now(UTC).replace(tzinfo=None)`. **Dropping tzinfo is deliberate, not an oversight** — the `tg_*` tables declare no `timezone=True` columns, so these land in `TIMESTAMP WITHOUT TIME ZONE`. Returning an aware datetime would be a *data-semantics* change needing a schema migration and a backfill decision. This keeps stored values byte-identical and removes only the deprecation. The helper carries a docstring so it isn't "fixed" later by mistake.

`test_channel_stats.py` patched `app.services.channels.datetime`; that module no longer imports it, so both sites now patch `utc_now` directly — also simpler. `conftest.py` picks up ruff's `UP043`, which had only ever run over `app/` and `scripts/`.

### `9f7080f` ⬆️ Unpin `ty` (`<0.0.55` → `>=0.0.63`)

Six of the seven diagnostics are **one `ty` inference gap**, not a defect here: it resolves `session.exec(select(Model.col)).all()` to `Sequence[Sequence[Unknown]]` instead of a sequence of scalars.

I tried annotating and casting; **the two checkers disagree in opposite directions** — mypy already infers correctly and rejects a `cast` as `redundant-cast` under strict, while `ty` rejects an explicit `Sequence[str]` annotation as an invalid assignment. Satisfying both means paired `cast` + `type: ignore[redundant-cast]` comments, or disabling `warn_redundant_casts` globally. Degrading the primary type checker to accommodate a pre-1.0 tool is the wrong trade.

So the six sites keep their original code and carry a narrow `# ty: ignore[...]` — ty's own mechanism. It reports unused directives, so they won't rot silently.

The seventh was real: `settings = Settings()` had a blanket `# type: ignore` that ty flagged as unused. mypy *does* still need it (three missing named args), so it's now the specific `# type: ignore[call-arg]`.

### `522e410` 🐛 Give the settings search container its own test id

Fixes the 2 deterministic e2e failures reported on #21. `SettingsHub.tsx`'s scroll container carries a route-derived debug id, but while searching it switched to `settings-search-results` — also the id of the results list inside it. Both matched, so Playwright raised a strict-mode violation.

The container now uses `settings-section-search`, consistent with its own `settings-section-*` pattern. The specs already target the inner list, so **no test changes were needed**.

Pre-existing since `0aa131a`, unrelated to the migration.

### `d7c0550` 📝 Document the upgrade

New `docs/migration/PYTHON-314-TEMPLATE-RESYNC.md`, linked from `docs/README.md` and `docs/migration/README.md`. Captures what a future reader would otherwise have to rediscover:

- why it was tractable (zero upstream migrations across 84 commits; only 5 files touched under `backend/app/`)
- the Phase 0 gate, incl. that `stem` — sdist-only, unmaintained — *does* build on 3.14
- **PEP 758 is not optional**: ruff under `py314` rewrites `except (A, B):`, making the backend syntactically 3.14-only
- why `utc_now()` is naive, and why the `# ty: ignore` directives exist
- the full table of divergences preserved on purpose
- how to refresh `_template_tmp` and diff upstream (there's no `.copier-answers.yml`, so future pulls are manual 3-way merges)

Every factual claim was re-verified against the upstream clone before committing.

---

## Verification

All local — CI is billing-blocked and never runs.

- `mypy --strict`, `ty` **0.0.63**, `ruff check`, `ruff format --check` — clean across 99 files
- `pytest` — **500 passed, 1 skipped**
- `tsc`, `biome`, `bun test src` (**482 passed**) — clean
- Playwright `settings-hub.spec.ts` — **11 passed** (was 9 passed / 2 failed)
- Playwright `summarizer` + `tg-ui-primitives` + `settings-hub` + `login` — **83 passed, 0 failed** (was 81 / 2)

## Still open

- **`PrivateService` e2e gap** (pre-existing): `items`/`admin`/`user-settings` import `tests/utils/privateApi.ts`, but the committed client is generated with `ENVIRONMENT=production`, which excludes private routes.
- **Password-recovery email** can't be verified locally — `emails` 0.6→1.1.2 was an API change. Worth exercising once on staging.
- starlette 1.x deprecates `httpx` with `starlette.testclient` in favour of `httpx2` (warning only), and `pytest.mark.security` is unregistered — both part of the surviving 408 warnings.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
