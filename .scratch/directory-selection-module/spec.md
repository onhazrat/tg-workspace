# Spec: One Directory selection module in the browser

**Status:** ready-for-agent

Date: 2026-11-15

Effort prefix: DSM

Source reviewed at local commit `38783374`.

Origin: candidate 1 of the 2026-11-15 architecture review, settled in a
grilling session of 16 decisions the same day. It gives ADR-031 (Tick all is a
snapshot up to 10,000 and All matching above it) one implementation in the
browser and changes none of its rules. No new ADR. Vocabulary (Directory,
Directory entry, Directory selection, All matching, Seed, Tag, Dismissal,
Refresh target, Timeline, Step) is `GLOSSARY.md`'s; this effort adds no term.
The code may still say "ticks" where the glossary says Directory selection;
new names use the glossary's word.

Three tickets: DSM-01 (the model and its adapter), then DSM-02 (the bulk
action's target and the guard) and DSM-03 (the list request), each blocked by
DSM-01 only.

## Problem Statement

An Account selects Directory entries and acts on them in bulk: Follow, Dismiss,
Tag, Untag, and for an Operator, Priority boost and Refresh target. When the
view shows more than 10,000 entries the Account acts on All matching instead.
Which of the two a bulk action acts on is decided in the browser in four
places, three different ways: two actions take either a list of handles or
the word "all", Dismiss has a second function for the whole view, and Tag and
Untag choose between two taggers. The tab's top-level component picks between
them each time.

Nothing an Account sees is wrong today. The cost is to whoever adds the next
bulk action or changes ADR-031's rule: they must find every place and repeat
the choice, and no unit test fails if they miss one. The rule's order of
operations (All matching ends on any view change and on any hand-made change;
a snapshot is added to the selection unless that passes the cap) is spread
over a hook and a component, both without a unit test. Only a mocked
Playwright spec of 1,200 lines watches it.

The Timeline (TML-01) is next. It needs to read the Directory selection and
put a recorded one back. Today that state is private to the Directory's hook,
so the Timeline would have to add a fifth reader.

## Solution

Nothing changes for an Account or an Operator. Every Directory gesture sends
the request it sends today and shows what it shows today.

For the people and agents who work on the Directory, one module owns the
Directory selection, All matching, the list request built from them, and what
a bulk action acts on. Every bulk action asks it for its target. The module is
plain data in and plain data out, so its rules are tested in milliseconds
without a browser, and the Timeline reads and restores the Directory selection
through it.

## User Stories

1. As an Account, I want every Directory gesture to behave as it does today, so that this change costs me nothing.
2. As an Account, I want my Directory selection kept across a reload and a view change, so that I can build it up over several views.
3. As an Account, I want a hand-made change to my Directory selection to end All matching, so that I never act on more than I can see I selected.
4. As an Account, I want any change of view to end All matching, so that a bulk action never reaches entries a different view shows.
5. As an Account, I want paging and the Show matches switch not to end All matching, so that looking through the view keeps it.
6. As an Account, I want a view of 10,000 entries or fewer taken into my Directory selection as a snapshot, so that the entries can be Seeds and Dismiss keeps its Undo.
7. As an Account, I want a snapshot added to what I had selected, so that taking in a view does not drop my earlier choices.
8. As an Account, I want a snapshot to replace my Directory selection when adding it would pass 10,000, so that every read of the selection stays within its cap.
9. As an Account, I want a view over 10,000 held as All matching, so that I can Dismiss or Tag it whole.
10. As an Account, I want Dismiss, Tag and Untag to send the view under All matching and my selected handles otherwise, so that the server acts on what the bar says.
11. As an Account, I want Follow off under All matching, so that I cannot start more First syncs than my Telegram Budget allows.
12. As an Account, I want the table to show every row selected under All matching, so that the page agrees with the bar.
13. As an Account, I want the offer to take in the whole view once every row on the page is selected and the view shows more, so that I learn it is possible.
14. As an Account, I want the bar to say whether the view became a snapshot or All matching, so that the size threshold is visible.
15. As an Account, I want a Dismissal to drop the dismissed entries from my Directory selection, so that the bar does not count hidden entries.
16. As an Account, I want a Shared parent or Shared child Condition that reads my Directory selection to follow it live, so that the list changes as I select Seeds.
17. As an Account, I want Selected first to sort by my current Directory selection, so that what I selected stays on top.
18. As an Account, I want a Follow from the Directory to record the view's "your channels" and Reference kinds as its source, so that Discovered-via stays truthful.
19. As an Operator, I want a bulk Priority boost to send the view under All matching, so that I can boost a whole view.
20. As an Operator, I want a bulk Refresh target to send the view under All matching, so that I can set or clear it for a whole view.
21. As an Operator, I want a boost or Refresh target from the detail panel to act on that one entry whatever is selected, so that the panel never touches the bulk target.
22. As an Account, I want undoing a Step to put back the Directory selection that Step recorded, so that a cleared selection can be taken back (TML-01).
23. As an Account, I want an undone Step never to bring All matching back, so that undo cannot arm a bulk action over a view that has changed since.
24. As a developer, I want one answer to "what does a bulk action act on", so that a new bulk action cannot disagree with the others.
25. As a developer, I want ADR-031's rules in one module, so that changing the cap or the ending rule is one edit.
26. As a developer, I want those rules tested without a browser, so that a regression fails in seconds and names the rule.
27. As a developer, I want a write's `handles` or `view` half built in one place, so that the "exactly one of the two" contract with the server has one author.
28. As a developer, I want the list request built by a pure function of the view and the Directory selection, so that what the tab sends is checked without mocking routes.
29. As a developer, I want the top-level Directory component to forward gestures without choosing targets, so that it holds no rule.
30. As a developer, I want a guard to fail when a component chooses between the selection and the view, so that the scatter does not come back.
31. As an agent implementing TML-01, I want a read and a restore of the Directory selection, so that the Timeline's provider does not reach into a hook's private state.
32. As a reviewer, I want the Playwright spec to check that gestures reach the server and the unit tests to check what they send, so that each failure points at one layer.

## Implementation Decisions

- **A React-free model.** The module is a reducer and selectors in the Directory's `lib` folder, in its own file beside the view helpers. It imports no React, router, storage or query code. Prior art is the Posts read module (ADR-036).
- **State.** The selected entries' handles, and what Tick all became on which view: nothing, a snapshot, or All matching. The view is identified as today, from the URL's view with the page and Show matches left out, not from the resolved request, because the request carries the selection when a Seed reads it.
- **Events.** A hand-made change (ends All matching); take all, as two events because the handles read is asynchronous: the model answers "hold the view" above the cap or "fetch the handles" below it, and the adapter reports the fetched snapshot back; the view changed; entries dismissed; restore.
- **Selectors.** What the table shows as selected; what the bulk bar says (the offer, a snapshot, or All matching, with the total); the bulk action's target.
- **The target.** One value: the selected handles, or the view. One function turns a target and the view request into the `handles` or `view` half of a write body. Follow, Dismiss, Tag, Untag, Priority boost and Refresh target all use it. The separate dismiss-all function and the `handles | "all"` parameter go away.
- **Tag and Untag.** The Tags hook keeps the writes and takes a target. The two tagger objects become one.
- **Row and panel actions** name their one handle and never read the bulk target.
- **The list request.** One pure function builds the Seed sets, "your channels", the view request and the list body from the view, the filter, the Directory selection, the Channel selection, the followed Channels and Selected first. The hook runs the query it describes.
- **The five existing helpers** for Tick all move into the module and stop being exported where a selector replaces them.
- **The adapter.** The Directory hook keeps the URL and the remembered view, scoped storage, the queries, toasts, the follow-in-progress set, the open panel, the unreadable-filter reset and the column resend rule. It holds the model in a reducer and writes the selected entries to scoped storage under the key used today, so no stored selection is lost.
- **Restore.** Puts back selected entries only. It never re-holds All matching, which ADR-031 keeps in memory.
- **The guard.** A test in the frontend's architecture invariants fails when a component chooses a write's target. The bulk bar still reads the selector's description to render "held as this view" and to switch Follow off; that is display, and the guard allows it. Its mutation is recorded in the guard mutations file, and the frontend's architecture notes get one bullet naming the module and the guard.
- **No server change.** No route, schema or generated client changes.

## Testing Decisions

- A good test here feeds the model events and a view, and asserts what it answers: the selected entries, what the bar says, the target, a request body. It never asserts how the reducer stores its state.
- **The seam is the model's interface.** The Directory hook and the Timeline's provider cross it, and so do the tests. No test imports a helper from inside it.
- **Unit tests** (`bun test`) cover: each event; All matching ending on a view change and on a hand-made change, and not on paging or Show matches; the snapshot added, and replacing above the cap; dismissed entries leaving the selection; restore never holding All matching; the target as handles and as the view for each of the six bulk actions; Seeds re-resolved from the current selection; Selected first sent with the selection; Follow's source.
- **Replace, do not layer.** The existing unit tests of the five Tick all helpers are rewritten against the model and the originals deleted.
- **Playwright** keeps every Directory case. Three of them (All matching, a selected Seed, tagging the selection) lose their request-body assertions to the unit tests and keep one assertion each that the gesture reaches the server with a view or with handles. Reading the selection and the open panel back from storage after a reload stays in Playwright, because the adapter has no unit test.
- **The guard is mutation-tested** before it is trusted, per the repo rule: add a target choice to a component, watch it go red, record the line for the commit body.
- Prior art: the Posts read module's unit tests, the Directory filter's and view's unit tests, and the architecture invariants test.

## Out of Scope

- The six reads built in the Directory's top-level component (candidate count, distribution, entry, Why it's here, neighbours, an entry's Posts). A second effort if this one pays off.
- The column catalogue, column choices and the column resend rule.
- A unit test of the Directory hook itself.
- The Channels tab's Shown Channels, action targets and Trim (candidate 4 of the same review), which has the same shape.
- Any change to ADR-031's rules, the 10,000 cap, or a server route.
- The Timeline. TML-01 builds its provider on this module.

## Further Notes

- **TML-01 waits on DSM-01 only.** Its ticket names DSM-01 as its blocker, so the Timeline's provider is built on this module's read and restore and need not wait for DSM-02 or DSM-03.
- One decision was refined after the grilling. The grilling agreed "no component reads `held`". The bulk bar does read it, to render its text and switch Follow off, so the guard is worded as "no component chooses a write's target".
- Behaviour must not change. A diff in any request body the Playwright spec records is a defect of this effort, not an improvement.
