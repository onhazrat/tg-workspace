# Posts filter tree and Selection: from prototype to fold-in

Status: prototype on branch `claude/mattpocock-skills-post-card-4f5186`,
variant `?variant=A-plus-select` on `/workspace?tab=posts`. Not merged.

## What the prototype settled (2026-10-01)

- The Posts tab gets the Channels tab's filter and Selection concepts, built
  from the **same components**, not copies. `components/filter-tree/`
  (`FacetMenu`, `FilterRow`, `ConditionPicker`) and `lib/filter-tree.ts` are
  shared; Channels and Posts each pass a vocabulary. The Channels tab was
  moved onto them and its 410 tests still pass.
- The filter is a **tree**: NOT on any block, parentheses, drag to group,
  AND/OR per pair of parentheses. Conditions are Type, Media, Language and a
  bound on Views or Estimated views.
- Type, Media and Language are facet dropdowns: the tick selects every
  matching Post in the window (up to 5,000, filters aside, as a Channels tick
  ignores what is shown), the funnel adds the value to the tree.
- A **Selection** of Posts: card checkboxes, shift-click ranges, `x` on the
  keyboard, the Channels "Adjust selection" Venn and action limit, and a bar
  with Summarize, Chat, Copy links, Export .md, and the Channels "Selected
  first" toggle (selected Posts the filters show, on top).
- Summarize and Chat always take the **whole** Selection. The action limit
  narrows only the local tools, for the reason the CTB-04 guard in
  `architecture-invariants.test.ts` gives.

## Decided after the prototype (2026-10-01)

- **A-plus-select is the design.** It is card A (photo above the text, the
  photo viewer, channel focus) with the compact-grid and keyboard toggles,
  the Channels-style sort and Filters menu, and the filter tree and Selection
  above.
- **A Selection survives a reload and a tab switch, per browser session.**
  Session storage, not `localStorage`: CLAUDE.md allows only four modules to
  name `localStorage`, and a per-session value has no business there.
- **Everything is selected by default; the Account excludes.** The Selection
  is "the Scope minus exclusions", so an Account that never touches it gets
  exactly today's behaviour. The prototype's model (an explicit set, empty by
  default) is inverted for the fold-in:
  - Summarize and Chat with no exclusions submit the Scope as today, with no
    `posts` list.
  - With exclusions, the Scope needs an `excludedPosts` list on
    `ScopeSubmission` and `FrozenScope`. `posts` (up to 5,000) cannot say
    "all but these" over a window of 4,000+ Posts.
  - A card checkbox is ticked by default and unticking excludes; a facet
    tick re-includes or excludes every match in the window; the Venn and
    "Selected first" read the same model.

## What is a prototype shortcut

| Shortcut | Where | The real version |
|---|---|---|
| The tree runs in the browser on loaded pages; counts read "≈" | `useTreeFilter`, `matchesPostFilter` | Send the tree as `PostScopeRequest.filter`; the server pages after filtering and counts exactly |
| The tree is in memory | `PostFilterTreeContext` | In the URL as text, like `?channelFilter=` |
| The views histogram samples the newest 2,000 Posts | `useViewsSample` | A server histogram over the Scope (`width_bucket`), one small response |
| Feed views filters are moved into the tree on open | `useAdoptFeedFilters` | One model: the flat `forwarded/media/languages/views` fields become tree Conditions, with a migration for stored settings and palette commands |
| Summarize and Chat are toasts | `PostSelectionBar` | Submit the Selection as `ScopeSubmission.posts` (max 5,000) |
| Selection is in memory | `PostSelectionProvider` | Decide: per-session, or persisted per Account |
| Facet totals ignore the tree | `usePostFacets` | Facet counts computed with the tree applied, minus the facet's own branch |

## Server side, already written, not yet shipped

Kept in this branch for the fold-in; lint is clean.

- `backend/app/schemas/posts.py`: `FilterGroup`/`FilterAtom` and the four
  Conditions, `extra="forbid"`, bounded at depth 6 and 100 nodes.
  `PostScopeRequest.filter`.
- `backend/app/services/post_filters.py`: `tree_clause`. Every atom is
  `coalesce(clause, false)`, so NOT is two-valued: a Post with no value fails
  a Condition and passes its negation, as on Channels.
- `backend/app/api/routes/data/_shared.py`: one `ViewReading` per measure the
  tree bounds; the curve is read only when a bound needs it.
- Regenerated `openapi.json` and `src/client/`; `postScopeBody` sends
  `filter` when the tree has children. Nothing in the prototype sets it,
  because staging would answer 422.

## Before fold-in

1. Tests for `tree_clause`: NOT on a NULL Language and a NULL View count,
   OR across measures, an empty negated group, the size bounds. Mutation-test
   each, per CLAUDE.md.
2. Carry `filter` into `ScopeSubmission` and `FrozenScope`, so an Artifact
   records the tree it was made under; extend the export/import sections.
3. Counts and facets with the tree applied (`/data/posts/counts`,
   `/data/posts/facets`).
4. The URL text form, reusing the Channels printer and parser shape.
5. Delete the flat fields' separate pills once the tree owns them, or keep
   them as funnels only. Decide which.
6. Guards: the Posts tree has one evaluator per side, and the browser one is
   gone after fold-in (no `matchesPostFilter` on a paged feed).
7. Remove `?variant=`, the switcher and the dropped variants; fold the
   winning card (A-plus-select's) into `PostCard`.
