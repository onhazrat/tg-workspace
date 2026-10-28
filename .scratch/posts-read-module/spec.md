# Spec: One Posts read module in the browser

Status: ready-for-agent

Date: 2026-10-28

Effort prefix: PRM

Source reviewed at local commit `7e301e0874`.

Decisions: `docs/posts-read-module-plan.md` (16 settled decisions and the facts
they rest on). Origin: candidate 1 of the 2026-10-28 architecture review. It
extends ADR-036 (every Posts read compiles from one resolved Posts view) and
ADR-039 (the browser keeps one Posts view, apart from its edits) to the
browser's query side; ADR-006 still decides which client each call uses. No new
ADR. Vocabulary (Posts view, Ranking, Scope, Post filter, Post selection,
Selection rule, Pick, Analysis window, Channel spotlight, Setting) is
`GLOSSARY.md`'s; this effort added its Ranking entry.

Prototype: `prototype/posts-read-module` (local branch, f7bd090b), not
evaluated, because Semantic search is off on staging and no Ranking could run
there. The user accepted the design on the grilling alone, so the mocked
Playwright spec below is the first check of the two user-visible fixes.

## Problem Statement

An Account who runs a find-related on the Posts tab sees a count in the filter
bar that does not describe what is on screen: the count is the whole Post
filter's, often thousands, while the feed shows at most 50 related Posts. A
meaning search, by contrast, counts the Posts it shows. The two kinds of
Ranking disagree because five places in the browser each decide whether the
Posts tab is ranked, four different ways.

The same scatter costs the Account in other ways. A meaning search runs its
vector search and its lookup twice for every query, once for the feed and once
for the counts, and runs both again whenever the Account leaves the tab and
comes back. During a meaning search the facet counts in the filter dropdowns
and the selection bar's "of N in window" total disappear, though they describe
the window, not the search; during a find-related they stay. And if the
Semantic search Setting is switched off while a Ranking is active, some reads
treat the view as ranked and others do not.

For a maintainer, adding one Posts view field means editing about ten modules:
each hook pairs a read with an endpoint itself, casts an untyped request body,
and repeats its own enabled rule, and the feed's request body is built in two
places. Nothing stops the next hook from doing the same.

## Solution

The browser gets one Posts read module. It answers, for every read of what the
Posts tab shows, which endpoint serves it, its query key, its typed request
body, whether it runs, and whether the Ranking or the server answers it. One
rule decides whether the view is ranked. The Ranking's results are fetched once
per query and shared by everything that shows them.

For the Account: a find-related's count matches its cards, a meaning search
costs one vector search per query and survives a trip to another tab, the
facets and the window total stay during either kind of Ranking, and switching
Semantic search off ends any Ranking cleanly. Nothing else about the Posts tab
changes.

## User Stories

