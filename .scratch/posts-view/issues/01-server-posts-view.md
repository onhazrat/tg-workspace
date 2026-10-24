# PV-01: Every Posts read on the server compiles from one resolved Posts view

**What to build:** The server answers every Posts question from one Posts
view, resolved once per request, and an Account sees no difference. A Posts
request is read into a frozen Posts view holding the Account, the Channels,
the Analysis window's boundaries, the Post filter's tree and keyword, the
loaded readings, the followed set when anything needs it, the cap and its
mode, the sort, the seed and the compiled Post selection. The feed, the
counts, the facets, both histograms and the lookup each take the session, the
view and only their own inputs (paging, histogram inputs), and each says which
parts of the view it ignores. The Discover route and the Action path (prompt
assembly, freezing a selection, creating a Discovery report) build the same
view from plain values. The feed and the Post selection share one per-Channel
cap builder. The view and its reads live in a new read-model module; the
module that writes Posts keeps only the writes.

Build order, keeping the HTTP suite green after each step: the view and its
resolve function; the cap builder; the reads moved one at a time onto the
view; the Discover route and the Action path; the shared Posts parsing helpers
folded into the request adapter; the guard last.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions, Testing
Decisions), `docs/adr/ADR-036-one-resolved-posts-view.md`,
`docs/posts-view-plan.md` (decisions 2 to 8, 13 to 17 and "No behaviour change").
The pattern to mirror is the Directory's request adapter and its frozen
Directory view.

- [ ] A frozen `PostsView`, a request adapter that reads a Posts request into it, and a resolve function that builds it from plain values
- [ ] The curve loads at resolve time only when the tree, the sort or a Selection rule reads an estimate, and once per request; an unloaded estimate cannot be reached
- [ ] The followed set loads only when the tree or a Selection rule reads Unfollowed forwards, and always for the facets
- [ ] One per-Channel cap builder for the feed and the Post selection, scoping before ranking and ending in the unique Channel-and-Post tiebreak
- [ ] Feed, counts, facets, value histogram, window histogram and lookup take `(session, view, …)`, each stating the parts it ignores
- [ ] The new read-model module is declared a read model in the service-kinds inventory; the Posts write module stays an aggregate
- [ ] The Posts routes use the request adapter; the Discover route, prompt assembly, selection freezing and Discovery report creation use the resolve function
- [ ] The shared Posts parsing helpers are gone or folded into the adapter, with tests that only covered them deleted
- [ ] Interface tests: loaded estimate, followed set present or not loaded, one curve read across many Selection rules, each read ignoring exactly what it says, a capped Selection rule reaching the Posts the feed's cap keeps
- [ ] An AST guard fails a Posts or Discover route module naming the Post scope type, the Post filter parser or the selection compiler; a row in the guard table; the commit body says `Mutation-checked: <what was broken> went red`
- [ ] Every existing Posts, Discover, tenancy, isolation and scope-parity test passes **without edits**
- [ ] The route guards script, the full backend suite and the backend lint pass; the client generator shows no diff

## Comments
