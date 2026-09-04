# #127 🔒 Split global and per-user settings (ticket 06)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-06-settings-split` into `main` · **Diff:** +1543 / -138 across 29 files · **Opened:** 2026-08-25

---

Closes ticket 06 of the multi-user tenancy programme (`.scratch/multi-user-tenancy/issues/06-*`).

## What changed

Settings were one table keyed by name alone, with a `user_id` column that recorded whoever wrote the row last. That column was a stamp, not a scope: two accounts could not hold different values for a key, and the last save won.

`tg_app_settings` is now deployment policy (PK `key`); a new `tg_user_settings` holds personal settings (PK `(key, user_id)`, cascading FK). `services/settings_registry.py` classifies every key with a sentence saying why, and the two aggregates each refuse the other's keys.

**The `sync` blob turned out to be three things, so it is three rows.** Scheduler policy stays global under `sync`, the scheduler's own counters move to global `sync_runtime`, and the per-channel defaults a person picks become per-User `sync_prefs`. Every writer used to read-modify-write the whole blob, so saving a start-time preference wrote back whatever counter that browser last read, and the scheduler bumping a counter wrote back stale preferences. Splitting the rows removes that; a permission check would not have, since the last writer would still win.

**No visible change.** `GET`/`PUT /data/settings/sync` keep their exact wire shape — regenerating the client produced zero diff. Runtime fields are *routed, not dropped*: three frontend call sites pause and resume auto-sync by name through this endpoint. Dropping would have been the tidier rule and a silently broken Pause button.

## Verification

- 1290 backend tests pass, 2 skipped, 0 failures
- mypy / ty / ruff / ruff-format clean; frontend typecheck clean; 873 frontend unit tests pass
- **Generated client diff: none** — the carve is invisible on the wire
- New guard `test_settings_table_split.py` **watched to fail eight ways** (misfiled key, orphan sync field, either refusal removed, runtime section dropped, `home_for` guessing, a third writer, facade not reassembling) — all eight went red, then green again
- **Migration run against real data**: legacy `autoSyncInterval` rename, the three-way carve, a downgrade+re-upgrade that preserved *newer* counters rather than clobbering them, and the no-account case that leaves prefs in place for the next deploy
- `audit_tenancy_drift.py` on the dev database after migrating: `settings keys in the wrong table=0`, `settings keys nobody classified=0`, `no drift`

## Notes for review

- The migration is idempotent because `prestart.sh` runs it on every deploy. On a database with no account yet it leaves the preference fields in the `sync` row so the next deploy finishes the move — losing real settings to save one query is the wrong trade.
- `AppSetting` moves to `OUT_OF_SCOPE` in `tenancy.py`: deployment-wide, `key` is the whole primary key, so there is no per-user row for the seam to hide. Who may *write* one is an Admin permission question (ticket 18), the same argument `Role` makes.
- `save_settings_section` keeps the **replace** semantics of the `save_setting` it replaces, not the endpoint's merge — `{}` has to mean "unset", which is how the follow-backfill marker is cleared.
- Two assertions in the new guard exist because a first draft was wrong, and both say so in the file: the original lost-update test claimed a whole-blob write would be filtered (it cannot be — what protects the counters is that the frontend's section payload declares no runtime field), and the file originally ended with a bare `db.exec(...)` that hung the whole suite rather than failing it.

CI test workflows are billing-blocked and will not run; everything above was run locally.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_0113nYmobeNT9LGQP3WMMuxF