1. As an Account running a find-related, I want the filter bar's count to be the number of related Posts shown, so that the number describes the cards on screen.
2. As an Account running a meaning search, I want the filter bar's count to stay the number of ranked Posts shown, so that both kinds of Ranking read the same way.
3. As an Account running a Ranking, I want the count to reflect the Post filter applied to the ranked Posts, so that narrowing the filter narrows the count with the cards.
4. As an Account running a meaning search, I want the facet counts in the filter dropdowns to stay, so that I can still see how many Posts of each Type, media kind and Language the window holds.
5. As an Account running a meaning search, I want the selection bar's "of N in window" total to stay, so that I still know how much of the window my Post selection covers.
6. As an Account running a find-related, I want the facets and the window total to behave exactly as during a meaning search, so that the two kinds of Ranking never disagree.
7. As an Account running a Ranking, I want the Scope counts that an Action covers to stay what they are without a Ranking, so that a Ranking never changes what a Summary covers (ADR-026).
8. As an Account editing a number filter or the Analysis window during a Ranking, I want the value histogram and the window histogram to draw as they do without one, so that the editors hold still.
9. As an Account, I want a meaning search to run one vector search and one lookup per query, so that a search is not paid for twice.
10. As an Account who leaves the Posts tab during a Ranking and comes back, I want the ranked Posts shown again without a new search while they are fresh, so that switching tabs is free.
11. As an Account with a Live Analysis window, I want a Ranking not to search again every minute, so that a long-open search keeps its results and costs nothing (AW-04, story 5).
12. As an Account whose sync finishes during a Ranking, I want the Ranking's results kept, so that the cards I am reading do not reshuffle.
13. As an Account who changes the meaning query, the related Post, the Post filter, the order or the window choice, I want the Ranking run again, so that it answers the view I now have.
14. As an Account who ticks or unticks one ranked Post, I want only that card's selected flag to change, with no new search, so that picking is instant.
15. As an Account who applies a selection edit other than a Pick during a Ranking, I want every ranked card's selected flag to be right afterwards, so that the cards never lie about the Post selection.
16. As an Account who switches the Semantic search Setting off during a Ranking, I want the Ranking to end, so that the search box does not hold a query that does nothing.
17. As an Account who switches Semantic search back on, I want no earlier Ranking to reappear, so that a search never comes back by surprise.
18. As an Account whose Ranking fails, I want the existing error toast and a return to the normal feed, so that a failed search behaves as it does today.
19. As an Account not running a Ranking, I want the feed to page twenty Posts at a time as today, so that the normal path is unchanged.
20. As an Account not running a Ranking, I want every count, facet and histogram to come from the server as today, so that nothing about the normal path changes.
21. As an Account, I want a Channel spotlight to stay unavailable during a Ranking, as today, so that the spotlight's behaviour does not change in this work.
22. As an Account copying links or exporting Markdown of the selected shown Posts without a Ranking, I want the same Posts as today, in the feed's order and up to the export limit, so that export is unchanged.
23. As an Account copying links or exporting Markdown during a Ranking, I want the selected ranked Posts, so that export matches what I see.
24. As an Account using the command palette's Find related Posts, I want its Post list to be the first 100 Posts the tab shows, so that I can pick from what I see.
25. As an Account using that Post list during a Ranking, I want it drawn from the Ranking's results without a new search, so that opening the palette costs nothing.
26. As an Account using that Post list without a Ranking, I want it to read the feed's own request, so that it lists the same Posts in the same order as the feed.
27. As an Account using the command palette's keyword search or the data export, I want them unchanged, so that this work does not move features that only share an endpoint.
28. As an Account whose Live window moves, I want the feed, the counts, the facets and the histograms refreshed as today, so that new Posts still appear without a reload.
29. As a maintainer, I want one function to answer whether the Posts view is ranked, so that no read can disagree with another about it.
30. As a maintainer, I want every Posts read's endpoint, key, typed body, enabled rule and source decided in one module, so that a new Posts view field is a change to one place.
31. As a maintainer, I want request bodies typed as the generated request types, so that a misspelled or missing field fails to compile instead of failing at the server.
32. As a maintainer, I want the feed's request body built in one place, so that the pick-post list and export can never drift from the feed.
33. As a maintainer, I want the Ranking's results in the query cache, so that the frontend's rule that server state is TanStack Query holds for it too.
34. As a maintainer, I want the Semantic search Setting folded into the Posts view, so that no read needs to ask the Settings for it.
35. As a maintainer, I want one name for the ranked state in code and prose, so that "semantic feed", "client RAG path" and "server eligible" stop meaning the same thing.
36. As a maintainer, I want a guard that fails when a module outside the Posts read module names a Posts read endpoint, so that hooks cannot start pairing endpoints again.
37. As a maintainer, I want a table test over ranking, Semantic search and selection that asserts each read's source and enabled rule, so that the find-related bug cannot come back unnoticed.
38. As a maintainer, I want one mocked browser test of the two visible fixes, so that a refactor of the hooks cannot quietly undo them.
39. As a reviewer, I want the generated client and the API untouched, so that this work needs no backend change and no client regeneration.

## Implementation Decisions

