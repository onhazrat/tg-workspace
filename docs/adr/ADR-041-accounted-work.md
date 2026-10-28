# ADR-041: Accounted work: one context attributes and pays

**Status:** Accepted (2026-10-28). Extends ADR-035. Came out of an architecture
review grilling. No prototype: the refactor keeps behaviour, and its interface
tests drive the real `fetch_with_retry`.
Spec: `.scratch/accounted-work/spec.md` (prefix `ACW`).

## Context

ADR-035 says a Request's attribution "rides the same `contextvars` as the request
meter". The code has two contexts, and they carry the same facts.

- `core/request_meter.py`'s `metered()` counts the attempts a Budget pays for.
  `services/request_accounting.metered_work` wraps it and runs a charge callable
  on exit. Four places open one: a lane sync message, `run_sync_job`, a bulk
  Follow job and a probe message.
- `core/request_recording.attributed()` names the kind, Account, Budget, Channel
  and job. It opens deeper: inside `sync_single_channel`, or per handle in a bulk
  Follow. Handle checks and Bot API calls open it with no meter at all.
- The charge rule is written twice, side by side in `fetch_with_retry`: the meter
  counts `counts_towards_quota and answered`, and `Page.record` stamps
  `charged = web_view and answered and budget is not None`. They agree because
  every metered block happens to set a Budget, and nothing holds them to it.
- The ledger charges `resolve_charge_owner(user_id)`, which sends a null or
  deleted Account to the Operator. The records keep the raw id. Two read paths
  patch the difference: `request_stats._owner` and `_recorded_charges`.

So each caller states the Account and the Budget twice, in two shapes
(`partial(charge_sync_job, user_id, mode)` and
`attributed(kind=REQUEST_KIND_BY_BUDGET[budget], account_id=..., budget=...)`),
and a Request made between the two blocks would be charged without being
attributed.

## Decision

- **One module, `services/request_accounting.py`, opens Accounted work.** It sets
  the attribution and the tally together. `core/request_meter.py` is deleted, and
  the tally lives beside the attribution in `core/request_recording.py`.
  `attributed()` stays public only to refine an open block: its Channel and
  best-effort. Kind, Account, Budget and job are set in that one module.
- **The caller names the work, not the payer.** The work is one of a closed set of
  values: a sync (Account, sync mode, job), a Follow (Account, job), a probe
  (handle) and uncharged work (Handle check or Bot API call). The payer follows
  from the value: the sync mode's Budget, manual bulk, the probe tally, or
  nothing. `REQUEST_KIND_BY_BUDGET` and the `partial(charge...)` call sites go.
- **One charge rule.** `Page.record` decides whether an attempt is Charged, and
  the tally counts the records it marks so. `record_telegram_request` goes.
- **The paying Account is resolved once, at entry,** and both the records and the
  ledger carry the resolved id. If that read fails, the work proceeds on the raw
  id and the exit charge resolves again, as today: accounting never fails work.
- **One ledger write per Accounted work, on exit,** as decision 19 and RQS-15
  already require. A charge write still swallows its own failure.
- **Accounted work never opens inside other Accounted work.** Opening one inside
  another raises. Production has no such nesting, and either outcome of allowing
  it (charging twice, or charging the wrong Budget) is a silent misbilling.
- **Uncharged work names the Account that asked, as given.** That is the route's
  caller, or `publish_summary_text`'s `acting_user_id` (the View-as target under
  View-as, as everywhere else). It is not resolved, because nobody pays and no
  ledger row is written.
- **The Requests tab shows an Account's Uncharged Requests too.** RQS-05 is
  amended: picking Accounts keeps their Charged Requests and the Uncharged ones
  they asked for, and the Charged filter still separates them. The Accounts
  facet and the comparison still count Charged Requests, because they answer
  who spends. It lands as its own commit after the refactor, so the refactor
  stays behaviour-neutral.
- **`check_request_ledger` stays, as the canary for swallowed charge writes.**
  With one source of truth that is the only mismatch it can find, and its
  docstring and log line say so. `_recorded_charges` drops its per-group
  `resolve_charge_owner` query. `_owner`'s coalesce stays, because daily totals
  are never pruned and keep their null Accounts.

## Alternatives considered

- **One charge rule, two contexts.** Rejected: it fixes the duplicated rule and
  leaves the Account and Budget stated twice, at two depths.
- **Keep the charge callable.** Rejected: a callable cannot be checked against the
  attribution beside it. A work value can't disagree with itself.
- **Write the ledger per page or per Channel.** Rejected: it multiplies ledger
  writes and changes what RQS-15's charge day means, and nothing asked for it.
- **Resolve the Account at exit, as today.** Rejected: records and ledger keep
  naming different Accounts, and every reader keeps patching it.
- **Backfill null Accounts to the Operator in all three tiers.** Rejected: a
  migration over a never-pruned table to save one `coalesce`.
- **Leave it.** Rejected: owners became `NOT NULL` in ticket 21, which made the
  drift rare but not impossible, and the duplication costs every new kind of work.

## Consequences

- A new kind of work is one new work value. The guard is one AST check: kind,
  Account, Budget and job are set only in `request_accounting`.
- Each charge point does one more database read, at entry.
- The Requests tab's numbers do not move in the refactor. The RQS-05 ticket
  changes what an Account filter shows.
- `backend/CLAUDE.md`'s Quota section, which describes `core/request_meter.py`
  and nesting meters, is reworded in the implementing PR.
- The deploy day can raise one spurious ledger-check warning, for records written
  before the deploy on the raw id.
