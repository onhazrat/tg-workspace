# ADR-039: The browser keeps one Posts view, apart from its edits

**Status:** Accepted (2026-10-26). Extends ADR-036, whose deferred item this is.
Plan: `docs/posts-view-module-plan.md`. No prototype: the change preserves
behaviour, and a render test measures the one thing it changes.

## Context

`ScraperContext` held two unrelated jobs behind one 51-member interface: about
32 members of Posts view state and 19 of syncing. Its value was an unmemoized
object literal read by 20 files, so every keystroke in the Posts search, every
sync progress update and every Live minute re-rendered all of them, including
one `ChannelCard` per Channel, which reads only the sync queue.

The Action path rebuilt the same view from loose values: `usePromptPosts` took
17 deps and `computeScopedPosts` 15. One of those hand-written dep lists named
an object rebuilt every render, directly under a comment saying that would
defeat the memo, so `getScopedPosts` changed identity on every render and a
meaning search re-ran with it. Its test passed because the fixture held the
object in a module constant. Restoring an Artifact's Scope called ten setters
in a row.

## Decision

- **A Posts view module owns the state** that decides what the Posts tab shows:
  the keyword, the Post filter, the ranking (a meaning query or a related Post,
  with whether it respects the Channels), the order and cap, and the Post
  selection. A meaning search is part of the Posts view (`CONTEXT.md`).
- **Three contexts, split by how often they change.** The view, built once by
  the provider from the selected Channels and the window, moves on every edit.
  The edits never change identity. The typed keyword, which moves on every
  keystroke, is read by the search box alone. A Channel spotlight is still
  applied per surface, on top of the view.
- **Edits are domain operations, not setters**: the keyword, the Post filter,
  the ranking as one value, the order as one value, the three selection edits,
  and `restore(frozenScope)`, which replaces the ten-setter sequence.
- **The Action path is pure functions of the view.** The Scope submission and
  the shown or ranked fetch take a `PostsView`; tests hand them a view literal.
- **Invalidating the Posts reads is a plain function** the Posts view module
  owns, so the sync half calls it without depending on the Posts view context.
- **The rest is `SyncContext`**: sync jobs, the sync queue, the auto-sync pause
  and the two Follow operations, which exist to queue a First sync.
- **Guards**: `architecture-invariants.test.ts` pins the field sets of the view
  context and `SyncContext`, and a render test fails when a keystroke re-renders
  a sync-only or an edits-only reader.

Storage does not move: the Post filter stays in the URL, the order and cap in
per-Account browser storage, the selection for the browser session.

## Alternatives considered

- **One memoized Posts view context.** Rejected: every reader, setter-only ones
  such as each `PostCard` included, would still re-render on every edit.
- **An external store with selectors** (`useSyncExternalStore`, or a library).
  Rejected for now: more code and a new pattern, for a gain the three contexts
  get with plain React. Revisit if a profile still shows the feed re-rendering
  on keystrokes.
- **Ranking as a concept of its own**, beside the Posts view. Rejected: it
  changes what the tab shows, which is what the Posts view is.
- **One setter per field.** Rejected: a restore that misses one leaves part of
  the old view behind, and nothing can test that from outside.
- **Splitting Follow out of `SyncContext`.** Rejected: both Follow operations
  end in a First sync.

## Consequences

- A new Posts view field is a field of the view and an edit, never a member of
  a context that also syncs.
- The command registry takes the view and the edits as two fields instead of 14.
- `usePromptPosts`, `usePostFilters`' public interface and `handleFilterPosts`
  go.
