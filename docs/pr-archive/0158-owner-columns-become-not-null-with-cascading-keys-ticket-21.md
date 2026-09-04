# #158 🔐 Owner columns become NOT NULL with cascading keys (ticket 21, PR 3)

**State:** merged 2026-08-30 · **Branch:** `ticket-21-non-null-owners` into `main` · **Diff:** +2049 / -366 across 34 files · **Opened:** 2026-08-30

---

Third of four PRs for ticket 21. Stacked on #157.

Fourteen `USER_OWNED` tables get `user_id NOT NULL` and a real `ON DELETE CASCADE` key to `"user"(id)`. Ticket 34 gave every existing row an owner; PR 1 (#156) closed the paths that made new unowned ones. This is what stops them coming back, and it is the last thing between the programme and the flag flip in PR 4.

## The migration

Lock-avoiding on every table: `ADD CONSTRAINT CHECK ... NOT VALID` → `VALIDATE CONSTRAINT` → `SET NOT NULL` (catalogue-only on PG12+) → `DROP CONSTRAINT`, and each foreign key added `NOT VALID` then validated. Neither statement holds `ACCESS EXCLUSIVE` while it scans.

Its table list is **frozen rather than derived**. An applied revision has to keep meaning what it meant, so importing `owner_backfill_inventory()` would break `upgrade head` from empty the first time somebody renames the function — and a table added after the revision ran is not reached by re-deriving anyway. The guard derives the list instead, so a forgotten table is a red test rather than a row that vanishes on the flip.

Three things it has to settle before the constraints can go on:

- **A payload row inherits its parent's owner**, in a pass that runs *before* the operator pass. Invisible on a single-account database, because there the parent's owner is the operator — only a second account separates them, so the guard seeds one.
- **A duplicate setting group is merged** into the operator's same-named group, with `tg_channels` **and `tg_channel_follows`** repointed first. The unique index on `(COALESCE(user_id::text, 'global'), lower(name))` refuses a plain stamp, and because the statements share one transaction the revision — and `prestart.sh`, and the deploy — would stop there.
- **A fresh install drops its three unreferenced global presets** rather than adopting them. `prestart.sh` migrates before `init_db` creates the first superuser, so there is nobody to adopt to; refusing there would break every first deploy.

`owner_backfill_inventory()` had to stop excusing tables by nullability — a criterion that deletes itself the moment this revision runs. It now excuses only a `user_id` that sits inside a primary key, which is the four composite-key tables and stays true afterwards.

## The test suite

Two shared-helper changes fixed 127 failures between them:

- **`ANY_READER` is a real seeded account now.** A fabricated uuid stopped being merely meaningless and started being rejected (118 `ForeignKeyViolation`s), and under PR 4's flag a scoped read for a non-existent account returns nothing — so 113 assertions would have gone green-to-empty and passed for the wrong reason.
- **Both channel-seeding helpers default an absent owner to it**, rather than to NULL. `tests/utils/setting_groups.py::add_test_channel` and `conftest.py::tg_test_channel` are the same helper twice over; fixing one is the half-fix this repo names.

`tests/utils/legacy_owner_schema.py` puts the pre-ticket-21 schema back for the length of one test, so ticket 34's backfill guard can still seed the rows it is *about*. It is a fixture rather than a context manager because it has to commit the session-scoped `db` transaction first — the `ALTER TABLE` otherwise waits for something that outlives the run, which hung the suite for 18 minutes before it was diagnosed through `pg_stat_activity`.

## Fifteen inverted tests

Fifteen tests asserted the behaviour of a row this revision makes impossible — an ownerless credential, group, log, sync job or import target. They are **inverted rather than deleted**, each asserting that the database now refuses the seed, because every one of them was a hazard nobody noticed until it was written down: an invisible credential the deployment silently stops publishing with, a clobbered bot token, a log reachable by no retention window. A later migration that relaxed a constraint should fail here.

Two guards moved for a reason worth recording:

- **The auto-publish attribution guard** used an *ownerless destination* to tell `summary.user_id` from `dest.user_id`. That row shape is gone, so it now uses ticket 33's actual exploit — a Summary belonging to one account naming another account's credential and destination, which `upsert_summary` allows because `publishBotId` is a client-chosen string. Watched failing that mutation in both flag states.
- **The narrow swap** at the `publish_summary_text` call (`acting_user_id=dest.user_id`) is now *equivalent*, because reaching that line means the destination check one branch above just compared those two values. Watched passing, and left that way with the reason written down, so the next reader does not "fix" the guard by moving it off the check that makes it true.

- **`test_a_sync_job_nobody_owns_is_admin_only`** became a pair: the row can no longer be created, and `_visible_job`'s 403 branch is exercised at the function level, where a `SyncJobState` from a pre-revision database can still be built. Both directions, because a gate tested only in its refusing direction is how a door that rejects everybody passes its suite.

## Incidental

`ty` caught the two payload constructors this makes incomplete. Fixing them made PR 1's own AST guard fail on exemptions that no longer applied — the guard doing exactly its job — so `OWNER_SET_AFTER_CONSTRUCTION` is now empty, and empty on purpose.

## Verification

- Full suite: **1915 passed, 2 skipped**, under random ordering.
- `mypy app`, `ty check app`, `ruff check app`, `ruff format app --check`: clean.
- Migration run to `head` on a **fresh** database (drops 3 unreferenced presets; `\d tg_summaries` shows `not null` and `fk_tg_summaries_user_id_user ... ON DELETE CASCADE`) and on a **copy of the real dev database** (146 users, 556 channels), where it and ticket 34's revision agree on the same operator id.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
