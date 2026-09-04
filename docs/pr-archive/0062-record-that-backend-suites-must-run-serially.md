# #62 📝 Record that backend suites must run serially

**State:** merged 2026-07-31 · **Branch:** `docs-serial-pytest-rule` into `main` · **Diff:** +10 / -0 across 1 files · **Opened:** 2026-07-31

---

Docs only.

While verifying merged `main` I got **two contradictory results for the same commit** — `199 failed / 521 passed / 13 errors` from one run and `733 passed / 1 skipped` from another. They overlapped in time.

`tests/conftest.py` points every run at the single `app_test` database and truncates the `tg_*` tables after each test, so two concurrent pytest runs destroy each other's fixtures. A clean isolated re-run gave **733 passed / 1 skipped** — the 199 failures were entirely self-inflicted.

Worth writing down because at a glance it is **indistinguishable from a real regression**, and the instinct is to start debugging code that is fine. A run killed mid-flight also leaves orphans that make the *next* run **hang** rather than fail, which reads as a different problem again.

Same shared-backend hazard the existing Playwright `--workers=1` rule covers.

Also records that `backend/scripts/lint.sh` invokes `mypy`/`ruff` bare, so it only works with the venv already on `PATH` — use `uv run`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
