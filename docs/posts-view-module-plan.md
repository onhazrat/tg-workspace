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
| 3 | The Action path moves too, as ticket PV-04, built after PR 225 merges | State only; building on PR 225's branch |
| 4 | The `getScopedPosts` identity fix (`postViewOptions` in `usePromptPosts`' deps) lands in PV-03 with a render test that is red on main | Its own PR first |
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
| 15 | Two tickets: PV-03 (the module, the rename, every consumer, the guards) unblocked; PV-04 (the Action path) blocked by PV-03 and PR 225 | One ticket after PR 225; finer tickets |
| 16 | No prototype: behaviour-preserving, the render test is the measurement | A prototype measuring re-renders |

## Facts it rests on (origin/main, 2026-10-26)

- `ScraperContext.tsx`: 560 lines, a 51-member interface, an unmemoized value, 20 reading files.
- Readers by half: 8 read only sync or Follow fields (ChannelCard, ChannelGrid, DiscoverView, SummaryAction, useChannelGridActions, useDirectory, PostPreview, PostCard's `addNewChannel`); 7 read only Posts view fields (PostFeed, PostFilter, usePostsView, useDiscoverGenerate, useApplyArtifactScope, SummaryMarkdown, TagContext); App, AIContext, ChatContext, useCommandRegistry and PostCard read both.
- The halves share one call: the sync half invalidates the Posts reads after a sync.
- PR 225 rewrites AIContext, ChatContext and TagContext to send an Artifact id; `getPromptPostsInput` survives in AIContext, `getScopeSubmission` everywhere.
- No store library is installed.

## Out of scope

- CommandContext's Settings slice (review candidate 5)
- Any change to what a Posts read sends or returns
- An external store, unless a profile after PV-03 asks for one
