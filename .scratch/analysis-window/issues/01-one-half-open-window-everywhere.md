# AW-01: One half-open window, everywhere

**What to build:** Make the Analysis window mean exactly one thing on every path
that selects Posts. A Post is in the window when its timestamp is at or after
Start and strictly before End, and Semantic search obeys that window every time
rather than offering to ignore it.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

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

## Acceptance criteria

- [ ] One shared half-open predicate exists and is the only place the comparison is written.
- [ ] Feed reads, counts, prompt assembly, Semantic retrieval and Discovery aggregation all use it.
- [ ] A Post exactly at Start is included; a Post exactly at End is excluded; a Post one millisecond before End is included.
- [ ] The same fixture is exercised through all five paths so an inclusive-end regression cannot survive in a secondary one.
- [ ] The boundary tests are mutation-checked: temporarily restoring an inclusive End makes the suite fail.
- [ ] The option to ignore the time range in Semantic search is removed from the request contract and from every caller.
- [ ] No UI control offers to search outside the current window, and the summary, chat and tag paths no longer carry that flag.
- [ ] The generated API client is regenerated if the request contract changed.

## Notes

The feature spec at `../spec.md` is authoritative for interaction details and the
agreed testing seams; ADR-018 wins over both if they disagree.

Removing the ignore-window flag drops it from stored Artifact filters as well.
Do not migrate those rows here — AW-07 deletes every incomplete legacy Artifact.
