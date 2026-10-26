# Spec: The Posts view leaves ScraperContext

Status: ready-for-agent

Decisions: `docs/adr/ADR-039-posts-view-apart-from-its-edits.md` and
`docs/posts-view-module-plan.md` (17 settled decisions and the facts they rest
on). It extends ADR-036 (`.scratch/posts-view/`, PV-01 and PV-02), whose plan
listed this move as out of scope. No prototype: the change preserves behaviour,
except one request body in the second ticket, and a render test measures the one
thing it is for. Vocabulary (Posts view, Scope, Post filter, Post selection,
Selection rule, Pick, Analysis window, Channel spotlight, Follow, First sync,
Artifact, Covered Post, Setting) is `CONTEXT.md`'s; its Posts view entry now
includes a meaning search. Ticket ids carry the prefix `PVM`.

## Problem Statement

The Posts tab keeps what it shows (the keyword, the Post filter, the meaning
search, the order and cap, the Post selection) in the same context as every
running sync, the sync queue and the auto-sync pause. That context has 51
members, its value is rebuilt on every render, and 20 files read it. So typing
one letter in the Posts search re-renders every Channel card on the Channels
tab, every Post card, the AI, Chat and Tag contexts and the whole shell; so does
every sync progress update and every minute a Live window moves.

The same mix hides a live defect. The function that fetches what the tab shows
changes identity on every render, because one of its 17 hand-written
dependencies is an object rebuilt every render, listed directly under a comment
saying that would defeat the memo. A meaning search depends on that function,
so it runs again whenever anything in the provider moves. Its unit test passes,
because the fixture holds the object in a module constant.

Anyone changing the Posts view pays for the mix too. Restoring an Artifact's
Scope calls ten setters in a row, and a missed one leaves part of the old view
behind. The Action path rebuilds the view from 15 to 17 loose values instead of
reading the one the Posts reads already use, and the "no Posts selected" check
before a Generate describes the Scope a second way of its own.

## Solution

The Posts view gets a module of its own. It owns the state that decides what
the Posts tab shows, builds the Posts view once, and offers a handful of edits
that are domain operations rather than setters. Readers that change on every
edit, readers that only edit, and the search box that sees every keystroke each
subscribe to their own part, so a keystroke re-renders the search box and
nothing that only syncs or only edits.

What is left of the old context syncs and follows Channels, and is called the
Sync context. The Action path becomes plain functions of the Posts view, and
the "no Posts selected" check becomes the view's Scope counts, a Posts read
like any other.

Nothing an Account sees changes, except that typing and syncing stop slowing
the workspace down, and a meaning search stops repeating itself.

## User Stories

