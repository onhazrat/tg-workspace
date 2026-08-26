# Splitting retention four ways (ticket 20)

Status: **done**, landed on branch `worktree-ticket-20-split-retention`.

## The problem

Every retention sweep ran on one `retention` settings blob, narrowed by
`user_id == operator OR IS NULL`. That filter looked like scoping and was not.
It protected nobody once a second account existed, and it produced three
distinct defects:

1. `postRetentionDays` was one number any account could write, and it deletes
   every account's Posts on the next sweep. Ticket 18 gated the *write*; the
   number was still shared, so the gate was the only thing standing between a
   new account and table clearing on a timer.
2. `logRetentionDays` was one number too, so whoever saved it last decided how
   long everybody else's evidence survived.
3. Discover reports were pruned across the whole table. The count cap was the
   sharper edge: one account generating fifty reports in an afternoon pushed
   every other account's newest report past the offset and deleted it.

Ticket 19 added a fourth: sync logs became Channel telemetry and stopped being
personal, so they no longer belonged on a per-User window at all.

## The shape

The window follows the scope, which is the rule `services/tenancy.py` already
establishes for reads.

| Rows | Window | Home |
|---|---|---|
| Posts, embeddings, translations, sync state | `postRetentionDays` | global `retention` |
| Sync log bodies (`tg_sync_log_payloads`) | `payloadRetentionDays` | global `retention` |
| Sync logs, network logs, **and any log row with no owner** | `sharedLogRetentionDays` (new) | global `retention` |
| Publish / LLM / embedding logs you own | `logRetentionDays` | per-User `retention_prefs` |
| Your Discover reports | `reportRetentionDays`, `reportRetentionMax` | per-User `retention_prefs` |
| Channels nobody follows | not a window — collected at zero followers | — |
| Orphaned avatars, thumb cache | not a window — garbage by definition | — |

`SHARED_LOG_TYPES` and `PERSONAL_LOG_TYPES` are derived from `tenancy.SCOPES`
and partition the five log families, so a family cannot fall out of both (swept
by nobody) or into both (swept twice, on two windows, ordering deciding which).

## Decisions worth keeping

**`sharedLogRetentionDays` is a new setting rather than a reuse.** The
alternative was sweeping shared and ownerless rows on `payloadRetentionDays`,
which conflates "how long we keep sync bodies" with "how long we keep whole
telemetry rows" — the bodies window is deliberately much shorter. Doing nothing
was the third option and it strands rows: staging holds ~191k sync log rows.

**Ownerless log rows are a standing condition, not legacy.** `user_id` is
nullable on all five log tables and every `upsert_*` takes it as an optional
argument, so a background job writes owner-less rows every day. Adoption would
fix nothing; the deployment window is the standing answer.

**Ownerless Discover reports are adopted once.** Every report written since
ticket 17 carries an owner, so a one-time `UPDATE` in the migration is complete
and permanent. The owner is resolved by the same rule as
`follows.resolve_follow_owner` and the ticket 06 migration
(`FIRST_SUPERUSER`, then the oldest superuser, then leave them for the next
deploy) so the three cannot disagree.

**The endpoint is a facade and the wire shape did not change.**
`GET`/`PUT /data/settings/retention` still carry one blob; `load_retention_settings`
reassembles it and `save_retention_settings` routes each field home. Regenerating
the client changed only docstrings. A non-Admin's PUT succeeds and writes only
the personal half, exactly as `sync` already behaved — refusing outright would
mean nobody but an Admin can say how long to keep their own logs.

**A personal retention field with no owner raises.** `save_sync_settings` drops
one, because the scheduler writes `sync` with no account behind it. Nothing
writes retention without a User, so dropping would only ever mean a window
silently keeping its default while the caller believed it saved. The raise found
four call sites doing exactly that.

**The Admin log purge stopped pretending to scope.** `delete_old_logs` no longer
narrows to the operator; it sweeps every account, which is what its docstring
always claimed and what `DATA_ADMIN` gates it for.

## What this unblocks

Ticket 21 (enable enforcement and prove isolation) was blocked on this and on
ticket 30 (per-account Discover dismissals). Ticket 30 is still open.

## Mutation testing

Every assertion in `tests/jobs/test_retention_split_four_ways.py` was watched to
fail — see its module docstring for the list, including the one exception that
survives its mutation and says so.
