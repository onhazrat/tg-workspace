# 04: Follow table, backfill, dual-write

**What to build:** Every existing Channel gains a Follow row owned by the current superuser, and every path that creates a Channel now also writes a Follow. Nothing reads Follows yet, so behaviour is unchanged.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] The Follow table exists with a composite natural key, cascading keys both sides, and an index for the follower-lookup direction
- [x] It carries the per-User fields currently on the Channel, plus its own next-sync field
- [x] A dry-runnable, idempotent backfill creates one Follow per existing Channel
- [x] A read-only audit reports null and orphan owners, Channels with no Follow, and unowned settings
- [x] All Channel-creation paths write a Follow

## Comments

**Delivered.** `tg_channel_follows` exists with composite PK `(user_id,
channel_id)`, both foreign keys `ON DELETE CASCADE`, and `ix_..._channel_id`
for the "who follows this channel" direction the PK's leading column cannot
serve. It carries the seven per-User columns from `Channel` plus its own
`next_sync_at`. Migration `c1d2e3f4a5b6`, DDL only.

`app/services/follows.py` is the aggregate and the sole writer. The backfill
(`scripts/backfill_channel_follows.py`) is dry-runnable, batched, and idempotent
by construction rather than by a flag; the audit (`scripts/audit_tenancy_drift.py`)
is read-only and reports null owners, orphan owners, Channels with no Follow, and
unowned settings. Both were exercised end to end against a seeded database:
dry run wrote nothing, the real run created five, the second run created zero
and reported five already present, and `channels_with_no_follow` went 5 → 0.

Four things came out differently from the plan.

- **An ownerless Channel's follow goes to the operator.** `Channel.user_id` is
  nullable and `ChannelFollow.user_id` is not — it is a real FK, which is the
  point of the table. Writing no follow would manufacture exactly the drift the
  audit hunts for, so `resolve_follow_owner` applies the backfill's rule in one
  place instead of as a conditional at three call sites.
- **The seam's follow-scoped branch is written now.** Ticket 03 left it raising
  `NotImplementedError` naming this ticket as the blocker. Landing the table
  without the branch would have left a raise whose stated reason was false, so
  it is now the real EXISTS. It changes nothing while `TENANCY_ENFORCED` is off.
- **`ensure_follow` reports via RETURNING, not `rowcount`.** The obvious version
  is wrong twice over: SQLModel's `session.exec` wraps the result so `rowcount`
  stops meaning rows affected, and it reported a row inserted for a conflict
  that inserted nothing. Found because the idempotence test failed on
  `(True, True)`.
- **The FK fallout I expected did not happen.** The suite fabricates
  `uuid.uuid4()` owners freely, which the unconstrained `Channel.user_id`
  tolerates and this table does not. Zero tests broke: the fixtures insert
  Channels directly, and the routes that go through the creation path always
  carry a real `CurrentUser`.

### Guards

`tests/services/test_channel_creation_paths.py` walks the AST of `app/` and
`scripts/` for every module constructing a `Channel` and requires each to be
declared with a reason **and** to call a follow writer — the second half is what
makes it about behaviour rather than bookkeeping. It also asserts the follow
table has one writer, and that the writer names it declares actually exist, so a
rename cannot leave it passing blind.

Nine mutations were watched go red. Two of them found real holes rather than
confirming the guard: `test_enabled_follow_scoped_joins_on_the_declared_key`
matched the SELECT column list rather than the predicate, so correlating the
EXISTS on the model's own primary key passed — it could not fail at all. Its
sibling had the same defect and was caught first. Both now split on `WHERE`.

One mutation was mine and invalid: hard-coding the join key to `channel_name`
with a fallback to `id` is *semantically identical* to reading `FOLLOW_KEYS`,
because that is exactly what the dict says. Re-run against a genuinely wrong
key, it failed as it should.

### Review round

A `/code-review high` pass found five issues. All five were real and are fixed.

**The follow EXISTS joined two columns nothing keeps equal — the serious one.**
`ChannelFollow.channel_id` is a foreign key to `Channel.id`; `Post.channel_name`
holds `Channel.name`. I had assumed those were the same value. They are not:
`name` is writable through `PUT /data/channels/{id}` (`apply_channel_fields`
excludes only `id`, `user_id`, `setting_group_id`) and `_import_channels` sets
the two from separate fields. The query compiled, ran, and would have returned
**nothing at all** for every renamed channel the moment ticket 21 flipped the
flag — no posts, embeddings, translations or sync state for a channel its owner
follows. It now joins through `tg_channels` and compares name to name.

The lesson is sharper than the bug. All 54 assertions in `test_tenancy_seam.py`
inspect compiled SQL, and every one of them stayed green with the wrong join in
place, because the join was syntactically correct and semantically wrong. That
file is deliberately database-free — "a scoping rule you need a fixture to check
is one nobody checks" — and that property has a cost this found: it cannot see
what the columns *contain*. The regression test therefore uses real rows and
lives in `test_follows.py`, and was watched to fail against the old query.

**A second follower of an existing channel got no follow.**
`create_followed_channel` returns early when the handle exists, so the follow was
written only on the create branch. The AST guard passed anyway — the module does
call a follow writer, just on the other branch, which is a good illustration of
what a structural guard can and cannot promise. Bulk-follow and auto-follow of an
already-scraped channel now write the relation, which is the whole point of the
shared corpus (user story 18).

**Three smaller ones.** The backfill repeated a weaker version of
`resolve_follow_owner` and so probed a key that could never exist for an
orphan-owned channel, while reporting a number that under-counted exactly the
rows the audit flags; it now calls the aggregate, and `ownerless` became
`reassigned_to_operator`, which is what the count means. The one-writer guard
matched only constructor position, so `pg_insert(ChannelFollow)` — the aggregate's
own idiom, and the one a second writer would copy — was invisible to it; widening
it to any mention of the name immediately caught both scripts reading the table
directly, and they now go through the aggregate. And the table counts in
`tenancy.py` and `CLAUDE.md` were left at 18/25 rather than 19/26.

Fourteen mutations were watched go red across the ticket. Three of them found
real holes rather than confirming a guard, and one of my own mutations was
invalid — hard-coding the join key to `channel_name` with a fallback to `id` is
*semantically identical* to reading `FOLLOW_KEYS`, so its passing proved nothing
either way.

**One thing the review reported that was not a code defect.** It saw
`ForeignKeyViolation`, a TRUNCATE deadlock and an empty
`channel_ids_without_follows` while running the suite; so did I, as 24 failures
in one full run that did not reproduce. Every affected file passed in isolation.
Another pytest process was running against the same `app_test` database
concurrently — the shared-test-database hazard this repo has hit before.
