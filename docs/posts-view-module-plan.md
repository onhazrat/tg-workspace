# Plan: the Posts view leaves ScraperContext

Decision: [ADR-039](adr/ADR-039-posts-view-apart-from-its-edits.md). Glossary:
**Posts view** in `CONTEXT.md`, which now includes a meaning search. Origin:
candidate 2 of the 2026-10-25 architecture review, grilled 2026-10-26. Follows
[ADR-036](adr/ADR-036-one-resolved-posts-view.md)'s plan
(`docs/posts-view-plan.md`, PV-01 and PV-02), whose out-of-scope list named it.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | A meaning search, a find-related and "respects Channels" are part of the Posts view; reads that count or filter ignore the ranking | Ranking as a concept of its own |
| 2 | Contexts split by how often they change: the view (moves on every edit) and the edits (one identity) | One memoized context; an external store with selectors |
| 3 | The Action path moves too, as ticket PVM-02, built after PR 225 merged (it did, 2026-10-26) | State only; building on PR 225's branch |
| 4 | The `getScopedPosts` identity fix (`postViewOptions` in `usePromptPosts`' deps) lands in PVM-01 with a render test that is red on main | Its own PR first |
| 5 | What remains of `ScraperContext` is `SyncContext` / `useSync`, Follow operations included | Keep the name; split Follow out |
| 6 | Storage does not move: Post filter in the URL, order and cap in per-Account browser storage, selection for the browser session | |
| 7 | Edits are domain operations: keyword, Post filter, ranking as one value, order (sort, grouping, measure, cap) as one value, the three selection edits, `restore(frozenScope)` | One setter per field |
| 8 | The typed keyword is a third context, read by the search box alone; App stops reading it | In the view context; in the edits context |
| 9 | The provider builds the whole view once; `usePostsView(spotlight)` applies a Channel spotlight on top | Gathering per hook |
| 10 | The Action path is pure functions of the view: the Scope submission, and the shown or ranked fetch as a function of `(view, api)` | Hook-returned callbacks fed by the view |
| 11 | Invalidating the Posts reads is a plain function the Posts view module owns; `handleFilterPosts` goes | Leave it in the sync half |
| 12 | `CommandContext` takes the view and the edits as two fields instead of 14 Posts fields | Leave it for review candidate 5 |
| 13 | Guards: `architecture-invariants.test.ts` pins both contexts' field sets; a render test fails when a keystroke re-renders a sync-only or an edits-only reader | Only the render test |
| 14 | A new ADR-039 rather than an addendum to ADR-036 | Addendum; no ADR |
| 15 | Two tickets: PVM-01 (the module, the rename, every consumer, the guards), a pure move that Playwright passes unchanged; PVM-02 (the Action path), blocked by PVM-01 alone now PR 225 has merged, and the one ticket that changes a request | One ticket; finer tickets |
| 16 | No prototype: behaviour-preserving, the render test is the measurement | A prototype measuring re-renders |
| 17 | The "no Posts selected" check before Generate and copy prompt is the view's `scopeCounts` read, through `fetchQuery` with `staleTime: 0` as Trim's count already is (ADR-036 decision 11); `getPromptPostsInput`, the browser's `PromptScope`, `PromptPostsInput` and `promptPosts` go. Its body loses `viewMeasure`, `sort` and `groupByChannel`, which a count ignores | Feed `promptPosts` from the view |

## Facts it rests on (origin/main, 2026-10-26)

- `ScraperContext.tsx`: 560 lines, a 51-member interface, an unmemoized value, 20 reading files.
- Readers by half: 8 read only sync or Follow fields (ChannelCard, ChannelGrid, DiscoverView, SummaryAction, useChannelGridActions, useDirectory, PostPreview, PostCard's `addNewChannel`); 7 read only Posts view fields (PostFeed, PostFilter, usePostsView, useDiscoverGenerate, useApplyArtifactScope, SummaryMarkdown, TagContext); App, AIContext, ChatContext, useCommandRegistry and PostCard read both.
- The halves share one call: the sync half invalidates the Posts reads after a sync.
- After PR 225 (merged 2026-10-26) the AI, Chat and Tag contexts send an Artifact id and read only `getScopeSubmission` from the Action path; AIContext's two `getPromptPostsInput` calls feed nothing but the "no Posts selected" count.
- No store library is installed.

## Out of scope

- CommandContext's Settings slice (review candidate 5)
- Any change to what a Posts read sends or returns
- An external store, unless a profile after PVM-01 asks for one
