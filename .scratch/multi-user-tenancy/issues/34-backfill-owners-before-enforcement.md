# 34: Backfill owners before enforcement (migrate)

**What to build:** Every user-owned row has a real owner before the flag flips, so
enforcement hides nothing and refuses nothing that a person legitimately owns.

**Blocked by:** None (can start immediately)

**Blocks:** 21

**Status:** ready-for-agent

- [ ] Every `USER_OWNED` table with a nullable `user_id` is backfilled or excused, from an inventory derived from `SCOPES`
- [ ] The backfill is an Alembic migration, not a script somebody has to remember to run
- [ ] It resolves the owner through `resolve_follow_owner`'s rule, so it cannot disagree with tickets 04, 06, 20 and 30
- [ ] It completes in one pass, and says what it did when there is no account to adopt to
- [ ] A guard proves no ownerless `USER_OWNED` row survives it

## Why this is its own ticket

Three tickets reached this requirement independently, from three directions, and
each left it for 21 rather than widening its own scope:

**Ticket 31 — a restore stops restoring.** Under enforcement
`assert_owner_on_write` refuses an `owner_id is None` row, and an import is **one
transaction**, so the *first* ownerless row aborts the whole document. A backup
taken before the stamp existed, or one containing any log row a background job
wrote (`user_id` is nullable on all five log tables and every `upsert_*` takes it
as optional), no longer restores: it answers `"Summary not found"` and nothing
lands. Pinned as `test_an_ownerless_row_is_refused_under_enforcement`, which
encodes the refusal as *intended* — the alternative, letting a write silently
adopt an unowned row, hands ownership to whoever imports first, and the flip is
exactly when that stops being harmless.

**Ticket 32 — an ownerless credential changes visibility.** `user_id` is nullable
on `tg_bot_credentials` and `tg_chat_destinations`. An ownerless legacy
credential is visible today and invisible the moment the flag flips. Ticket 32
pinned that in both flag states rather than papering over it, because the
alternative — matching NULL as "mine" — would hand **every account the
deployment's stored bot token**, and the auto-publish path that sends as that
bot.

**Ticket 33 — a NULL actor is unanswerable.** On the auto-publish path a NULL on
*either* side, the row's owner or the actor's, is permitted while the flag is off
and refused under enforcement. That is deliberately not ticket 32's list rule:
handing out the deployment's credential is a leak, declining to use one is not.
The actor half is not hypothetical — `run_auto_summary` deliberately picks up
ownerless Summaries.

## There is already a script, and it is not the answer

`backend/scripts/backfill_user_id.py` exists and is idempotent. It is not
sufficient, for two reasons:

1. **Nothing runs it.** It is a manual one-off in `backend/scripts/`, so a
   deployment that never ran it flips the flag with ownerless rows in place.
   `prestart.sh` runs `alembic upgrade head` on every deploy; that is the only
   thing guaranteed to have happened before the flag is read.
2. **Its table list predates the seam.** It covers thirteen models chosen before
   `SCOPES` existed, and five of them — `Channel`, `Post`, `PostEmbedding`,
   `PostTranslation`, `SyncLog` — are now `FOLLOW_SCOPED` or corpus, whose
   `user_id` columns ticket 22 *drops*. Meanwhile it misses `USER_OWNED` tables
   added since: `ChannelSettingGroup`, `ChannelFollow`, `SummaryPayload`,
   `ChatSession`, `ChatSessionPayload`, `DiscoverReport`, `TagRun`,
   `UserSetting`, `SyncJob`, `QuotaUsage`.

Derive the inventory from `SCOPES` rather than listing tables, the way
`SHARED_LOG_TYPES` and `IMPORT_WRITES` are derived — a table added later that
nobody remembers to add here is the failure this ticket exists to prevent, and it
would surface as a row that vanishes on the flip.

## One rule for who the owner is

`resolve_follow_owner` (`services/follows.py`) is the existing answer:
`FIRST_SUPERUSER`, then the oldest superuser. Ticket 04's backfill, ticket 06's
settings carve, ticket 20's adoption of legacy Discover reports and ticket 30's
dismissal migration all use it, precisely so they cannot disagree about who the
operator is. A fifth answer here would be the drift
`scripts/audit_tenancy_drift.py` exists to report.

## Complete in one pass

Ticket 06's migration has a no-owner branch claiming "the next deploy finishes
the move". That claim is **false** — alembic stamps a revision and never re-runs
it, so on a database that was accountless at migration time the carve can never
complete. Ticket 20's author found it and deliberately did not repeat it. Do not
repeat it either: either finish, or record loudly that there was nothing to adopt
to. A database with no account at all is the one case where "no owner" is honest,
and ticket 30's migration is the precedent for handling it — it drops rows rather
than leaving them unkeyable, which is safe there because the table is provably
empty before the first superuser exists. That reasoning does **not** transfer to
these tables, so decide deliberately rather than copying.

## Not in scope

Dropping the superseded columns is ticket 22. Flipping the flag is ticket 21.
This ticket only makes the flip survivable.
