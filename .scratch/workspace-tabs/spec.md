# Closable workspace tabs

Status: ready-for-agent

Ticket prefix: `TABS`.

Settled in a grilling session on 2026-09-29. No ADR: every decision here is browser state and
presentation, and reverses cheaply. The three new terms (Fixed tab, Closable tab, Artifact tab) are
in `CONTEXT.md` under Workspace.

## Problem Statement

The workspace nav shows nine tabs, always, in a fixed order. Most accounts use a few of them, and
the only way to hide the rest is the all-or-nothing "compact workspace tabs" setting, which hides
exactly the four Artifact kinds and nothing else.

Each Artifact kind has one tab, and that tab shows one Artifact. Opening a second Summary from
History replaces the first, so comparing two Summaries means flipping back and forth through
History. Worse, the tab remembers what it last showed: leave the Summary tab and come back an hour
later and the old Summary is still there, because its id stays in the URL across tab switches.
Discover goes further and shows the most recent report whenever none is selected, so it can never
be empty at all.

## Solution

The workspace tabs behave like browser tabs. Channels, Posts and Action are Fixed tabs: always
open, always first, never moved. Everything else is a Closable tab with a close button: History,
Settings, and the Artifact tabs.

An Artifact tab shows at most one Artifact, and any number of them can be open. Opening five
Summaries from History gives five Summary tabs. Opening one that already has a tab switches to it.
A tab opened with the "+" button starts empty, so closing a Summary tab and opening a new one shows
no Summary. Creating an Artifact from Action fills the empty tab of that kind if there is one, and
opens a new tab otherwise.

Tabs can be closed with ×, middle-click or the palette, reordered by dragging (mouse, touch or
keyboard), and reopened from the "+" menu or with the palette's "Reopen closed tab", which brings
back the last closed tab with its Artifact. The open set and its order are remembered per device
and per account.

A new account starts with only the Fixed tabs. History appears once the account has made its first
Artifact, unless the user closes it.

## User Stories

### Fixed and closable tabs

1. As a user, I want Channels, Posts and Action always in the strip, so that the three places I set
   a scope and make something are never one click further away.
2. As a user, I want the Fixed tabs to stay leftmost in their order, so that my muscle memory for
   them survives any amount of rearranging.
3. As a user, I want a close button on History, Settings and every Artifact tab, so that I can keep
   only the tabs I am using.
4. As a user, I want no close button on a Fixed tab, so that I cannot strand myself with no way to
   start work.
5. As a user, I want the "compact workspace tabs" setting gone, so that there is one way to decide
   which tabs I see and not two that disagree.

### Artifact tabs

6. As a user, I want each Summary I open from History to get its own tab, so that I can compare
   two Summaries by switching tabs instead of reopening them.
7. As a user, I want the same for Chat sessions, Tag runs and Discover reports, so that all four
   Artifact kinds behave the same way.
8. As a user, I want opening an Artifact that already has a tab to switch to that tab, so that I
   never end up with two tabs showing the same thing.
9. As a user, I want a tab I open with "+" to show no Artifact, so that closing a tab really puts
   its Artifact away.
10. As a user, I want a new Discover tab to be empty as well, so that Discover follows the same
    rule as the other three kinds instead of silently showing the latest report.
11. As a user, I want an empty Artifact tab to point me at Action, so that I know where to create
    something to fill it.
12. As a user, I want pressing "+" for a kind that already has an empty tab to switch to that tab,
    so that I cannot pile up several identical empty tabs.
13. As a user, I want each Artifact tab labelled with its kind icon and a short name for its
    Artifact (the scope and date for a Summary, the first question for a Chat), so that five
    Summary tabs are distinguishable.
14. As a user, I want the full label in a tooltip when the tab is truncated, so that a shrunk tab
    still tells me what it holds.
15. As a user, I want an empty Artifact tab labelled with just its kind, so that I can tell it
    apart from a filled one.

### Creating Artifacts

16. As a user, I want running a Summary from Action to fill my empty Summary tab if I have one, so
    that pressing "+ Summary" and then running one leaves no empty tab behind.
17. As a user, I want a new Artifact to open in a new tab when no empty tab of its kind is open, so
    that creating something never replaces an Artifact I am looking at.
18. As a user, I want the same rule for Tag runs, Discover reports and Chats started from Action, so
    that the four create paths agree.
19. As a user, I want Discover's "Generate report" to open the report it just made, so that the
    removal of the "latest report" fallback does not leave me on an empty tab.
20. As a user, I want "New conversation" in a Chat tab that already holds a conversation to go to
    the empty Chat tab (or open one), so that starting a new chat never wipes the one I was reading.
21. As a user, I want a re-run of a Summary to stay in that Summary's tab, so that regenerating
    does not scatter tabs.

### Closing and reopening

22. As a user, I want closing the active tab to activate the tab to its right, or to its left when
    it was the last one, so that closing behaves the way it does in my browser.
23. As a user, I want middle-click on a Closable tab to close it, so that I can close tabs the way I
    do in Chrome.
