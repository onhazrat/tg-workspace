# AW-07: Drop the incomplete legacy Artifacts

**What to build:** A pre-launch migration that removes Artifacts which cannot
supply the complete frozen Scope, rather than displaying them as if their missing
filters were known.

**Blocked by:** AW-06

**Status:** done

## The rule this ticket makes true

Nothing in History claims a Scope it does not have. An incomplete snapshot is not
backfilled with invented defaults, because a guessed filter is a lie about which
Posts produced a result.

## Why this is its own ticket

It is the one irreversible step in the effort. It is deliberately separated from
the three write-path rewrites in AW-06 so it gets reviewed on its own terms.

## Acceptance criteria

- [x] The migration deletes Artifact rows of every kind that cannot provide the complete frozen Scope.
- [x] No deleted row is backfilled with a default, and no missing filter is inferred.
- [x] Any superseded per-kind scope representation is removed, so two stored Scope values can never diverge — the inventory is AW-06's table.
- [x] `DiscoverReport._scope`'s legacy reconstruction branch goes with the columns it reads, so nothing is left able to invent a Scope for a row that has none.
- [x] The upgrade is tested from the previous schema and from an empty database.
- [x] Downgrade behaviour is explicit and does not claim to restore deleted user data.
- [x] The deployment's existing test-cleanup and table inventories still pass after the schema change.

## The decision this was waiting on, and its answer

AW-05 left one Summary creation path off the frozen-Scope contract:
`AIContext.generateBackgroundSummary` created its successor through `PUT` and so
wrote `scope = NULL`. As it stood this migration would have deleted the
regenerations that happened to run with a tab open and kept the ones that ran in
the worker — the same chain, pruned by which process was awake.

**AW-06 closed it.** A submission may now name the Artifact its Scope is derived
from (`derivedFrom` on `SummarySubmitRequest`) instead of describing one, which
is what let the browser join the contract: a derived end is in the future and no
caller is allowed to *state* such a window, so the server derives it through the
one `services/summaries.py::derived_scope` that `jobs/auto_summary.py` also
calls. Both regeneration paths go through it, the shifting one as `successor`
and the Regenerate button as `repeat`.

So every Summary creation path now writes a complete Scope, and this migration's
deletions are about age rather than about which process was awake. What it
deletes is what genuinely predates the contract.

## What to remove

AW-06's "Identified for removal in AW-07" table is the inventory. It covers the
`channels` / `start_date` / `end_date` trio on all four tables, the seven
duplicated filter columns on `tg_discover_reports`, and the superseded
`startDate` / `endDate` fields on the response models. `signals` is explicitly
**not** on it.

## Notes

This destructive policy is acceptable only because the deployment has not
launched and the existing Accounts belong to the product team. ADR-018 records
that reasoning; do not generalise it to post-launch data.

## What landed

`c9e4a8b71d25` deletes every row of the four Artifact tables whose `scope` is
NULL — with its payload row first, because `tg_summary_payloads` and
`tg_chat_session_payloads` carry no foreign key to their parent and nothing
cascades — and then drops the thirteen columns AW-06's table listed. Discover is
deleted on the same terms as the three families that could not have been
backfilled, which is the point: it is the one that *could* have been, and a rule
with one silent exception is not a rule.

**`tg_discover_reports.scope` became NOT NULL, and the other three did not.**
That asymmetry is the contract each family actually has.
`DiscoverReportScopeResponse` is required rather than nullable — the scope card
renders it unconditionally — so a report with no Scope is a 500, not a row that
reads as "no Scope recorded". The other three answer `scope: null` honestly, so
their legacy `PUT` create doors can stay open and did. `POST /data/import`
refuses a report document carrying no `scope` with a 422 that names the section,
**after** the ownership check, so a foreign row still answers 404 whatever shape
its document is in.

Three reads had to move rather than merely stop:

* `summaries.derived_scope` read the predecessor's `start_date`/`end_date` and
  now reads its frozen Scope, refusing with a 422 when there is none. A chain
  older than AW-05 used to gain a Scope from its next run; there is no such
  chain left, so inventing boundaries a whole successor chain then inherits is
  the only thing that refusal prevents.
* `jobs/auto_summary._is_due` did the same arithmetic on the same columns. A
  Summary with no Scope is simply never due — the same refusal one layer up,
  made where the scheduler skips it instead of failing it every tick.
* Both search paths and the History union's discovery title read `channels` and
  `keyword` as columns. They read one key of the `scope` JSON now
  (`artifacts.py::_scope_text`), which matches the same way the old
  `cast(channels, Text)` did.

Frontend: `scopeChannels` / `scopeRange` in `lib/scope/artifact-scope.ts` are
the one place that answers "which channels / what window" for an Artifact, and
they answer `[]` and `null` for one that records no Scope. The regeneration path
in `AIContext` lost its local fallback outright — `submitSummary` with a
`derivedFrom` either returns a Scope or refuses, so a missing one is a bug to
surface rather than a window to guess.

`tests/services/test_legacy_artifact_removal.py` runs the revision itself
through alembic's `Operations` proxy against a restored pre-AW-07 schema, so
what is asserted is the revision file rather than a paraphrase of it. All eight
of its claims were watched red under the mutation each names.

## Not done

The Discover scope card still reads `start`/`end` off the shared `FrozenScope`
rather than rendering the whole value — AW-08 owns display, and this ticket only
moved the two keys whose old spelling it deleted.
