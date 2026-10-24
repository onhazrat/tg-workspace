# ADR-036: Every Posts read compiles from one resolved Posts view

**Status:** Accepted (2026-10-25). Plan: `docs/posts-view-plan.md`. No prototype:
the change is behaviour-preserving and the HTTP suite is its guard.

## Context

The Posts tab asks the server six questions about one Posts view: the feed, the
counts, the facets, two histograms and a lookup. The Discover aggregate asks a
seventh. Each route resolved the view itself: the Analysis window, a
`PostScope`, the Post filter (which loads the Settling curve when a bound or
the views order reads it) and the Post selection's predicate, then passed the
Channels and the window again as loose keywords beside the `PostScope` that
already held them. `list_feed` took 16 parameters. Whether the curve was loaded
depended on the caller passing the right `sort`, and `ViewReading.of()` raised
if it was not. The followed-set precondition of a Rule that reads unfollowed
forwards was spelled three ways. `posts._shown` and `post_selection._matched`
each built the per-Channel cap.

The browser had the same shape on its side: seven hooks each built a query key
and a request body from one view by hand, with the rules that keep them in step
(keyed on the window, not its boundaries; the selection by its revision, not
its Picks) re-explained in a comment at every site, and four debounce timers on
one keyword.

The Directory already solved this. `api/directory_views.view_of` resolves a
frozen `DirectoryView` once and every Directory read compiles from it.

## Decision

- **One resolved Posts view per request.** `api/post_views.py::view_of` reads
  the request; `resolve_posts_view` builds a frozen `PostsView` from plain
  values, so the Action path and Discover build one too without an HTTP body.
- **The view holds what every read is evaluated under**: the Account, the
  Channels, the window, the Post filter's tree and keyword, the loaded
  readings, the followed set when a Rule needs it, the cap, the sort, the seed
  and the compiled Post selection. Paging and histogram inputs are arguments of
  the read that uses them.
- **Each read takes the whole view and says which parts it ignores.** The
  facets ignore the Post filter; the window histogram ignores the cap. That
  rule is part of the read's interface and tested there, not left to callers.
- **What a read needs is loaded when the view is resolved**, and only when the
  tree or the sort reads it. An unloaded estimate cannot be represented.
- **One per-Channel cap builder** serves the feed and the Post selection.
- **The read model leaves `posts.py`.** The view and its reads are a read
  model; `posts.py` keeps the writes and stays an aggregate.
- **The browser builds a key and a body together.** `postsRead(view, kind)`
  returns both; the hooks call it. The wire shape does not change.
- **A guard** fails a Posts or Discover route module that names `PostScope`,
  `parse_post_filters` or `selection_clause`.

## Alternatives considered

- **Narrowed views** (`view.without_filter()`) chosen by the caller. Rejected:
  it keeps "which parts apply" as caller knowledge, which is what drifted.
- **Lazy loading** of the curve and the followed set on first use. Rejected:
  the tree and the sort are known at resolve time, and a lazy load hides a
  query inside a read that looks pure.
- **Changing the wire** to one Posts view request shape. Rejected: the request
  hierarchy is already one shape; the friction was on either side of it.
- **Collapsing the six Scope types** (candidate 7 of the 2026-10-25 review) in
  the same change. Deferred: it starts from a frozen Scope, not a request.

## Consequences

- A new Posts read takes `(session, view, …)` and has nothing to resolve.
- The key/body pairing is tested once, per kind, instead of by Playwright
  catching a stale cache.
- `api/routes/data/_shared.py`'s Posts parsing folds into `view_of`.
- `frontend/src/lib/posts/post-view.ts` becomes `post-pipeline.ts`, so "post
  view" does not mean two things.
