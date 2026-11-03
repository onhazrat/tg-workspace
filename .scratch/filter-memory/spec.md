# Spec: The Timeline (ADR-049)

**Status:** ready-for-agent

Prototyped as variant F of `prototype/filter-memory` and grilled on
2026-11-03. Terms are the glossary's: Timeline, Step, Saved view, Channel
selection, Directory selection, Post selection, Requests selection, Analysis
window, Follow, Dismissal, Tag, Setting, Setting group, Artifact, Card size,
Keyboard mode, Highlight. Ticket ids take the prefix `TML`.

## Problem Statement

When I change something in the workspace and regret it, I have no way back.
I clear a Channel selection of 349 Channels with one click and have to pick
them again by hand. I narrow the Directory with five Conditions, try a sixth,
and lose the five when I clear the bar. I move a Channel to the wrong Setting
group, Dismiss the wrong entry, delete a Tag or an Artifact, close a tab I
still needed, and each has its own way back or none at all. A few actions show
an Undo toast; most do not, and the ones that do each undo in their own way.

I also keep rebuilding the same views. The same Post filter on the same
Channels over the last day, the same Directory filter, the same Requests
selection: I set them up from scratch every time, on every device.

## Solution

Everything I do in a browser tab lands on a **Timeline**, one **Step** per
change. Undo (the header button, Cmd+Z, or `u` in Keyboard mode) takes back
the last Step, and Redo puts it back. A Step can be a change to what the
workspace shows (a filter, a selection, the Analysis window, a tab opened,
closed, moved or switched to, a view preference) or a write the workspace sent
(a Follow, a Dismissal, a Tag, a Setting, a delete). Undoing a write sends the
write that takes it back. A Step that cannot be taken back (a sync, an AI run,
a Publication, a Tag merge) stays on the Timeline marked as such, and Undo
passes over it and says so.

A drawer lists the Timeline newest first, saying what each Step changed. I can
jump to any Step, and a change made after an Undo starts a branch, so nothing
is ever lost. I can name a Step as a **Saved view**, choosing what it keeps
beside its tab and filters, and go back to it from any browser I sign in to.

## User Stories