24. As a user, I want middle-click on a Fixed tab to keep opening it in a new browser tab, so that
    the gesture is not wasted where there is nothing to close.
25. As a user, I want Cmd/Ctrl+click and "copy link address" to keep working on every tab, so that
    the tabs stay real links.
26. As a user, I want a "+" button at the end of the strip listing the kinds I can open, so that I
    can bring back any closed tab without knowing a shortcut.
27. As a user, I want "Close tab" in the command palette, so that I can close a tab without the
    mouse.
28. As a user, I want "Reopen closed tab" in the palette to bring back the last tab I closed with
    its Artifact, so that an accidental close is undoable.
29. As a user, I want repeated "Reopen closed tab" to walk back through the tabs I closed this
    session, so that it works like my browser's.
30. As a user, I want closing a tab mid-run to let the run finish and land in History, so that a
    close never throws away work I paid for.
31. As a user, I want a tab to close when its Artifact is deleted, so that no tab is labelled with
    something that no longer exists.
32. As a user, I want a remembered tab whose Artifact was deleted on another device or pruned by
    retention to disappear quietly on load, so that I do not face a stack of error toasts.

### Reordering

33. As a user, I want to drag a Closable tab to a new position with the mouse, so that I can group
    the tabs I am comparing.
34. As a touch user, I want to press and hold a tab to drag it, so that I can reorder on a phone or
    tablet.
35. As a touch user, I want a plain swipe on the strip to scroll it, so that dragging and scrolling
    do not fight.
36. As a keyboard user, I want to pick up a focused tab with Space and move it with the arrow keys,
    so that reordering does not need a pointer.
37. As a user, I want the Fixed tabs to refuse drops that would move them or put a Closable tab
    before them, so that the first three tabs never change.

### Many tabs

38. As a user, I want tabs to shrink as more open, down to an icon, so that twenty open Summaries
    still fit on screen.
39. As a user, I want the strip to scroll sideways once tabs cannot shrink further, so that no tab
    is ever closed for me.
40. As a desktop user, I want × on the active tab and on the tab under the pointer, so that the
    strip stays calm but closing is one click.
41. As a touch user, I want × visible on every Closable tab, so that I can close a tab without a
    hover I cannot perform.
42. As a user, I want × to replace the icon on a shrunk tab when it is active or hovered, so that a
    tiny tab can still be closed.

### Defaults and persistence

43. As a user, I want my open tabs and their order to survive a reload, so that my working set is
    still there tomorrow.
44. As a user, I want my tabs remembered per device, so that my phone's short tab list does not
    overwrite my desktop's long one.
45. As a user sharing a browser with another account, I want my tabs remembered per account, so
    that we do not see each other's tabs.
46. As a new user, I want to start with only Channels, Posts and Action, so that my first screen
    has three things on it and not nine.
47. As a new user, I want History to appear on its own once I have made my first Artifact, so that
    I find out where my work is kept.
48. As a user who closed History, I want it to stay closed even as I make more Artifacts, so that
    the app respects my choice.
49. As a user, I want Settings closed by default and opened whenever something takes me there (the
    palette, a deep link, "+"), so that I reach it when I need it and it does not sit in the strip
    otherwise.
50. As a user, I want a link to an Artifact (`?summary=`, `?chatSession=`, `?tagRun=`, `?report=`)
    to open it in a tab, so that shared and bookmarked links keep working.
51. As a user, I want the address bar to name the active tab and its Artifact, so that copying the
    URL copies what I am looking at.

### Other entry points

52. As a user, I want "View summary" in the logs and the palette's summary search to open that
    Summary in its tab, so that "view" shows me the Summary and not its row in History.
53. As a user, I want Discover's "Show latest" button gone, so that History is the one place to
    find reports by date.
54. As a user, I want the palette's "Go to Summary" (and the other kinds) to switch to the most
    recently active tab of that kind, or open an empty one, so that the command still does
    something sensible with several tabs of one kind.
55. As a user taking the guided tour, I want the tour to open the tabs it shows me and put my tab
    set back afterwards, so that the tour does not leave five empty tabs behind.
56. As an Owner in a View-as session, I want tab behaviour to be the same as anywhere else, so that
    I see the workspace the way the target would.

## Implementation Decisions

- **One pure tab-set model owns every rule.** It replaces the existing visible-tabs helper. Its
  state is an ordered list of open Closable tabs plus the active tab, and its operations are open
  (for a kind, optionally with an Artifact id), close, focus, move, reconcile, and reopen-last.
  Opening applies the dedupe rules: an Artifact that has a tab is focused, an empty open for a
  kind with an empty tab is focused, and creating an Artifact fills that kind's empty tab when one
  exists. Closing picks the next active tab by the right-then-left rule. The model has no React
  and no storage in it.
- **A tab's identity is its kind plus its Artifact id, or its kind alone when empty.** The
  invariants (no two tabs for one Artifact, no two empty tabs of one kind) make that pair unique,
  so no synthetic tab id is needed and the URL can address any tab.
