# One resolved Posts view: plan

Decision: [ADR-036](adr/ADR-036-one-resolved-posts-view.md). Glossary: **Posts view**
in `CONTEXT.md`. Origin: candidate 1 of the 2026-10-25 architecture review,
grilled the same day. No prototype: behaviour-preserving, the HTTP suite guards it.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | Two PRs, backend first; the frontend PR does not depend on it | One PR across both tiers |
| 2 | The wire and the generated client stay byte-identical | A new request shape |
| 3 | Mirror the Directory: `api/post_views.py::view_of` reads the request, `resolve_posts_view` builds a frozen `PostsView`, each read takes `(session, view, …)` | A single service function with no `api/` adapter |
| 4 | Joins: feed, counts, facets, value histogram, window histogram, lookup, the Discover route | The Action path (candidate 7) |
| 5 | Each read takes the whole view and states which parts it ignores | Callers narrow the view first |
| 6 | The curve and the followed set load at resolve time, only when the tree, the sort, a Rule or a read needs them; the facets always need the followed set (they count Unfollowed forwards) and keep reading it; each Rule keeps its own filter, sort and measure, read through the one curve | Lazy loading on first use |
| 7 | The view and its reads leave `posts.py` for a read-model module, `services/posts_view.py`; `posts.py` keeps the writes | Leave the read model in an aggregate |
| 8 | One per-Channel cap builder for `_shown` and `_matched` | Two builders |
| 9 | Frontend: pure `postsRead(view, kind)` returning key and body, and one hook that gathers the view | Also move the Posts view out of `ScraperContext` (later, separately) |
| 10 | One debounced keyword, exposed by `usePostFilters`; the four `useDebouncedValue(…, 300)` timers in `usePostsView` go | Per-hook timers |
| 11 | `getPostsInScopeCounts` reads through `queryClient.fetchQuery` with the module's key and `staleTime: 0`, so Trim selection still acts on fresh counts and only fills the cache | A direct `api.getPostsCounts` call; the default stale time, which would let Trim act on counts as old as the query stale time |
| 12 | Name: **Posts view** / `PostsView` | `PostView` (reads as one Post's View count), Feed, Shown Posts |
| 13 | The view holds Account, Channels, window, tree, keyword, readings, followed set, cap and mode, sort, seed, selection; paging and histogram inputs are read arguments | Paging in the view |
| 14 | The Action path (`prompt_assembly`, `post_selection.freeze_selection`, `discover_reports`) builds through `resolve_posts_view`'s plain-value form; Discover's route too, since its body has no filter | Widening `view_of` to every body |
| 15 | The view holds the Post selection compiled to its predicate | `selected_in` per route |
| 16 | AST guard: no Posts or Discover route module names `PostScope`, `parse_post_filters` or `selection_clause`; mutation-checked; a row in `architecture-guards.md` | Prose rule |
| 17 | Backend tests: HTTP tests unchanged as the regression net; new tests at the `PostsView` interface for the preconditions; delete tests that only covered `_shared.py` | Rewriting the HTTP tests |
| 18 | `spotlightView` applies in the hook that gathers the view | A third argument to `postsRead` |
| 19 | One table test: change each field, assert the key moves exactly when the body does, per kind; exceptions listed in the test (window by `windowKey`, Picks by revision, tree by printed text) | Per-hook tests |
| 20 | The meaning-search client fallback stays in the hooks | Inside the module |
| 21 | ADR-036, this plan, the glossary entry | |
| 22 | Rename `lib/posts/post-view.ts` to `post-pipeline.ts` (12 importers); the new module is `lib/posts/posts-view.ts` | Two files a letter apart |

## No behaviour change

An Account sees nothing different: the same Posts, counts, bars and timings.
Checked 2026-10-25 before the spec:

- Every keyword timer is 300 ms (`POST_SEARCH_DEBOUNCE_MS` and the four
  literals), so one timer fires on the same keystroke the four did.
- `_shown` and `_matched` rank with the same `channel_order` /
  `random_cap_order`, ending in the unique `(channel_name, post_id)` tiebreak,
  and both scope before `row_number`. One builder keeps the same Posts.
- `api.getPostsCounts` and `useScopedPostCounts` read the same `selected` map
  of the same request; decision 11's `staleTime: 0` keeps it fresh.

What proves it: the HTTP and Playwright suites pass **unchanged**, and
`bash scripts/generate-client.sh` shows no diff. A test that has to change is
a behaviour change and stops the PR.

## Steps

### PR 1: backend

- [x] `services/posts_view.py` (read model, declared in `test_service_kinds.py`): `PostsView`, `resolve_posts_view`, the cap builder, and the feed, counts, facets, histogram and lookup reads moved from `posts.py`
- [x] `api/post_views.py::view_of`; `_shared.py` loses its Posts parsing (delete the module if nothing is left)
- [x] Posts routes and Discover's `_discover_kwargs` move onto the view
- [x] `post_selection` builds from the view's scope and the shared cap builder; the three spellings of the followed-set precondition become one
- [x] `prompt_assembly`, `freeze_selection`, `discover_reports` build through `resolve_posts_view`
- [x] Interface tests: estimate loaded when read, followed set present when a Rule needs it, curve read once per request
- [x] AST guard plus its `architecture-guards.md` row; mutation-check it and record it in the commit body
- [x] Verify: `bash scripts/route-guards.sh`, `cd backend && uv run pytest tests/ -q`, `bash scripts/lint.sh`; `bash scripts/generate-client.sh` shows no diff

### PR 2: frontend

- [x] Rename `post-view.ts` to `post-pipeline.ts`
- [x] `lib/posts/posts-view.ts`: `postsRead(view, kind)` for feed, shown counts, scoped counts, facets, value histogram, window histogram, uncapped view
- [x] Key/body table test, with the three declared exceptions
- [x] `usePostFilters` exposes the debounced keyword (and the semantic query); `usePostsView`'s hooks call `postsRead`
- [x] `getPostsInScopeCounts` through `fetchQuery`
- [x] Verify: `bun run --filter tg-summarizer-frontend test:unit`, `bunx tsc -p tsconfig.build.json --noEmit`, `bun run typecheck:tests`, `bun run lint`, the Posts Playwright specs with `--workers=1`

## Out of scope

- Collapsing the six Scope types (review candidate 7)
- Moving the Posts view out of `ScraperContext` (done by ADR-039, `docs/posts-view-module-plan.md`)
- Any change to what a read returns
