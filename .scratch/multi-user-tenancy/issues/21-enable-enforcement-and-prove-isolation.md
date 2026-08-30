# 21: Enable enforcement and prove isolation (integrate)

**What to build:** Two real accounts genuinely cannot see each other. This is the acceptance gate for the whole tenancy programme.

**Blocked by:** none — 15, 16, 17, 18, 19, 20, 30, 32, 34 and 35 are all done as of 2026-08-29 (`258b7b9`). **This ticket is at the front of the queue**, and it gates 22, 26, 28 and 29.

**Status:** in-progress

## The checkbox list was rewritten before starting, and here is why

The list below replaces the seven boxes this ticket was filed with. Those seven
described a flag flip and an isolation proof; they did not name the larger half,
which tickets 34 and 35 each handed here and neither did. All five preconditions
those tickets left reduce to one sentence: **eliminate the `user_id=None`
creation paths before flipping the flag.** Ticket 34 backfilled the rows that
existed and deliberately left the columns nullable, so the paths that produced
them are still producing them.

Two producers were found by the audit that none of the five notes name, and both
are worse than the ones that were named:

* **`services/embeddings.py:181` and `:195` construct `EmbeddingLog(...)` with no
  `user_id` argument at all.** Not an edge case and not conditional on resolving
  an operator: every scheduler tick and every `POST /rag/embed` writes an
  unowned row, and the route path has `current_user.id` in hand and discards it
  before constructing it. A 100% NULL producer.
* **`jobs/auto_summary.py::_regenerate_one` refills the population it inherits.**
  `run_auto_summary` selects `Summary.user_id IS NULL` rows on purpose, and
  regenerates each into a **brand new** Summary carrying `user_id=None`, with its
  `SummaryPayload` and its LLM and publish logs stamped the same way. So the
  unowned set does not shrink as ticket 34's backfill implied; it is topped up
  every tick.

The busiest of the named ones is `sync_orchestrator._save_network_telemetry`,
which writes a `NetworkLog` on **every scraped page of every sync** carrying the
sync walk's nullable `user_id`.

Recorded here rather than in a commit message because the next person inherits
this ticket the way this ticket inherited tickets 34 and 35.

## How it ships: four PRs, and the flag flips last

Decided with the user before starting. Each lands on `main` and on staging before
the next begins, so the flip happens onto ground that is already clean and a
staging problem is bisectable to one of four changes rather than to a single
diff touching migrations, the scheduler and 130 test call sites at once.

1. **Close the `user_id=None` producers.** No behaviour change on a
   single-account deployment.
2. **Delete `operator.py`, and restructure the three scheduler jobs.** The
   behaviour change.
3. **`NOT NULL` and real cascading foreign keys** on the fourteen tables.
4. **The isolation guard, and `TENANCY_ENFORCED = True`.**

## PR 1 — close the creation paths

- [ ] The four log `upsert_*` take a required, non-optional `user_id`
- [ ] `EmbeddingLog` is stamped at both `embeddings.py` call sites, with the id the caller already holds
- [ ] `create_job`'s `user_id` is required, and no call site spells `str(x) if x else None`
- [ ] The six `ChannelSettingGroup` constructors take a required, non-optional `user_id`, and the `user_id or channel.user_id` fallbacks are gone
- [ ] `_regenerate_one` cannot mint an unowned Summary, payload, or log
- [ ] The sync `user_id` chain carries a real account from the queue message to `_save_network_telemetry`
- [ ] `scripts/audit_tenancy_drift.py` derives its owner tables from `owner_backfill_inventory()`, so it stops reporting ticket 19's deliberately ownerless sync logs as drift — 5,880 false findings on the dev database today, and `--strict` exits 1 on them
- [ ] A guard proves no `USER_OWNED` row can be created without an owner, walked from the AST rather than listed

## PR 2 — delete the single-operator helper

