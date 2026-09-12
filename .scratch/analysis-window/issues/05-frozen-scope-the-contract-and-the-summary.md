# AW-05: Frozen Scope, the contract and the Summary

**What to build:** One complete, immutable Scope snapshot taken when work is
submitted, proven end to end on Summaries. Submitting sends the whole current
Scope, the server resolves the window against its own current minute and
persists the exact boundaries before any queueing or expensive work, and nothing
afterwards can move them.

**Blocked by:** AW-03

**Status:** done

## The rule this ticket makes true

An Artifact is paid for in Posts, and it records exactly which Posts. Queue
delay, worker start time, retries and network latency cannot change what a
finished Artifact says it used.

## Acceptance criteria

- [x] One validated frozen-Scope value object and one wire representation exist, holding selected Channels, exact Start and End, and every post filter that affected the result.
- [x] The filter set covers keyword, forwarded status, media type, per-Channel cap, cap mode, sort order and the deterministic random seed where applicable.
- [x] Semantic and related-Post paths additionally retain the explicit Post selection needed to reproduce their ranking.
- [x] Consumers send the discriminated Live or Fixed window and do not flatten a Live window into client-resolved boundaries first.
- [x] Summary submission persists the frozen value before queueing; a simulated queue delay does not move the stored boundaries.
- [x] The Summary read model returns that value rather than reconstructing one from a per-kind subset, and derives Duration from the exact boundaries.
- [x] A later content or flag update on a Summary cannot replace its frozen Scope.
- [x] Backend tests inject server time and prove Live resolution at a minute boundary and Fixed validation through the real submission path.
- [x] The generated API client is regenerated.

## What landed

`app/schemas/scope.py` holds the pair: `ScopeSubmission` (what a caller sends,
window included) and `FrozenScope` (what an Artifact records, two exact
instants). Both extend one `_ScopeFilters` base, so a filter added later reaches
the submission and the record together — the completeness guard derives its
claim from the two field sets rather than listing them.

`analysis_window.freeze_scope` is the only thing that turns one into the other,
which is the seam AW-02 left for it. `POST /data/summaries` is the submission:
it resolves the window against the server's current minute, writes the row, and
returns the frozen value, all before a token is spent. Everything downstream
re-states that pair as a Fixed window, which resolves to itself.

Storage is split the way this repository already splits a Summary:
`tg_summaries.scope` carries the filters and the boundaries, and the explicit
Post selection goes to `tg_summary_payloads.scope_posts`, because a few thousand
refs is a corpus and the list projection must not read one. `scopedPostCount`
rides the base row so a list can still say the Scope was restricted.

Immutability is two rules, both of them structural rather than remembered:
`SummaryUpsertRequest` no longer declares `startDate`, `endDate` or `channels`,
and `MUTABLE_SUMMARY_FIELDS` names what a merge may still set. That emptied
`FROZEN_ARTIFACT_WRITES` in `test_analysis_window_resolution.py`, which AW-02
predicted it would.

`durationMinutes` is derived on validation, not stored. It is a plain field with
a validator rather than a `computed_field`, because a read-only property splits
every model containing this one into a Readable and a Writable half in the
generated client, for a number the client only ever reads.

Auto-regeneration records the Scope it actually selects by: the channels and
the stepped-on window, with every filter at its default. Carrying the
predecessor's keyword and cap forward was the first version and it was wrong —
`_regenerate_one` has never applied them, so the record would have named filters
nobody used. It does not re-freeze through the resolver either: the window is
derived from the one before it and its end is deliberately in the future, which
`resolve_analysis_window` refuses, rightly, for a window somebody is choosing
now.

The export/import door learned about `scope` too. It writes `tg_summaries`
without going through `upsert_summary`, so an unlisted field there does not
merely fail to restore — it lands in the open `extra` bag and the projection
reports it *as* the Scope, over a column that is still `NULL`. `_with_scope`
stamps the column on last in both projections so a stray copy can never win
again, whatever put it there.

**Deliberately narrowed:** only the Summary submission sends the unflattened
Live/Fixed window. The feed, counts and prompt reads still flatten through
`fixedWindow`, which is harmless there — they are re-resolved server-side on
every request and nothing persists their answer. AW-06 brings the other three
Artifact families onto the submission path, and that is where the rest of the
consumers move.

**Left out, and it needs a decision:** `AIContext.generateBackgroundSummary`,
the browser-side twin of `auto_summary._regenerate_one`, still creates its
successor through `PUT`, so a regeneration that happens with a tab open writes
`scope = NULL` while the scheduler's writes a complete one. Every way of closing
it inside this ticket was worse than leaving it named:

* Submitting the clamped window records a *different* window than the scheduler
  does for the same chain — the divergence relocated, not removed.
* Clamping the scheduler's end instead makes `duration = end - start` shrink
  every run, so the chain decays.
* The convergent fix is for the server to derive the successor — the browser
  would submit "the successor of X" and take back the boundaries rather than
  computing them — which is a new request shape on an unattended path, and
  AW-06 is about to settle what that shape is.

**This matters to AW-07,** which deletes Artifacts that cannot supply the
complete contract: as it stands that would delete regenerations that happened to
run in a browser and keep the ones that ran in the worker. Decide this before
AW-07 runs, not after. The scheduler half is no longer a blocker on its own —
`_successor_scope` stopped depending on the predecessor having a Scope, so a
chain that predates AW-05 gains a complete record from its next unattended run.

## Notes

Discover reports already store the full filter set while Summaries, Chats and Tag
runs store channels and dates only. This ticket sets the shape all four will
share; AW-06 moves the remaining three onto it.
