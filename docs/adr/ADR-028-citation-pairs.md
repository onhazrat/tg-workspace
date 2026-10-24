# ADR-028: Citations are kept as distinct Channel pairs, maintained with the References

**Status:** Accepted (2026-10-04). Builds on [ADR-019](./ADR-019-channel-reference-graph.md),
whose References this summarises, and serves the Directory tab
(`.scratch/directory-tab/`).

## Context

The Directory filter asks per Channel "cited by N Channels" and "cites N Channels", counted in
distinct Citing Channels, never References (a Post that both mentions and links a Channel, or
twenty Posts from one Channel, count once). Its Shared parents and Shared children (DIR-07) ask
which Channels two Channels have in common on either side of a citation.

Both are questions about distinct Channel-to-Channel pairs, and the References table cannot
answer them per request: it holds 3.6M occurrences and grows for good. The prototype answered
them from `proto.degree`, a table built once by hand with a full aggregation, which went stale
the moment it was built.

## Decision

Keep one row per distinct (citing Channel, cited Channel) pair with its Reference count, and
per handle the number of distinct Channels it is cited by and cites. Both are written by
`post_references.write_references`, in the transaction that inserts the References: its
`INSERT ... RETURNING` already yields only the References that were new, so their pairs are
upserted, and a pair that did not exist before raises the cited-by count of its target and the
cites count of its source by one. A first fill builds both from the existing References.

Counts are keyed by handle, not by Directory entry, because a handle is often cited before the
Directory has probed it.

## Considered options

- **Count live from the References.** Correct and stale-free, but a full aggregation over 3.6M
  rows on every request that filters or sorts by it.
- **A scheduled recount every few hours.** Simple, but stale between runs and a full scan each
  time, forever: the scheduler-tick lesson in CLAUDE.md (a scheduled job pays its cost every
  tick).
- **Drop the two Conditions.** Loses the strongest corpus-wide signal the Directory has.

## Consequences

- References are permanent (ADR-019), so pairs and counts only ever grow; nothing has to
  decrement them. If References ever become deletable, this has to change with them.
- The pair table is what Shared parents and Shared children read, so DIR-07 needs no further
  precomputation.
- A guard should assert that the stored counts equal a fresh aggregation over the References,
  the way ADR-015's statistics are guarded.