- [ ] `services/operator.py` is deleted, along with its local-dev "no scoped channels, use all channels" fallback
- [ ] The dozen call sites that already hold a real `current_user.id` go through `scoped_select`; the `or get_operator_user_id(session)` fallback goes with them, unreachable behind `CurrentUser`
- [ ] RAG's vector search takes the seam: `channel_names_for_operator` feeds an `IN` on `PostEmbedding.channel_name`, which is what `scoped_select` answers for a follow-scoped model
- [ ] `run_auto_sync` loops per owner — each account's due set computed from **its own follow's** setting group, one job per account, enqueued per account. Ticket 11's per-channel claim coalesces a channel two accounts both follow, so it is scraped once and charged once
- [ ] `run_auto_summary` iterates due Summaries and regenerates each as its own owner, with no operator anywhere
- [ ] `run_translation_batch` selects over the channels **anyone** follows, because a translation is corpus that serves every follower
- [ ] `resolve_follow_owner` survives, and keeps a home for the bootstrap lookup. It answers a different question from `operator.py` — which owner to stamp on a new FK-constrained row when the caller named none — and four migrations document parity with its rule
- [ ] `tests/api/test_tenancy.py::test_auto_sync_scopes_to_operator_channels` is **inverted**, not deleted

## PR 3 — the columns stop permitting it

- [ ] Owner columns are `NOT NULL` with real cascading foreign keys, added without exclusive locks on large tables
- [ ] The residual global setting-group presets are stamped or reconciled first. `tg_channel_setting_groups` carries the only non-key unique index of the fourteen — `(COALESCE(user_id::text, 'global'), lower(name))` — and a naive `SET user_id = <operator>` raises `UniqueViolation` inside `alembic upgrade head`, which under `prestart.sh`'s `set -e` stops the deploy rather than degrading
- [ ] The guard exercises the **constraint**, not only the statement's predicate. Ticket 34's guard could not have caught its own bug, because its seeder invented a unique name per row and made the index structurally unreachable

## PR 4 — the flip

- [ ] An isolation guard parametrised over the whole mounted route inventory — 135 operations off `app.openapi()`, the `test_route_inventory.py` pattern — where each route either carries an isolation assertion or is excused with a written reason, so a route nobody classified fails
- [ ] Another account's row answers 404 on read, update and delete, with that family's own detail string
- [ ] Deleting an account cascades its rows while shared Channels and Posts survive
- [ ] `test_tenancy_seam.py::test_the_flag_ships_off` is **inverted**, not deleted
- [ ] The suite is green with enforcement both off and on

### What "green with enforcement on" costs, measured rather than guessed

`TENANCY_ENFORCED=true` against `258b7b9` today: **159 failed, 1753 passed.**

The largest single cause is `tests/utils/tenancy.py::ANY_READER`, a deliberately
fake uuid — its own docstring says "not a real account" — used **113 times across
13 files**. Those tests seed bare `Post` rows with no Channel and no Follow, so
every scoped read through them returns nothing the moment the flag flips.
Decided with the user: `ANY_READER` becomes a **real seeded account** and the
helpers give it a Channel and a ChannelFollow for the channels each test names,
so those reads run the EXISTS branch for real in both flag states. Pinning the
flag off for those files was the cheap alternative and was refused, because it
would make "green with enforcement on" skip thirteen files' worth of read paths
— the shape of a deliberate exception nothing checks.

## Note added by ticket 16

**30 is a real blocker, not a nice-to-have.** `tg_discover_ignored` is keyed by
`handle` alone, so dismissals are deployment-wide. While the flag is off that is
invisible; the moment it flips, `isIgnored` on every account's Discover
candidates and saved reports reflects everyone's dismissals — the same
cross-account leak this programme closed for `isFollowed`. Ticket 16 left it
deliberately rather than half-scoping it, because scoping only the read makes a
handle permanently undismissable by a second account. See ticket 30 for the full
argument.

Also from ticket 16, for what is now PR 2's first three boxes:
`services/operator.py`'s
`select_operator_channels` (the `Channel.user_id == operator OR NULL` filter) is
still live and still reached by `routes/rag.py` via
`channels.channel_names_for_operator`. Ticket 16 did not convert it, because it
is shared with the scheduler and sync paths; deleting it here means giving RAG's
vector search the seam instead.

