# #124 🔒 Follow table, backfill, dual-write (ticket 04)

**State:** merged 2026-08-24 · **Branch:** `ticket-04-channel-follows` into `main` · **Diff:** +1784 / -60 across 17 files · **Opened:** 2026-08-24

---

Creates `tg_channel_follows`, the relation between a User and a Channel, and fills it from both directions: a backfill for every Channel that exists, and a dual-write from every path that creates one. **Nothing reads it on a request path yet**, so behaviour is unchanged.

Closes ticket 04. Unblocks 05, 15, 16, 19, 20 — and through 21, everything below it.

## What the table is

The Channel and its Posts are a shared corpus: one scrape serves every follower. The *relation* is not shared, so the per-User columns sitting on `tg_channels` today — setting group, followed-at, tags, start id, start time, discovery provenance — move here, where a second follower of the same handle no longer has to overwrite the first one's values to have any of their own.

Composite PK `(user_id, channel_id)`, both foreign keys `ON DELETE CASCADE`, and `ix_..._channel_id` for the "who follows this channel" direction the PK's leading column cannot serve. `next_sync_at` is on the row from day one although nothing reads it: it is the column the deferred most-eager-wins scheduling needs, and adding it later means a migration on a table with a row per user per channel.

`app/services/follows.py` is the aggregate and the sole writer.

## Four things that came out differently from the plan

- **An ownerless Channel's follow goes to the operator.** `Channel.user_id` is nullable and `ChannelFollow.user_id` is not — it is a real FK, which is the point of the table. The two honest answers to `user_id=None` are "write no follow" and "write one owned by the first superuser", and the first manufactures exactly the drift `audit_tenancy_drift.py` exists to report. `resolve_follow_owner` is that rule in one place rather than a conditional at three call sites.
- **The seam's follow-scoped branch is written now.** Ticket 03 left it raising `NotImplementedError` naming this ticket as its blocker. Landing the table without the branch would leave a raise whose stated reason is false, so it is now the real `EXISTS` — never a filter on `Model.user_id`, since those columns are a "who scraped this first" stamp that ticket 22 drops. It changes nothing while `TENANCY_ENFORCED` is off.
- **`ensure_follow` reports through `RETURNING`, not `rowcount`.** The obvious version is wrong twice over: SQLModel's `session.exec` is built for reads and wraps the result, so `rowcount` stops meaning rows affected — it claimed a row inserted for a conflict that inserted nothing. Found because the idempotence test failed on `(True, True)`.
- **The FK fallout I expected did not happen.** The suite fabricates `uuid.uuid4()` owners freely, which the unconstrained `Channel.user_id` tolerates and this table does not. Zero tests broke: fixtures insert Channels directly, and routes going through the creation path always carry a real `CurrentUser`.

## Guards

`tests/services/test_channel_creation_paths.py` walks the AST of `app/` and `scripts/` for every module constructing a `Channel` and requires each to be declared with a reason **and** to call a follow writer. Declaration alone is bookkeeping; a declared module that quietly stopped writing follows would pass. It also asserts the follow table has one writer, and that the function names it declares still exist, so a rename cannot leave it passing blind.

Nine mutations were watched go red. **Two found real holes rather than confirming the guard:** `test_enabled_follow_scoped_joins_on_the_declared_key` matched the SELECT column list instead of the predicate, so correlating the EXISTS on the model's own primary key passed — it could not fail at all. Its sibling had the same defect and was caught first. Both now split on `WHERE`.

One mutation was mine and invalid: hard-coding the join key to `channel_name` with a fallback to `id` is *semantically identical* to reading `FOLLOW_KEYS`. Re-run against a genuinely wrong key, it failed as it should.

## Verification

- Migration `c1d2e3f4a5b6` applies and reverses cleanly. Autogenerate surfaced a dozen unrelated pre-existing drifts (hand-written partial indexes the models never declared, a TEXT/VARCHAR mismatch on `tg_summaries.prompt_excerpt`); none are carried here — dropping seven live indexes as a side effect of adding a table is how a migration becomes an outage.
- Backfill and audit exercised end to end against a seeded database: dry run wrote nothing, the real run created 5, the second run created 0 and reported 5 already present, `channels_with_no_follow` went 5 → 0.
- Full backend suite: **1241 passed, 2 skipped**. mypy, ty, ruff all clean.

## Operator step after deploy

The migration is DDL only. On staging, after it lands:

```bash
uv run python backend/scripts/audit_tenancy_drift.py            # see the drift
uv run python backend/scripts/backfill_channel_follows.py --dry-run
uv run python backend/scripts/backfill_channel_follows.py
uv run python backend/scripts/audit_tenancy_drift.py            # channels_with_no_follow → 0
```

🤖 Generated with [Claude Code](https://claude.com/claude-code)
