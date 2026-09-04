# #151 🏷️ Backfill owners before enforcement (ticket 34)

**State:** merged 2026-08-28 · **Branch:** `worktree-ticket-34-backfill-owners` into `main` · **Diff:** +1414 / -8 across 5 files · **Opened:** 2026-08-28

---

Closes ticket 34 (`.scratch/multi-user-tenancy/issues/34-backfill-owners-before-enforcement.md`), one of the two tickets blocking 21.

## Why

Under enforcement a `USER_OWNED` row with no owner is invisible to every account, refused to every by-id reader, and unwritable — and an import is one transaction, so the *first* such row aborts a whole restore. Tickets 31, 32 and 33 each hit this from a different direction and each deferred it rather than widening its own scope.

`backend/scripts/backfill_user_id.py` already existed and was not the answer. Nothing runs it — `prestart.sh` runs only `alembic upgrade head` — and its thirteen models predate `SCOPES`: five are now follow-scoped or corpus whose `user_id` ticket 22 drops, and it misses ten user-owned tables added since. It is kept, because `scripts/cleanup_test_channels.py` shells out to its `--reassign-all` mode.

## What

- **Migration `c0d1e2f3a4b5`** stamps every ownerless row across the 14 user-owned tables with a nullable owner. Owner resolution is byte-for-byte ticket 30's (`FIRST_SUPERUSER`, then the oldest superuser) and an orphan id is treated exactly like NULL, so this cannot disagree with tickets 04, 06, 20 and 30 about who the operator is.
- **`tenancy.owner_backfill_inventory()`** derives that table list from `SCOPES`. The four composite-key tables excuse themselves: `user_id` sits in a `NOT NULL` primary key, so an unowned row cannot be expressed — a stronger excuse than a sentence.
- **`tests/services/test_owner_backfill.py`** — 15 tests, every one mutation-tested to red.

**The migration freezes its own copy of the list and the guard asserts the two agree.** Importing the derivation into `upgrade()` is the obvious alternative and is wrong in both directions: an applied revision must keep meaning what it meant, so reading live app code makes it drift and breaks `upgrade head` from empty the first time somebody renames the function — and a table added *after* the revision ran is not reached by re-deriving anyway. So the derivation lives in the guard, where a forgotten table is a red test instead of a row that vanishes on the flip.

## Three things the ticket did not anticipate

**One table cannot be stamped at all.** `tg_channel_setting_groups` carries a unique index on `(COALESCE(user_id::text,'global'), lower(name))` — the only non-key unique index on any of the fourteen. Every database ever migrated from empty holds global-scope presets, the operator holds identically-named copies, and setting the global rows' owner makes both halves of that key equal. The index refuses it, and because the statements share one transaction the revision fails and `prestart.sh` **stops the deploy**. Those rows are now reconciled one at a time: merged into the operator's same-named group with `tg_channels` *and* `tg_channel_follows` repointed first, or adopted where the operator has no counterpart. Row by row rather than as a set, because two deleted accounts that each had a `default` collide with each other one step further along. `m5n6o7p8q9r0` merged duplicate groups this way before follows existed, so copying it verbatim strands every follow.

Found by `/code-review`, not by the guard — whose seeder invents a unique `name` for every row, so the index was structurally unreachable. It covered the `UPDATE`'s predicate and nothing about what the `UPDATE` had to satisfy. Two tests now name both colliding rows, and a third asserts that index is still the only one of its kind.

**A payload row inherits its parent's owner.** `tg_summary_payloads` and `tg_chat_session_payloads` are reachable only through the row that names them, so adopting them to the operator while the parent belongs to another account leaves a detail view whose body is invisible to the one account that can open it. That mutation passes every test on a single-account database, because there the parent's owner *is* the operator — so the guard seeds a second account, and the mutation now fails exactly one test and no other.

**A fresh install has unowned rows before it has accounts.** The setting-group migrations seed global presets when they find no user. The first cut refused any database with unowned rows and no resolvable operator, which broke `alembic upgrade head` on an empty database and errored the whole suite on its first run. The two no-account cases are now separated: no accounts at all completes and logs what it left; accounts with no resolvable superuser is refused, naming the tables and counts. Nothing is deleted either way.

## Left for ticket 21

Two preconditions this migration cannot close, both written into its docstring:

- **The columns stay nullable**, so new unowned rows keep appearing — every log `upsert_*` takes `user_id` as optional and the scheduler creates `SyncJob` rows with none. `NOT NULL` would trade a data gap for an outage.
- **A fresh install keeps its global presets.** An earlier draft claimed nothing could reference them; review showed that is false — `channels.py` and `followed_channels.py` both call `ensure_default_group` with an optional `user_id`, and auto-follow passes `user_id or channel.user_id`.

Both reduce to one requirement: ticket 21 has to eliminate the `user_id=None` creation paths before flipping the flag, not merely flip it.

## Two consequences, stated rather than discovered

Stamping a log row moves it from the deployment's `sharedLogRetentionDays` sweep to its owner's `logRetentionDays` sweep. Both default to 30, so it is neutral out of the box; an operator who disabled the personal window gets rows retained from now on. And this is one unbatched transaction that rewrites every row it touches — batching would shorten the lock and give up atomicity, which is the wrong trade for a migration whose partial application is the half-owned state ticket 21 cannot flip on.

## Verification

- `1877 passed, 2 skipped` — full backend suite.
- `mypy app`, `ty check app`, `ruff check`, `ruff format --check` clean; all pre-commit hooks passed. The new test file is mypy-clean too, routed through the `mapped_table` helper this ticket adds.
- Nine mutations watched to fail, each hitting the test its docstring names — including the naive stamp, which reproduces the real `UniqueViolation` and fails only the new test.
- Every test passes **on its own**, which two originally did not: they relied on an earlier test truncating the seeded presets first.
- On the dev database the migration stamps **0** rows, so it is a fast no-op on a deployment that is already consistent.

Also corrects two stale claims in `CLAUDE.md` that the ticket manager flagged: the backfill is this ticket rather than 21, and ticket 35's fix no longer reads as already shipped one clause after the sentence warning against exactly that.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01GDXDdkcWtQ1LEo7EHfaK2k