1. As an Account, I want every change I make in the workspace recorded as a Step, so that I can take back any of them.
2. As an Account, I want Cmd+Z outside a text field to undo the last Step, so that undo works the way it does everywhere else.
3. As an Account, I want Cmd+Shift+Z to redo, so that an undo I regret can be taken back too.
4. As an Account in Keyboard mode, I want `u` and `U` to undo and redo, so that I never leave the keyboard.
5. As an Account, I want Cmd+Z inside a text field to stay the field's own undo, so that editing text is not hijacked.
6. As an Account, I want undo and redo buttons in the app header beside the other global controls, so that I can undo on a phone with no keyboard.
7. As an Account, I want the undo and redo buttons disabled when there is nothing to take back or put back, so that I can see where I stand.
8. As an Account, I want a change to any filter (Channel filter, Post filter, Directory filter, History's filters) recorded, so that I can step back through my filtering.
9. As an Account, I want a change to the Channel selection recorded, so that clearing 349 Channels by mistake costs one undo.
10. As an Account, I want changes to the Post selection, the Directory selection and the Requests selection recorded, so that every selection can be taken back.
11. As an Account, I want a change to the Analysis window recorded and put back exactly, Live as Live and Fixed as Fixed, so that undo returns the window I had.
12. As an Account, I want opening, closing and moving a tab recorded, so that a closed tab comes back in its place.
13. As an Account, I want each switch between tabs recorded, so that undo can take me back to where I was.
14. As an Account, I want view preferences such as the Card size recorded, so that a layout I did not like is one undo away.
15. As an Account, I want an open side panel recorded, so that undo can reopen the panel I closed.
16. As an Account, I want scrolling, hovering, an open menu, the Highlight and text I am still typing left off the Timeline, so that it holds only what I meant to do.
17. As an Account, I want undoing a Follow to unfollow and undoing an unfollow to follow again with the Channel's Setting group and follow date, so that the Channel comes back as it was.
18. As an Account, I want undoing a Dismissal to take it back and undoing a take-back to Dismiss again, so that both directions work, for one entry or All matching.
19. As an Account, I want undoing a Tag change on Channels to put their Tags back, so that tagging the wrong Channels is harmless.
20. As an Account, I want undoing a Tag rename to rename it back, so that a typo costs one undo.
21. As an Account, I want a Tag rename that merges two Tags marked as one that cannot be undone, so that undo never splits a merge wrongly.
22. As an Account, I want undoing a Tag delete to put the Tag back on its Channels, so that deleting a Tag is safe.
23. As an Account, I want undoing a move to another Setting group to move each Channel back to its own group, so that a bulk move is safe.
24. As an Account, I want undoing a Setting group's edit, creation or deletion to put it back, so that group changes are safe.
25. As an Account, I want undoing a Setting change to restore its previous value, so that trying a Setting is safe.
26. As an Account, I want undoing a star or a note on an Artifact to put back what it was, so that marks are safe.
27. As an Account, I want undoing an Artifact delete to bring the Artifact back whole, its frozen Scope included, so that deleting is safe.
28. As an Account, I want undoing a bulk Follow that is still running to stop it and unfollow what it already followed, so that a mistaken bulk Follow is cheap.
29. As an Account, I want a sync, an AI run, a Publication and a Tag merge to appear on the Timeline marked as not undoable, so that I can see they happened.
30. As an Account, I want undo to pass over a Step that cannot be undone and take back the one before it, with a toast naming what it passed over, so that one press always takes something back.
31. As an Account, I want undo refused with "changed since" when what the Step wrote has changed after it, for instance on my phone, so that undo never wipes a newer change.
32. As an Account, I want a refused undo passed over like a not-undoable Step, so that I can keep undoing past it.
33. As an Account, I want the view change a write causes to belong to the write's own Step, so that one undo takes back one click.
34. As an Account, I want every write I make with a click to show "<what it did> · Undo", so that I learn undo exists and can use it at once.
35. As an Account, I want the existing Undo toasts (Dismissal, Keyboard mode actions) to undo their Step on the Timeline, so that there is one undo, not two that disagree.
36. As an Account, I want no confirm dialog before a write that I can undo, so that undoable actions are one click.
37. As an Account, I want a confirm dialog kept before a write I cannot undo, such as a Tag merge, Sync all or a Publication, so that the irreversible still asks.
38. As an Account, I want a drawer listing the Timeline newest first, so that I can see what I did.
39. As an Account, I want each row to say what changed ("Closed Chat", "Moved Tools", "Dismissed 3 Channels", "Channels selected 349 → 348"), so that I can find the Step I want.
40. As an Account, I want to jump to any Step from the drawer, with every write between here and there undone or sent again on the way, so that I can go back several Steps at once.
41. As an Account, I want a change made after an undo to start a branch, with the undone Steps kept and marked off my current path, so that nothing is lost.
42. As an Account, I want to narrow the drawer to the open tab's Steps, so that a long Timeline stays usable.
43. As an Account in Keyboard mode, I want `h` to open the drawer and `j`, `k`, Enter, `s` and `t` to move, go, save and narrow in it, so that the drawer is keyboard-first.
44. As an Account in Keyboard mode, I want those keys in the corner key list and the full shortcuts list, so that I can find them.
45. As an Account, I want the Timeline to outlive a reload of the tab, so that a reload does not cost me my undo.
46. As an Account, I want each browser tab to keep its own Timeline, so that undo means what I did in this tab.
47. As an Account, I want the Timeline to end when the tab closes or I sign out, so that undo never acts for a session that is over.
48. As an Account, I want the Timeline to keep at most 200 Steps or 7 days, so that it stays small.
49. As an Operator in View-as, I want a Timeline of my own that holds only view changes and ends with View-as, so that undo never acts as the Account.
50. As an Account, I want to name any Step as a Saved view, so that I can go back to it later.
51. As an Account, I want a Saved view to keep its tab and filters always, and whichever of its selections, Analysis window and open tabs I choose, so that applying it changes only what I meant to keep.
52. As an Account, I want my Saved views kept on my Account, so that every browser I sign in to has them and signing out does not lose them.
53. As an Account, I want only my Account to see my Saved views, so that my Channel names stay mine.
54. As an Account, I want to apply, rename, update to the current state and delete a Saved view, each a Step I can undo, so that managing them is safe.
55. As an Account, I want Saved views listed most recently used first, so that the ones I use are at hand.
56. As an Account, I want a Saved view naming Channels I no longer follow to apply the rest and tell me how many it dropped, so that an old Saved view still works.
57. As an Account, I want Saved views in the Timeline drawer and in the command palette, so that I can apply one without opening the drawer.
58. As a developer, I want a failing test when a write route neither returns its undo nor declares itself not undoable, so that undo cannot silently rot.
59. As a developer, I want a component's own view state to join the Timeline with one line, so that new view state is undoable by default.

## Implementation Decisions

### The undo contract (ADR-049)

- Every user-facing write route (POST, PUT, PATCH, DELETE that changes what an Account sees, reads sent as POST excluded) is in exactly one of two classes in a route inventory: **undoable** or **cannot undo**. The classes live beside the existing route inventory.
- An undoable route builds its inverse in the same transaction as the write, from the rows it changed, and returns it in an `Undo` response header as JSON: the requests that take the write back and a fingerprint of the rows as the write left them. Response bodies do not change shape. The header is listed in the CORS exposed headers.
- A cannot-undo route returns an `Undo` header naming itself not undoable, so the client can tell "cannot undo" from "forgot to say".
- Undo sends the inverse with the fingerprint; the server recomputes it over the same rows and answers 409 "changed since" when they differ. An inverse request is itself a write that returns the inverse of the undo, which is what Redo sends.
- A Tag rename that lands on an existing Tag's name is a merge and returns cannot-undo; a plain rename is undoable.
- An Artifact delete becomes a soft delete held 7 days (the Timeline's reach); its inverse is a restore, so the inverse stays small and the frozen Scope comes back untouched. The retention job purges soft-deleted Artifacts after 7 days. History and every other read never show a soft-deleted Artifact.
- An unfollow's inverse follows again with the Follow's Setting group and follow date. The server-managed Channel fields stay out of it. Tags need nothing: unfollowing keeps them.
- A bulk Follow's inverse is a dedicated undo of that job: it cancels the job if it runs and unfollows the Channels the job followed.
- A Setting group cannot be deleted while it holds Channels, so a delete's inverse only recreates the group.
- Operator-only tools (users, quotas, network, tables, logs) start as cannot-undo; making one undoable later is a change to its route alone.

### The Timeline in the browser

- A React-free **Timeline model** module owns the Steps: recording, branching, undo, redo and go-to. Its operations return what to do (the writes to send in order, the view state to restore) and never send or render anything themselves. The prototype's branch walk is the decision, trimmed:

  ```ts
  // From the prototype: each Step records the Step it was made from.
  type Step = { view: ViewState; write?: { label: string; undo: Inverse | null; redo: Inverse }; parent: number; at: number }
  // Go-to: undo each write from the cursor up to the shared ancestor, then send
  // each write again from there down to the target, then restore its view.
  // Undo goes to the parent; redo to the newest Step made from here.
  // A Step whose write is null (cannot undo) or refused is passed over.
  ```

- A view change within 2.5 seconds of a write joins that write's Step instead of making its own (prototype value).
- The Timeline is kept per browser tab in session storage, scoped to the Account, and cleared at sign-out. View-as keeps a separate Timeline that holds view changes only.
- Steps store the whole view state for now; the cap is 200 Steps or 7 days. Storing Steps as differences is a later change inside the model.
- **View state providers** feed each Step: the workspace URL (every tab's filters, the open Artifact), the open tabs and their order, the Channel selection, the Analysis window, the Post selection, the Directory selection, the view preference Settings, and component state that joins through a one-line hook (the Requests selection and the Requests side panel first). Each provider can read its state and put a recorded state back.
- **Write recording** reads the `Undo` header in the two API transports (the hand-written client's request function and the generated client's response interceptor), not by wrapping `fetch`. Writes sent by undo and redo, and writes caused by restoring a view, are not recorded.
- The header holds undo, redo and a Timeline button showing the Step count and the Saved view count, in the app header's button row beside Routing.
- The drawer lists Saved views, then the Timeline newest first, with each row's change text, its number, its age, "branched from #n" where it branched, a mark on not-undoable Steps, and Steps off the current path faded.
- Change text comes from comparing a Step with the Step it was made from: tabs opened, closed, moved or switched to, filters changed, selections counted before and after, the window, and the write's own label.
- Every recorded write from a click shows a toast with its label and an Undo that undoes that Step. The Dismissal and Keyboard mode toasts use the same path.
- Confirm dialogs stay only on cannot-undo writes.
- Keys go into the key list with its one-key-one-meaning check: `u`, `U`, `h` in Keyboard mode; `j`, `k`, Enter, `s`, `t` and `h` in the drawer. Cmd+Z and Cmd+Shift+Z work outside text fields with Keyboard mode off. The corner and full key guides list them.

### Saved views

- A Saved view is a row on the Account: a name, the Step's view state limited to the parts chosen, when it was last used and created.
- Routes: list, create, update (rename, or replace the state), delete. Each is undoable through the same contract. Every route is scoped to the calling Account and falls under the account isolation guard.
- Applying a Saved view is a Step. Channels it names that are no longer followed are dropped and counted in a toast.
- The command palette lists Saved views as "Apply Saved view: <name>".

## Testing Decisions

- Tests check behaviour through a public seam: a request and the state a read returns, or a model call and what it returns. None reach into a module's internals.
- **API round trip (backend):** one parameterized test over every undoable route. Read, write, check the `Undo` header, send the inverse, read again and compare with the first read. Then write, change the same rows by another route, send the inverse, and expect 409. Then undo and send the undo's own inverse (Redo) and compare with the state after the write. Prior art: the route tests under the API test directory.
- **Inventory guard (backend):** every mounted write route is classified undoable or cannot-undo, every classified route is mounted, and every route answers with the `Undo` header its class promises. Prior art: the route inventory guard, and the View-as spend guard's both-directions inventory. Mutation-check it before trusting it.
- **Saved views (backend):** create, list, update, delete and undo each, and a second Account never sees or changes another's. Prior art: the account isolation tests.
- **Timeline model (frontend):** `bun test` over the React-free module: recording, the branch walk, undo and redo passing over cannot-undo and refused Steps, a view change joining its write's Step, the cap, and the change text. The prototype's change-text check is prior art.
- **Wiring (frontend):** one Playwright spec against mocked routes: Cmd+Z and the header buttons undo a filter change and a mocked write, the drawer lists and jumps, the Undo toast, and applying a Saved view. Prior art: the mocked Playwright specs, run with one worker.

## Out of Scope

- Sharing one Timeline across browser tabs or devices.
- Sharing Saved views with other Accounts, or as links that carry selections.
- Undoing a sync, an AI run (its Artifact stays, and deleting it is its own Step), a Publication or a Tag merge.
- Undoing writes made outside the workspace, by jobs or by another Account.
- Recording scroll position, hover, open menus, the Highlight or text still being typed.
- Storing Steps as differences instead of whole states.

## Prototype reference

`prototype/filter-memory` (snapshot 25732e0e), variant F (variant 0 is main). It records every
write by wrapping `fetch` and builds each inverse in the browser per route,
which this spec replaces with ADR-049's server-built inverse. Checked on a
deployment with real writes, each undone and read back: Tags on a Channel,
Setting group moves, a Setting, a Setting group rename and delete, a Tag rename
and delete, stars and notes on a Summary, a Chat and a Discovery report, Card
size, a Dismissal, the Requests selection, unfollow, and Summary, Chat and Tag
run deletes. What it found that this spec keeps:

- A re-follow is refused if it names the server-managed Channel fields.
- Only a submit sets an Artifact's frozen Scope, so a restore by upsert loses it; hence the soft delete.
- A Setting group holding Channels cannot be deleted.
- Per-Channel sync settings no longer exist; they are per Setting group.
- A quiet window after an undo longer than the undo's own writes swallows the next real click.

## Further Notes

- The glossary's Directory selection is the term, not "ticks", which the prototype's rows used.
- Two decisions were made while writing this spec and confirmed on 2026-11-03: the `Undo` response header as the carrier, and the Artifact soft delete for 7 days. Both are in ADR-049.
- The architecture-guards table gains the inventory guard's row.
