# AW-01: One half-open window, everywhere

**What to build:** Make the Analysis window mean exactly one thing on every path
that selects Posts. A Post is in the window when its timestamp is at or after
Start and strictly before End, and Semantic search obeys that window every time
rather than offering to ignore it.

**Blocked by:** None (can start immediately)

**Status:** done

## The rule this ticket makes true

The window is half-open. Adjacent windows meet without sharing a Post, so
dividing a period cannot double-count the boundary. No Posts path can be asked
to mean all time while the rest of Scope means a window.

## Why this lands first and alone

It changes which Posts every existing surface returns. Landing it on its own
means a boundary regression cannot hide inside the larger feature, and every
later ticket is then wiring rather than semantics.

The inclusive end currently exists as four independent copies — two in the posts
read model, one in Discover, one in the semantic search route. Fixing one of
four is not a fix; the point of this ticket is that there is one copy afterwards.

**It was five.** `jobs/auto_summary.py` held a fifth, and it is the one where
the double-count was not academic: `_regenerate_one` sets the successor's start
to exactly its predecessor's `end_date`, so a Post landing on that millisecond
was summarised twice, once in each Summary. It is fixed with the rest.

## Acceptance criteria

- [x] One shared half-open predicate exists and is the only place the comparison is written.
- [x] Feed reads, counts, prompt assembly, Semantic retrieval and Discovery aggregation all use it.
- [x] A Post exactly at Start is included; a Post exactly at End is excluded; a Post one millisecond before End is included.
- [x] The same fixture is exercised through all five paths so an inclusive-end regression cannot survive in a secondary one.
- [x] The boundary tests are mutation-checked: temporarily restoring an inclusive End makes the suite fail.
- [x] The option to ignore the time range in Semantic search is removed from the request contract and from every caller.
- [x] No UI control offers to search outside the current window, and the summary, chat and tag paths no longer carry that flag.
- [x] The generated API client is regenerated if the request contract changed.

## What landed

`services/post_filters.py::analysis_window_clauses` is the one place the
comparison is written; `apply_analysis_window` is its statement-level twin,
mirroring the `post_filter_clauses` / `apply_post_filters` pair already there.
Five call sites route through it.

Both bounds became **required** on `POST /rag/search`. The flag was only ever
client-side, so removing the checkbox alone would have left the rule true by
convention; a 422 is the half that cannot be talked out of. Making them
required also caught two paths that passed no window at all and never had a
control admitting to it: semantic **chat** retrieval, and "more like this".

Two suites, each mutation-checked. `test_analysis_window_boundaries.py` runs
one fixture through the feed (both query shapes), the counts, prompt assembly,
Discovery, semantic retrieval and auto-regeneration; restoring `<=` turns eight
of its eleven red. `test_analysis_window_single_source.py` walks the AST of
`app/` and fails any comparison against `Post.timestamp` that is neither the
shared predicate nor a declared other-window exception; inlining one back into
`posts.py` turns it red.

**Deferred deliberately:** no row was added to the `CLAUDE.md` guard table.
That file sits one byte under its 48,000-byte ceiling, and its budget test says
raising it is the last option, not the first. AW-02 also replaces this exact
contract with the discriminated Live/Fixed input, so the row should be written
once the window's shape is final rather than twice.

## Notes

The feature spec at `../spec.md` is authoritative for interaction details and the
agreed testing seams; ADR-018 wins over both if they disagree.

Removing the ignore-window flag drops it from stored Artifact filters as well.
Do not migrate those rows here — AW-07 deletes every incomplete legacy Artifact.
