# PV-02: The browser builds each Posts read's key and body together

**What to build:** Every Posts read the browser makes gets its query key and
its request body from one pure function, so the two cannot drift, and an
Account sees no difference. `postsRead(view, kind)` returns both for the feed,
the shown counts, the Scope counts, the facets, the value histogram, the
window histogram and the uncapped view. The key departs from the body in
exactly three ways: the window by its key, not its resolved boundaries; the
Post selection by its revision, not its Picks; the Post filter by its printed
text, not its tree. One hook gathers the Posts view from the contexts and
applies the Channel spotlight; the Posts hooks call it and `postsRead`. The
keyword and the meaning query are debounced once, in the post-filters hook,
and reach every read through the context. The command registry asks for
in-scope counts through the query cache with the Scope counts' key and a stale
time of zero, so Trim selection still acts on fresh counts.

First, as a prefactor: rename the client-side pipeline module so "post view"
does not mean two things, then give the new module the Posts view name.

Runs beside PV-01 (the wire does not change) and merges after it.

**Blocked by:** None (can start immediately).

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions, Testing
Decisions), `docs/adr/ADR-036-one-resolved-posts-view.md`,
`docs/posts-view-plan.md` (decisions 9 to 11, 18 to 20, 22 and "No behaviour
change"). The existing body builders are what `postsRead` calls for the body.

- [x] The client-side pipeline module is renamed and every importer follows
- [x] `postsRead(view, kind)` returns `{ queryKey, body }` for all seven kinds, using the existing body builders
- [x] One hook gathers the Posts view and applies the Channel spotlight; every Posts read hook builds its query through `postsRead`
- [x] The post-filters hook exposes the debounced keyword and meaning query through the context; the Posts hooks' own timers are gone
- [x] The command registry's in-scope counts go through the query client's fetch with the Scope counts' key and a stale time of zero
- [x] The meaning-search fallback stays in the hooks
- [x] One table test: for every kind, changing each field of the view moves the key exactly when it moves the body, with the three departures listed in the test; mutation-checked by dropping one field from one kind's key, recorded in the commit body
- [x] The Posts Playwright specs pass **unchanged** with `--workers=1`
- [x] Frontend unit tests, the build typecheck, the tests typecheck and the lint pass

## Comments

- 2026-10-25: implemented on `claude/implement-pv-02-6d8bd6`. "The uncapped view"
  is the view both histograms read, not a seventh endpoint: neither histogram
  kind sends the cap, and `posts-view.test.ts` holds them to it. The AW-04
  source grep in `architecture-invariants.test.ts` became "no Posts query key
  outside `postsRead`"; its window and selection rules are asserted on real
  keys in `posts-view.test.ts`.
