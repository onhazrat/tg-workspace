# Plan: one Posts read module in the browser

Glossary: **Posts view** and **Ranking** in `GLOSSARY.md`. Origin: candidate 1
of the 2026-10-28 architecture review, grilled the same day. Extends
[ADR-036](adr/ADR-036-one-resolved-posts-view.md) (every Posts read compiles
from one resolved Posts view) and
[ADR-039](adr/ADR-039-posts-view-apart-from-its-edits.md) (the browser keeps
one Posts view, apart from its edits) to the browser's query side. No new ADR.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | The module serves the six `postsRead` kinds, the Ranking's read, Copy links / Export Markdown and the command palette's pick-post list | The palette's keyword search (`search-filters.ts`) and the data export's paging, which share only the endpoint |
| 2 | One rule for "is this view ranked": `isRanked(view)`, true when the view has a Ranking | Five places deciding it four ways |
| 3 | The Posts view module folds the Semantic search Setting into the view: `view.ranking` is none while the Setting is off, and the stored ranking is cleared | Every read taking `embeddingsEnabled` as an argument; keeping a hidden ranking that returns when the Setting comes back on |
| 4 | The Scope counts, the facets and both histograms ignore the Ranking and always run, so the facets and the selection bar's window total stay during a meaning search | Today's facets off for a meaning search and on for a find-related; off for both |
| 5 | While ranked, the shown count counts the ranked Posts the filter kept, for a find-related as for a meaning search | The whole filter's count (today's find-related bug); no count |
| 6 | The Ranking's read is one TanStack query keyed by `shownPostsKey`, read by the feed and the shown counts alike: one vector search and one lookup per query, not two | `useShownPosts`' `useState` and `useEffect` |
| 7 | Body builders return the generated request types (`PostFeedRequest`, `PostFilteredRequest`, `PostFacetsRequest`, the two histogram requests); the five casts go. The feed's response stays the hand-written `Post` (ADR-006) | Untyped `Record<string, unknown>` bodies |
| 8 | The module calls the generated client directly. Tests assert each read's key, typed body, `enabled` and served-by as values; a table test over ranking, Semantic search and selection is the one that would have caught decision 5's bug. `fetchShownPosts` keeps its `ShownPostsApi` fake for the vector search | An injected fetcher map (one adapter, a hypothetical seam) |
| 9 | The feed is two queries behind one switch: the Ranking's plain query and the server's infinite query, the other disabled | One infinite query with a single ranked page, which cannot share its key with the counts' `useQuery` |
| 10 | Two more read kinds, `pickPool` (the feed's body, limit 100) and `selectedShown` (the feed's body, `onlySelected`, `EXPORT_LIMIT`), run with `queryClient.fetchQuery`; while ranked both take the Ranking's cached Posts. `fetchShownPosts`' hand-built normal branch is deleted | Leaving both callers building their own feed body |
| 11 | The code stays in `lib/posts/posts-view.ts`, which gains the query options; the hooks in `hooks/usePostsView.ts` shrink to `useQuery(postsQuery(view, read))`; the vector search stays in `scoped-posts.ts` | A new `posts-read.ts` beside it |
| 12 | `isSemanticFeed`, `semanticActive` and `serverEligible` become `isRanked` and names derived from it | Keeping the four names |
| 13 | Guard: `src/lib/architecture-invariants.test.ts` fails when a module other than `posts-view.ts` (and `scoped-posts.ts` for the vector search and lookup) names a Posts read endpoint; its mutations go in `docs/agents/guard-mutations.json` | Prose only |
| 14 | A selection edit other than a Pick invalidates the Ranking's query, which runs the vector search again; a `ponytail:` comment names splitting the vector search from the lookup as the upgrade | Two cached steps now, for an edit that is rare while ranked |
| 15 | The Ranking's key stays outside `queryKeys.postViews`, so a sync or a Live minute does not run the search again (AW-04, story 5) | Inside, one vector search a minute while a search stays open |
| 16 | No Channel spotlight while ranked, as today, so the feed and the counts share one cache entry | Spotlighting the cached results in the browser |

## Facts it rests on (0a207f68, 2026-10-28)

- `hooks/usePostsView.ts` 515 lines, `lib/posts/posts-view.ts` 266, `lib/posts/scoped-posts.ts` 187; `api/data.ts` changed in 24 of the last 150 commits, `queryKeys.ts` in 21, `usePostsView.ts` in 16.
- Who decides "ranked" today: `isSemanticFeed` (Semantic search on and related or a meaning query), `useShownPostCounts` (a meaning query), `usePostFacets` (a meaning query), `fetchShownPosts` (its own branches), and `PostFeed` calling `isSemanticFeed` again.
- `meaningQuery` answers `""` for a find-related, so the shown counts ask the server and the filter bar's count is the whole filter's while the feed shows at most 50. `PostFeed` already hides the Venn while ranked.
- `usePostsFeed` and `useShownPostCounts` each call `useShownPosts`, so a meaning search runs `fetchShownPosts` twice.
- Every ranking setter is gated on `embeddingsEnabled`, a per-Account browser Setting; the ranking is provider state and never stored, so a ranking with the Setting off happens only when it is switched off mid-search.
- `SettingsProvider` sits above `PostsViewProvider`.
- No Playwright spec covers a meaning search, a find-related or the facets while ranked.
- `usePostsFeed` hardcodes `["postsFeed"]` twice instead of using `queryKeys`.

## Out of scope

- The palette's keyword search and the data export's paging (decision 1).
- The filter bar re-flattening the view into setter-per-field controls (`FilterBarControls`), review leftover; this plan makes it smaller, not gone.
- Spotlighting a Ranking (decision 16).
- Splitting the vector search from the lookup (decision 14).
