# PRM-01: One Posts read module

**What to build:** every read of what the Posts tab shows goes through one Posts read module, with one rule for whether the Posts view has a Ranking. For the Account: a find-related's filter bar count equals its cards; a meaning search runs one vector search and one lookup per query and is reused when they come back to the tab; the facet counts and the selection bar's window total stay during either kind of Ranking; switching the Semantic search Setting off ends a Ranking for good; the command palette's pick-post list and Copy links / Export Markdown read the same request as the feed. Everything else on the Posts tab behaves as today. Spec: `.scratch/posts-read-module/spec.md` (implementation decisions 1 to 15); decisions and facts: `docs/posts-read-module-plan.md`. Frontend only.

**Blocked by:** None (can start immediately)

**Status:** done

- [x] One rule answers whether the Posts view is ranked; the feed, the shown counts, the facets, the Posts tab and the palette all ask it, and the old names for that state are gone.
- [x] The Posts view module folds the Semantic search Setting in: with it off the view has no Ranking and the stored Ranking is cleared, so switching it back on restores nothing.
- [x] The Scope counts, the facets and both histograms ignore the Ranking and run the same with or without one.
- [x] While ranked, the filter bar's count is the number of ranked Posts the Post filter kept, for a find-related as for a meaning search.
- [x] The Ranking's read is one cached query shared by the feed, the shown counts and the pick-post list; a sync, a Live minute or an AI run does not run it again; it does not retry.
- [x] A Pick during a Ranking patches the cached results; any other selection edit runs the Ranking again, with a `ponytail:` comment naming the split of vector search from lookup as the upgrade.
- [x] The pick-post list and the selected shown Posts are read kinds of the module, built from the feed's request body (limit 100; only-selected with the export limit), and take the Ranking's cached Posts while ranked; the ranked fetch's normal branch is deleted.
- [x] Request bodies are typed as the generated request types and the casts are gone; the feed's response stays the hand-written Post; the feed's query keys come from the shared key factory.
- [x] A table test over ranking (none, meaning, related) × Semantic search (on, off) × selection (empty, some) asserts each read's source, its enabled rule and the shared Ranking key.
- [x] A render test shows the Setting fold: Ranking set, Setting off gives no Ranking, Setting back on does not restore it.
- [x] The architecture invariants test fails when a module outside the Posts read module (and the ranked fetch, for the vector search and lookup) names a Posts read endpoint; its mutations are in the guard mutations file.
- [x] A mocked Playwright spec, run serially, routes the vector search and lookup to fixtures and shows a find-related's count equal to its cards and a meaning search keeping the facet counts and the window total.
- [x] Each new assertion was broken once and went red (shown count back on the server during a find-related, facets back off during a meaning search, the Ranking's key inside the invalidated set); the commit body carries the `Mutation-checked:` line.
- [x] Typecheck (build and tests), biome, the frontend unit suite and the Posts Playwright specs pass; no backend, generated client or OpenAPI change.

## Comments

- 2026-10-28: implemented on `claude/prm-01-implementation-dc1949` and merged into main in 25cb005d (#241).
  The `clearChannelSelection` race its Playwright spec exposed is fixed on `claude/clear-selection-waits`.
