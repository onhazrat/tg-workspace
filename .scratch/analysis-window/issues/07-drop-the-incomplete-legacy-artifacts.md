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
- [ ] Any superseded per-kind scope representation is removed, so two stored Scope values can never diverge.
- [ ] The upgrade is tested from the previous schema and from an empty database.
- [ ] Downgrade behaviour is explicit and does not claim to restore deleted user data.
- [ ] The deployment's existing test-cleanup and table inventories still pass after the schema change.

## Decide this before running the migration

AW-05 left one Summary creation path off the frozen-Scope contract:
`AIContext.generateBackgroundSummary`, the browser-side twin of
`auto_summary._regenerate_one`, still creates its successor through `PUT` and so
writes `scope = NULL`. As it stands this migration would therefore delete the
regenerations that happened to run with a tab open and keep the ones that ran in
the worker — the same chain, pruned by which process was awake. That is not a
legacy-data question and it is not what this ticket is for. AW-05'''s notes hold
the three options and why none of them belonged in that ticket.

## Notes

This destructive policy is acceptable only because the deployment has not
launched and the existing Accounts belong to the product team. ADR-018 records
that reasoning; do not generalise it to post-launch data.
