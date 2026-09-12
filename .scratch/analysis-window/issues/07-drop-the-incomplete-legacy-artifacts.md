# AW-07: Drop the incomplete legacy Artifacts

**What to build:** A pre-launch migration that removes Artifacts which cannot
supply the complete frozen Scope, rather than displaying them as if their missing
filters were known.

**Blocked by:** AW-06

**Status:** ready-for-agent

## The rule this ticket makes true

Nothing in History claims a Scope it does not have. An incomplete snapshot is not
backfilled with invented defaults, because a guessed filter is a lie about which
Posts produced a result.

## Why this is its own ticket

It is the one irreversible step in the effort. It is deliberately separated from
the three write-path rewrites in AW-06 so it gets reviewed on its own terms.

## Acceptance criteria

- [ ] The migration deletes Artifact rows of every kind that cannot provide the complete frozen Scope.
- [ ] No deleted row is backfilled with a default, and no missing filter is inferred.
- [ ] Any superseded per-kind scope representation is removed, so two stored Scope values can never diverge — the inventory is AW-06's table.
- [ ] `DiscoverReport._scope`'s legacy reconstruction branch goes with the columns it reads, so nothing is left able to invent a Scope for a row that has none.
- [ ] The upgrade is tested from the previous schema and from an empty database.
- [ ] Downgrade behaviour is explicit and does not claim to restore deleted user data.
- [ ] The deployment's existing test-cleanup and table inventories still pass after the schema change.

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