1. **One Posts read module.** The existing Posts view module, which already builds each read's key and body together (`postsRead`), grows into the module that returns complete query options for each read: key, typed request body, fetcher, enabled rule and staleness. It stays one module; it is not split because it grew. The hooks that read the Posts tab shrink to running the module's query options.
2. **Reads it serves.** The six existing read kinds (the feed, the shown counts, the Scope counts, the facets, the value histogram, the window histogram), the Ranking's read, the selected shown Posts that Copy links and Export Markdown take, and the command palette's pick-post list. The palette's keyword search and the data export's paging stay outside it: they share the endpoint, not the Posts view.
3. **One ranked rule.** The view is ranked when it has a Ranking. Every read, every hook and the Posts tab itself ask this one rule. The names `isSemanticFeed`, `semanticActive` and `serverEligible` give way to it.
4. **The Setting folds into the view.** The Posts view module reads the Semantic search Setting. While it is off, the view's Ranking is none and the stored Ranking is cleared, so a Ranking cannot return when the Setting comes back. This is derived when the view is built, not corrected afterwards, so no render sees a Ranking with the Setting off.
5. **Which reads the Ranking reaches.** Only the feed and the shown counts. The Scope counts, the facets and both histograms ignore it and run the same with or without one, which turns the facets back on during a meaning search.
6. **The shown count while ranked** counts the ranked Posts the Post filter kept, for a find-related as for a meaning search.
7. **The Ranking's read is one cached query**, keyed by what a search depends on (the view minus the minute a Live window resolves to and minus the Post selection) and run by the existing ranked fetch. The feed, the shown counts and the pick-post list read the same cache entry. Its key sits outside the set of Posts reads that a sync, a Live minute or an AI run invalidates, so none of those runs the search again. It does not retry on failure, as today.
8. **Selection edits during a Ranking.** A Pick patches the cached results in place. Any other selection edit invalidates the Ranking's query, which runs the vector search and the lookup again; a `ponytail:` comment names splitting the vector search from the lookup as the upgrade if that cost shows up.
9. **The feed is two queries behind the ranked rule**: the Ranking's plain query and the server's infinite query, one of them disabled. A single infinite query for both modes was rejected because the counts could not then share the Ranking's cache entry.
10. **Two more read kinds.** The pick-post list takes the feed's request body with a limit of 100; the selected shown Posts take the feed's body with only-selected and the export limit. While ranked, both take the Ranking's cached Posts instead. Callers run them on demand through the query client. The ranked fetch's hand-built normal branch is deleted, so the feed's body has one builder.
11. **Typed request bodies.** The body builders return the generated request types for the feed, the counts, the facets and the two histograms, and the casts in the hooks go. The feed's response stays the hand-written Post, as ADR-006's conformance check requires; only the request side moves.
12. **No transport seam.** The module calls the generated client and the hand-written feed call directly. One adapter is a hypothetical seam. The ranked fetch keeps its existing injected interface, because the vector search and the lookup are faked in its tests.
13. **The feed's query keys come from the shared key factory**, including the two places that invalidate and patch the feed's pages.
14. **The spotlight stays off during a Ranking**, as today, which keeps the Ranking's cache entry spotlight-free.
15. **No backend change.** No route, schema, generated client or OpenAPI change.

## Testing Decisions

A good test here asserts what a caller can observe through the module's interface: which source serves a read, whether it runs, the key it is cached under, and the request it sends. It does not assert how the module computes them. A test that would pass with the find-related bug present is not testing decision 6.

- **The Posts read module, as values.** A table test over ranking (none, meaning, related) × Semantic search (on, off) × selection (empty, some), asserting for every read kind its source (Ranking or server), its enabled rule and that the feed, the shown counts and the pick-post list share one Ranking key. The existing key-and-body tests extend to the typed bodies and the two new read kinds. Prior art: the Posts view module's existing field-by-field key and body tests.
- **The ranked fetch.** Its existing tests with the injected fake keep covering the meaning and find-related branches; the tests of the deleted normal branch go with it. Prior art: the existing shown-posts fetch tests.
- **The Setting folded into the view.** A render test of the Posts view module: with a Ranking set, switching the Setting off yields a view with no Ranking, and switching it back on does not restore it. Prior art: the Posts view module's render tests.
- **The guard.** The architecture invariants test fails when a module other than the Posts read module, or the ranked fetch for the vector search and lookup, names a Posts read endpoint. Its mutations go in the guard mutations file so the commit hook proves it can fail. Prior art: the existing field-set pins in the same file, and the backend's Posts view guard.
- **One mocked Playwright spec.** With the vector search and the lookup routed to fixtures: a find-related shows a filter bar count equal to its number of cards, and a meaning search keeps the facet counts and the window total. Run serially, and mutation-test it by reverting decision 5 and decision 6 in turn and watching it go red. Prior art: the existing mocked Posts tab specs for selection, spotlight and reply previews.
- **Mutation-check before trusting any of it.** Each new assertion is broken once (the shown count back on the server during a find-related, the facets back off during a meaning search, the Ranking's key inside the invalidated set) and the commit body carries the `Mutation-checked:` line.

## Out of Scope

- The command palette's keyword search and the data export's paging (decision 2).
- The filter bar re-flattening the Posts view into setter-per-field controls; this work shrinks it but does not remove it.
- Spotlighting a Ranking.
- Splitting the vector search from the lookup (decision 8).
- Any backend, schema, generated-client or OpenAPI change.
- Enabling Semantic search on staging.

## Further Notes

- Facts this rests on, at `7e301e0874`: the Posts read hooks module is 515 lines, the Posts view module 266 and the ranked fetch 187; the hand-written data module changed in 24 of the last 150 commits, the key factory in 21 and the Posts read hooks in 16. Every Ranking setter is gated on the Semantic search Setting, a per-Account browser Setting, and the Ranking is provider state that is never stored, so a Ranking with the Setting off only happens when the Setting changes mid-search. The Settings provider sits above the Posts view provider. No Playwright spec covered a Ranking before this work.
- The prototype's state panel counted vector searches and lookups per query; the same measurement is a quick manual check on a deployment with Semantic search on, before and after.