- **The URL keeps its current shape.** `?tab=` names the active tab's kind and the matching
  Artifact param names its Artifact. Only the active tab's Artifact param is present; switching
  tabs rewrites the params rather than spreading the previous ones forward, which is the bug that
  kept an old Summary alive today. A URL naming an Artifact with no tab opens a tab for it.
- **The open set lives in `scopedStorage`.** It stores the ordered Closable tabs and a "History
  closed by you" flag, per device and per account. Reads swallow storage errors like every other
  accessor and fall back to the default set. The reopen stack is in memory only and lasts the
  session.
- **The default set is derived, not stored.** Fixed tabs always; History when the account has at
  least one Artifact and has not closed History; Settings never. Once History is closed the flag
  keeps it closed until the user reopens it.
- **Reconcile runs against the account's Artifacts.** Tabs whose Artifact no longer exists close
  silently on load and whenever the Artifact list changes. Deleting an Artifact closes its tab by
  the same path.
- **The four Artifact views read their Artifact from the active tab.** A missing Artifact renders
  the existing "go to Action" empty state. Discover's "latest report" fallback and its "Show latest"
  button are removed; Discover's generate path passes the new report's id to the tab.
- **The four create paths go through the model's create operation.** Summary generate and paste,
  Tag run and paste, Discover generate, and Chat start. Chat's "New conversation" inside a filled
  Chat tab is a create, not a clear.
- **Palette commands.** "Close tab" and "Reopen closed tab" are new. "Go to <kind>" focuses the
  most recently active tab of that kind or opens an empty one. The logs' "View summary" and the
  palette's summary search open the Summary through the model instead of routing to History.
- **The guided tour snapshots the tab set, opens what it visits, and restores the snapshot when it
  ends or is dismissed.**
- **The strip.** The tabs stay `<Link>`s inside a labelled `<nav>` with `aria-current`, as today.
  Closable tabs get a close button, handle middle-click (auxclick) by closing and preventing the
  browser's new-tab default, and shrink to icon width before the strip scrolls horizontally. The
  "+" button at the end opens a menu of the closable kinds.
- **Reordering uses `@dnd-kit`** (core plus sortable), a new frontend dependency, because native
  HTML drag-and-drop does not fire reliably on touch. Pointer, touch (about 250 ms press-and-hold
  so a swipe still scrolls) and keyboard sensors are enabled. Only Closable tabs are sortable, and
  their range starts after the Fixed tabs.
- **The compact setting is deleted.** The settings-schema key, its catalog entry, the constant
  listing the compact tab ids, and the invariant test that pinned it all go. The invariant that
  `?tab=` validates against the unfiltered tab list stays: a closed tab is still reachable by URL.
- **No backend change.** The Artifact list History already reads answers "does this account have
  any Artifact" and "does this Artifact still exist".

## Testing Decisions

- Tests assert behaviour through the model's public operations and through what the browser shows.
  None asserts internal state shape, storage keys or component structure.
- **Tab-set model unit tests** (bun test). This is where every rule is pinned: open dedupes by
  Artifact, empty-open dedupes by kind, create fills the empty tab or appends, close picks right
  then left, Fixed tabs can be neither closed nor moved, move clamps to the Closable range,
  reconcile drops missing Artifacts, reopen-last restores the Artifact and walks the stack, the
  default set shows History only with Artifacts and not after a user close, and a URL naming an
  unopened Artifact opens it. Prior art is the existing visible-tabs and open-artifact unit tests,
  which these replace or extend.
- **One mocked Playwright spec** for the wiring: × and middle-click close, "+" opens an empty tab,
  opening two Summaries from History gives two tabs, reopening an open Summary switches to it, a
  closed Summary tab reopened with "+" is empty, the tab set survives a reload, a deep link opens
  its Artifact, and a drag reorders two tabs. Prior art is the mocked open-artifact spec. Run with
  one worker, and mutation-test it once (break the dedupe, watch it go red) before trusting it.
- The architecture-invariants test loses its compact-setting cases and keeps the unfiltered
  `?tab=` validation case.
- Existing specs that click tabs by their `tour-tab-*` id must still pass. Specs that land on an
  Artifact tab by URL keep working because deep links open tabs.

## Out of Scope

- Parallel runs across tabs. Each Artifact kind still runs one Artifact at a time with one live
  stream, shown only in the tab that owns the run. The effort to change that is estimated in a
  parked ticket in this directory.
- Cmd/Ctrl+click on a History row to open an Artifact tab in the background.
- Context menus on tabs ("close others", "close to the right").
- Syncing the open tab set across devices.
- Any special case for View-as. Tabs are stored under the target's namespace on the Owner's
  device, which never reaches the target, the same as every other stored preference.

## Further Notes

- Cmd+W and Cmd+Shift+T belong to the browser and cannot be claimed by the page, which is why
  close and reopen live in the palette.
- The existing comment on the nav explains why tabs are links with `aria-current` and not ARIA
  `role="tab"`. `@dnd-kit` adds its own attributes to sortable nodes; check that it does not turn
  the links into buttons or claim a tab role.