1. As an Account typing in the Posts search, I want only the search box to update on each keystroke, so that typing stays smooth with two thousand Channels followed.
2. As an Account with many followed Channels, I want the Channels tab's cards not to re-render when I type in the Posts search, so that switching back to the Channels tab is instant.
3. As an Account watching a sync run, I want sync progress not to re-render the Posts feed, so that scrolling the feed does not stutter while Channels sync.
4. As an Account with a Live Analysis window, I want the minute tick to refresh the Posts reads without re-rendering every Channel card, so that a Live window costs only the refetch.
5. As an Account running a meaning search, I want it to run once per query, so that a sync update or a selection tick does not send the same search again.
6. As an Account running a find-related from a Post, I want it to run once per Post, so that the ranked results do not reload under me.
7. As an Account whose meaning search fails transiently, I want it not to be retried by an unrelated render, so that my search is not cleared by something I did not do.
8. As an Account, I want the Post filter to stay in the link, so that a shared or reloaded link shows the same Posts.
9. As an Account, I want the order, grouping, views measure and per-Channel cap to survive a reload, so that the tab comes back as I left it.
10. As an Account, I want the Post selection to last for the browser session and no longer, as it does today.
11. As an Account, I want the keyword and the meaning query not to survive a reload, as today.
12. As an Account restoring an Artifact's Scope from History, I want every part of the view restored together, so that I never see the restored Channels with the old keyword, filter or order.
13. As an Account restoring a Semantic or related-Post Artifact, I want the live meaning search cleared, so that the restored Scope selects only what the Artifact selected.
14. As an Account, I want a meaning search and a find-related never to be active at once, so that what the tab shows has one ranking.
15. As an Account clicking a bullet in a Summary, I want it to start a meaning search and open the Posts tab, as today.
16. As an Account clicking "find related" on a Post, I want the Posts tab ranked by that Post, as today.
17. As an Account using a Channel spotlight, I want it to apply to the surface I opened it on and not change the Scope, as today.
18. As an Account pressing Generate with no Posts selected, I want the same "no Posts selected" refusal, so that nothing is spent on an empty Scope.
19. As an Account pressing Generate right after changing the selection, I want the "no Posts selected" check to read fresh counts, so that a stale cache never refuses or allows the wrong Generate.
20. As an Account copying a Summary prompt, I want the same "no Posts selected" check as Generate.
21. As an Account starting a Chat or a Tag run, I want the Scope it freezes to be the Scope the Posts tab shows, as today.
22. As an Account using the command palette, I want every Posts command (search, sort, group, cap, filter, select) to behave as today.
23. As an Account using Keyboard mode on the Posts tab, I want every key to behave as today.
24. As an Account following Channels from a Discovery report or the Directory, I want the follow and its First sync to behave as today.
25. As an Account adding a Channel from a forwarded Post, I want it followed and queued for its First sync, as today.
26. As an Account stopping a Sync All or Sync selected, I want the Stop sync button to work, as today.
27. As an Account whose auto-sync is paused after failures, I want the pause banner and its timer to work, as today.
28. As an Account viewing another Account through View-as, I want the Posts view namespaced to the Account I am viewing, as today.
29. As a maintainer adding a Posts view field, I want one place to add it (the view and, when it is editable, an edit), so that it never lands in a context that also syncs.
30. As a maintainer, I want a test that fails when a keystroke re-renders a sync-only or an edits-only reader, so that the fan-out cannot come back unnoticed.
31. As a maintainer, I want the field sets of the Posts view context and the Sync context pinned, so that neither slowly refills with the other's state.
32. As a maintainer, I want the identity of the Posts view's edits and of the fetch for what the tab shows tested across a provider re-render, so that a hand-written dependency list cannot break it silently again.
33. As a maintainer testing the Action path, I want to hand it a Posts view literal, so that I test it the way it is called rather than through 17 loose values.
34. As a maintainer reading the Scope submission, I want it built from the Posts view in one function, so that an Artifact cannot freeze a Scope assembled differently from the one the tab shows.
35. As a maintainer, I want the "no Posts selected" count to be a Posts read built by the same function as the other Posts reads, so that its key and body cannot drift.
36. As a maintainer, I want invalidating the Posts reads to be one plain function, so that the Sync context refreshes the feed after a sync without depending on the Posts view context.
37. As a maintainer reading the command registry, I want it to take the Posts view and its edits as two fields, so that a command's dependencies are not 14 loose values.
38. As a maintainer, I want the name of the remaining context to say what it does, so that "scraper" stops meaning both reading Posts and syncing Channels.
39. As a maintainer, I want restoring an Artifact's Scope to be one edit the module tests, so that a missed field is a failing test rather than a bug report.
40. As a reviewer, I want the first ticket to change no request and no behaviour, so that an unchanged Playwright suite proves it.
41. As a reviewer, I want the one request that changes (the Generate count's body) in a ticket of its own, so that its diff says so.

## Implementation Decisions

### The Posts view module

- A new module, a provider placed where the old context's Posts view half was, owns the Posts view state: the keyword, the Post filter, the ranking, the order and cap, and the Post selection with its revision and last edit.
- The ranking is one value: none, a meaning query (with whether it respects the selected Channels), or a related Post. A meaning query and a related Post cannot both be set.
- The order is one value: the sort, grouping by Channel, the views measure, the per-Channel cap and the cap's mode.
- The provider builds the whole Posts view once from its own state, the selected Channels and the Analysis window, with one identity per change. The Posts view type gains the ranking. A Channel spotlight is still applied per surface, on top of the view.
- Three contexts, split by how often they change:
  - **The view**, which moves on every edit.
  - **The edits**, whose identity never changes: set the keyword, set the Post filter, set the ranking, set the order, the three selection edits (append, remove a chip, replace), and restore.
  - **The typed keyword**, which moves on every keystroke and is read by the search box alone. The view holds the keyword debounced once, as today.
- Restore takes an Artifact's frozen Scope and replaces the whole view in one edit: the Channels and the Fixed window it restores through their own contexts as today, then the keyword, the Post filter, the order and the selection, and clears the ranking. It replaces the ten-setter sequence.
- Storage does not move: the Post filter in the URL, the order and cap in per-Account browser storage under the same keys and with the same fallbacks for values an earlier bundle stored, the selection for the browser session.
- Invalidating the Posts reads is a plain function over the Posts family's query keys, owned by the module. The Sync context calls it after a sync; the Live-window refresh calls it on a tick. The alias that only called it goes.
- The fetch for what the tab shows now (used by the command registry and by the meaning-search path of the feed) keeps one identity across provider renders. The defective dependency goes with the hand-written list.

### The Sync context

- What remains of the old context is renamed the Sync context: sync jobs and their Stop sync, the sync queue, the auto-sync pause and failure count, which Channels are syncing, the restricted recheck, and the two Follow operations, which both end in a First sync.
- Its value is memoized. It names no Posts view field.
- The sync and follow hooks it composes keep their interfaces.

### Readers

- The 8 sync-only readers move to the Sync context. The 7 Posts-view-only readers move to the Posts view module's hooks. The 5 that read both read both.
- The shell stops reading the keyword; the search box reads the typed keyword itself.
- Setter-only readers (each Post card's find-related, a Summary bullet's meaning search, the Artifact restore) read the edits only.
- The command registry's context takes the Posts view and its edits as two fields in place of 14 Posts fields. Its Settings slice is not touched (review candidate 5).

### The Action path (second ticket)

- The Scope submission is a function of the Posts view and the Channels it names, sending the canonical window as today.
- The fetch for what the tab shows, shown or ranked, is a function of the Posts view and the api it calls.
- The "no Posts selected" check before Generate and copy prompt is the view's Scope counts read, built by the same function that builds every Posts read's key and body, fetched with no stale time. The browser's hand-made prompt Scope type, the prompt-posts input and its counting helper go. The count request's body loses the views measure, the sort and the grouping, which a count ignores; its route and its answer do not change.
- The hook that assembled the Action path from loose values goes.

## Testing Decisions

- A good test drives a module through its interface and asserts what a caller sees: the view an edit produces, the request a function builds, whether a reader re-rendered. It never asserts which internal state hook holds a value.
- **The Posts view module, at its provider.** Render the provider with `@testing-library/react`; apply each edit and assert the resulting view: the keyword debounced once, the ranking exclusive, the order as one value, the three selection edits and the revision they move, restore replacing every part and clearing the ranking, storage round-trips including the legacy fallbacks. Assert that the edits and the fetch for what the tab shows keep their identity across a provider re-render; that test is red on main today. Prior art: the Scope context's provider tests, and the prompt-posts hook tests these replace.
- **The fan-out, at the same seam.** Mount a sync-only reader, an edits-only reader and the search box under the provider, type, and count renders: only the search box re-renders per keystroke, and only view readers re-render once the debounce fires. Prior art: the rerender tests in the logs hook tests.
- **The Action path's functions, with a view literal.** The Scope submission, the shown or ranked fetch against a fake api, and the Scope counts read's key and body. Prior art: the Posts view tests that pin each read field by field, which grow a case for the count.
- **The architecture invariants.** Pin the field sets of the Posts view contexts and the Sync context, as the DataContext pin does, and fail any Posts view field on the Sync context. Mutation-check each: add a Posts field to the Sync context, drop the memo, restore the defective dependency, and watch each go red.
- **Playwright, unchanged.** The first ticket passes the full suite with no spec edited. The second edits only a mock that asserts the count request's body, if any does; the counts mocks found route by URL.
- The sync and follow hooks keep their existing tests; the rename adds none.

## Out of Scope

- The command registry's Settings slice (review candidate 5).
- An external store with selectors; revisit only if a profile after the first ticket still shows view readers re-rendering more than the debounce explains.
- Any change to what a Posts read sends or returns, except the count's body in the second ticket.
- Any change to the server: the Posts reads, the Scope submission and the Artifact routes are untouched.
- Splitting Follow out of the Sync context.

## Further Notes

- Two tickets. The first (the module, the rename, every reader, the identity fix, the guards) is a pure move and is not blocked. The second (the Action path and the count) is blocked by the first alone; PR 225 merged on 2026-10-26.
- The first ticket deletes the code the identity fix touches, so the fix lands as the provider-identity test going green, not as a one-line edit kept for later.
- No route and no generated client changes, so nothing is regenerated.