## Note added by ticket 34 — three preconditions, not trivia

Ticket 34 backfilled every ownerless row the fourteen `USER_OWNED` tables held
(migration `c0d1e2f3a4b5`, inventory derived from `SCOPES` via
`tenancy.owner_backfill_inventory()`). It settles the rows that **existed**. Three
things it deliberately did not settle land on this ticket.

**The columns stay nullable, so unowned rows keep appearing.** Every log
`upsert_*` takes `user_id` as an optional argument and the scheduler creates
`SyncJob` rows carrying none. A backfill is a one-time act against a schema that
still permits the thing it corrected — so "34 is done" does not mean the tables
are clean at the moment this ticket flips the flag. Either the creation paths
stop producing them or enforcement has to answer for them.

**A fresh install keeps its global setting-group presets, and they are still
reachable.** With no account in existence there is nothing to adopt them to, and
alembic never re-runs the revision, so those rows persist with `user_id IS NULL`.
Ticket 34's first draft claimed nothing could reference them and **that was
wrong**: `ensure_default_group(session, *, user_id: uuid.UUID | None)` is called
from both `channels.py:408` and `followed_channels.py:107`, and the auto-follow
path passes `user_id or channel.user_id`, which is `None` whenever the Channel is
itself unowned. Verified on `main` while recording this note.

So this ticket has to **eliminate the `user_id=None` creation paths before
flipping the flag**, not merely flip it. That is scope this ticket's checkboxes
do not currently name.

**`tg_channel_setting_groups` cannot be stamped naively, and that generalises.**
It carries a unique index on `(COALESCE(user_id::text, 'global'), lower(name))` —
the only non-key unique index on any of the fourteen tables — so the obvious
`SET user_id = <operator> WHERE user_id IS NULL` raises `UniqueViolation` the
moment an operator already owns a same-named group. Inside `alembic upgrade head`
that aborts the migration, and because `prestart.sh` runs under `set -e` with
backend and worker both gated on `service_completed_successfully`, it stops the
deploy rather than degrading. Ticket 34 merges those rows into the operator's
same-named group with `tg_channels` and `tg_channel_follows` repointed first
(`_reconcile_setting_groups`).

`/code-review` caught that **after** a green suite and an open PR. Ticket 34's own
guard could not have: its seeder invents a unique name per row, so the index was
structurally unreachable from the test. Carry the lesson into tickets 35 and 22 —
**a guard that exercises a statement's predicate says nothing about the
constraints that statement has to satisfy.** Both of those tickets touch this same
table.


## Note added by ticket 35 — two more preconditions, same requirement

Ticket 35 closed the last unscoped `USER_OWNED` reads and pinned two more
ownerless-row cases **as tests** rather than leaving them to be found:

- **Ownerless setting groups.** A fresh install migrates before its first
  superuser exists, so ticket 34's backfill could not adopt the three seeded
  global presets and deliberately left them. Under enforcement they belong to
  nobody and are visible to nobody.
- **Ownerless `SyncJob` rows.** The scheduler still creates them with no owner,
  so `activeSyncJob` reports nothing for an auto-sync once the flag flips.

## The five preconditions are one requirement, and the checkboxes do not say it

Counting ticket 34's three and ticket 35's two, every precondition handed to this
ticket reduces to the same sentence: **eliminate the `user_id=None` creation
paths before flipping the flag.** Not settle the rows that exist — ticket 34 did
that, and the columns stayed nullable, so the paths that produced them are still
producing them.

This ticket's checkboxes describe a flag flip and an isolation proof. They do not
name that work, and it is the larger half. Whoever picks this up should expect to
rewrite the checkbox list before starting, not after.

The paths to close, gathered from the five notes:

- every log `upsert_*`, which takes `user_id` as optional
- `SyncJob` creation in the scheduler
- `ensure_default_group(session, *, user_id: uuid.UUID | None)`, reached from
  `channels.py` and `followed_channels.py`, with auto-follow passing
  `user_id or channel.user_id`
- whatever the audit turns up that these five notes did not, since each of the
  five was found by a ticket doing something else
