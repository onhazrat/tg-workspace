# Spec: History tab redesign

Status: ready-for-agent

Decisions: `docs/history-tab-redesign-plan.md`, the record of a grilling session
and a prototype; this spec does not repeat its reasoning. Vocabulary (Artifact,
Written, Scope, Analysis window, Time bound, History, Highlight, Summary, Chat,
Tag run, Discovery report) is `CONTEXT.md`'s. A search match is *marked*,
never "highlighted": **Highlight** is Keyboard mode's word for the one item a
key acts on. Ids carry the prefix `HTR`.

No tickets. The work fits one session: implement this spec as one unit with
`/mattpocock-skills:implement`, test-first at the two seams under **Testing
Decisions**, on a branch off `main`.

Prototype: variant 1 (`?tab=history&variant=1`) on
[`prototype/history-tab-redesign` @ ac9c6255](https://github.com/onhazrat/tg-workspace/tree/ac9c6255378a4e81894b761d71acb1f0ec9d3c26),
a one-commit snapshot on top of `main`. It was built against a deployment's data
and is throwaway: read it for the decisions, never copy it. The files worth
reading are the History prototype directory's `FilterBar`, `variants`,
`WrittenSpread` and `HistoryPrototype`, and `proto_history_api.py` under the
backend's scripts, whose queries are the backend decisions below.

## Problem Statement

History is the one list tab that still looks and behaves like the app before
its redesign. Channels, Posts and the Directory share a bar: a large search box,
quiet segmented choices, pills that open popovers, a time editor with a spread,
a sort, a footer that counts. History has its own uppercase chips, a small
search input and a star button, and nothing else. It cannot narrow by time, it
cannot sort, and it cannot say how many Artifacts there are ("40+" at best, from
paging). Its cards show raw markdown in titles, every channel of a Scope on one
truncated line, a loud "Use this Scope" button on every card, and five hover
actions that a phone cannot reach. Editing a note opens a box under the whole
infinitely scrolled list, out of sight of the card it belongs to. Two hundred
lines of History-only filter code duplicate what the shared kit already does.

## Solution

History is rebuilt from the shared kit. A bar like the Directory's holds the
search, Kind and Status choices that each say how many Artifacts they would
show, a Starred toggle, a time filter that bounds either when an Artifact was
Written or its Analysis window, with a spread chart to pick from, and a sort on
Written or the window's start. A footer gives the true total and a Compact grid
switch. Below it, Artifacts are cards in one column under day headings, or a
compact grid: each card tinted by kind, its title as plain text, its first
three channels and a count of the rest, its window with a quiet icon to use its
Scope, and only Star, Note and a "⋯" menu as actions, all reachable by touch.
Search matches are marked in the text. The note is edited in a popover beside its
card. Every filter lives in the URL.

## User Stories

### The bar

1. As a History user, I want the same bar the Directory and Posts tabs have, so that every list tab reads and works alike.
2. As a History user, I want a large search box at the top of the bar, so that searching is the first thing I can do.
3. As a History user, I want search to match channels, titles and notes as it does today, so that what I find does not change.
4. As a History user, I want to pick one Artifact kind or all of them in quiet segments, so that the choice looks like every other single choice in the app.
5. As a History user, I want each kind to show how many Artifacts picking it would show, so that I know before I click.
6. As a History user, I want "All kinds" to show the count under my other filters, so that I can compare it with each kind.
7. As a History user, I want to pick Failed, Pending or any status, with counts the same way, so that I can see at once whether anything needs my attention.
8. As a History user, I want a choice that would show nothing to look dimmed but stay clickable, so that I am not invited to an empty list but nothing is hidden from me.
9. As a History user, I want Kind and Status to stay independent, so that a combination that matches nothing simply shows nothing and the counts warned me.
10. As a History user, I want a Starred toggle that looks like the other on/off pills, so that starred-only reads as a setting of the list.
11. As a History user, I want a time filter in the bar, so that I can see what I made in a given period.
12. As a History user, I want to choose whether the time filter bounds when an Artifact was Written or its Analysis window, so that I can ask either "what did I make last week" or "which runs covered last Tuesday".
13. As a History user, I want the Analysis window filter to keep every Artifact whose window overlaps the bound, so that a run that started before the period but covered part of it is found.
14. As a History user, I want an Artifact with no recorded window never to match a window filter, so that the filter never guesses.
15. As a History user, I want the same Live and Fixed time editor as Posts, Logs and the Directory, with open ends, so that I learn one editor once.
16. As a History user, I want a spread chart in the time filter's popover, so that I can see when my Artifacts cluster before I pick a range.
17. As a History user, I want the spread to follow my other filters but not the time filter itself, so that it shows what lies around the range I chose.
18. As a History user, I want the spread to count Artifacts by Written, or window starts when bounding the window, so that its bars say what they count.
19. As a History user, I want to zoom the spread, so that one very old Artifact does not flatten the rest.
20. As a History user, I want clicking a bar to set the time filter to that bar's range, so that picking a period takes one click.
21. As a History user, I want to sort by Written or by the Analysis window's start, newest or oldest first, so that I can read History in the order my question needs.
22. As a History user, I want Artifacts with no recorded window to sort last whichever direction I pick, so that they never interleave with real windows.
23. As a History user, I want the footer to give the true total under all my filters, so that I am never shown "40+".
24. As a History user, I want the footer to say in words how the list is sorted, so that the order is never a mystery.
25. As a History user, I want every History filter, the time filter, its moment and the sort in the URL, so that a link reopens exactly the list I was looking at.
26. As a History user, I want the command palette's History search and starred-only commands to keep working, so that the palette and the bar never disagree.
27. As a History user on a phone, I want the search on top and every other control behind one Filters button that says how many are on, so that the bar fits a phone.
28. As a History user, I want every control to fit one row at a normal desktop width, so that the bar does not wrap.

### The list

29. As a History user, I want Artifacts as cards in one column, so that a card's window, note and title get the width they need.
30. As a History user, I want cards grouped under day headings by when they were Written, so that "when did I make this" reads at a glance.
31. As a History user, I want day headings only while the list is sorted by Written, so that a heading never splits a list sorted another way.
32. As a History user, I want day headings without a count, so that a heading never shows a number that paging has made wrong.
33. As a History user, I want a Compact grid switch in the footer, like the Posts tab's, so that I can scan many Artifacts at once.
34. As a History user, I want Compact grid to start off each session, so that the full card is what I see first.
35. As a History user, I want compact cards in a grid with no day headings, so that the grid fills its rows.
36. As a History user, I want each kind's icon in its own colour, so that a mixed list scans faster.
37. As a History user, I want kind colours that never clash with Failed red, Pending amber, or the green and blue of the schedule flags, so that colour never misleads.
38. As a History user, I want a card's header to show its kind, its status badge, its schedule flags while on and when it was Written, so that its state reads in one line.
39. As a History user, I want "Auto-regenerates" and "Auto-publishes" chips on a Summary while those flags are on, so that a scheduled Summary is visible without opening a menu.
40. As a History user, I want a card to show its first three channels and a count of the rest, with the full list on hover, so that a Scope of 1,700 channels never overflows the card.
41. As a History user, I want the channels that match my search moved to the front of the channel line, so that a channel match is never hidden in the count.
42. As a History user, I want a card's title as plain text, without markdown marks or a leading emoji, so that Summary titles are readable.
43. As a History user, I want a Failed card to keep its instruction to open it and retry, so that I know what to do with it.
44. As a History user, I want a card's Analysis window on one line ending in a small "Use this Scope" icon, so that the action is there without shouting.
45. As a History user, I want the line saying who last changed an Artifact on my behalf, as today, so that an Artifact I did not make myself stands out.
46. As a History user, I want a card's note shown on the card, as today, so that I see why I kept it.
47. As a History user, I want a card's footer detail (posts, messages, candidates) left blank when the badge already says Failed or Awaiting response, so that nothing is said twice.
48. As a History user, I want only Star, Note and a "⋯" menu in a card's footer, always visible, so that the actions work on a phone.
49. As a History user, I want Auto-regenerate, Auto-publish and Delete in the "⋯" menu, so that the rare and dangerous actions are one step away.
50. As a History user, I want Auto-regenerate refused for a Summary whose window is under a minute, as today, so that the rule does not change.
51. As a History user, I want Delete to keep asking first, so that one click never loses an Artifact.
52. As a History user, I want to edit a note in a popover beside the card's note button, so that the editor is where I clicked.
53. As a History user, I want compact cards to keep Star, Note and the menu as icons, so that the grid stays actionable.
54. As a History user, I want my search matches marked in the channel line, the title and the note, so that I see why each card matched.
55. As a History user, I want the marks always on while I search, so that there is no extra switch.
56. As a History user, I want a card that matched on text it does not show to still appear, unmarked, so that search finds what it always found.
57. As a History user, I want clicking a card's channels or title to open the Artifact, as today, so that opening does not change.
58. As a History user, I want the list to keep loading more as I scroll, so that long histories still work.
59. As a History user, I want the empty state to say whether my filters hid everything or I have made nothing yet, as today, so that an empty list is never ambiguous.
60. As a History user, I want Persian and other right-to-left titles shown in their own direction, so that they read correctly.
61. As a History user with keyboard mode coming (KM-03), I want the list built so that one adapter can drive it, so that keyboard mode lands once on the final shape.

### The backend

62. As the History tab, I want the Artifact list to take the time filter's moment and Time bound and a sort with a direction, so that filtering and ordering happen where paging happens.
63. As the History tab, I want stable order under every sort, so that offset paging never repeats or drops a row.
64. As the History tab, I want one request that returns the total and every Kind and Status count, so that the bar's numbers come from one place.
65. As the History tab, I want a spread request shaped like the Logs spread, so that the same chart draws it.
66. As an Account, I want none of these to read another Account's Artifacts, so that History stays mine.
67. As the operator, I want none of these to open a payload table, so that History stays cheap.

## Implementation Decisions

### Backend

- **One read model grows: the Artifact list.** Its four legs and their filters
  (kind, search, starred, status) are shared by three routes: the list, the
  counts and the spread. No route re-implements a leg.
- **The list** keeps its path, its bare-array response and its newest-Written
  default, so its existing callers (the open tabs' Artifact lookup and every
  Playwright mock of it) are untouched. It gains:
  - `moment`: `written` (default) or `window`.
  - The Time bound as the Logs list takes it: `mode`, `start`, `end`, validated
    and resolved exactly as the Logs bound is (the shared bound query model and
    `resolve_log_bound`).
  - `sort`: `written` (default) or `window`, and a direction, newest first by
    default.
- **The time filter.** Written: the leg's Written moment (a Tag run's
  `created_at`, everything else's `timestamp`) is inside `[start, end)`.
  Window: overlap with the frozen Scope's window, which never matches an
  Artifact without one. From the prototype:

  ```python
  if moment == "written":
      timestamp >= start;  timestamp < end          # either end may be open
  else:  # window: overlap
      scope.end > start;   scope.start < end        # scope.start/end from the frozen Scope
  ```

- **Sort.** `written` sorts on the Written moment, `window` on the frozen
  Scope's window start; a missing window sorts last in both directions. Every
  order ends with the `id` tiebreak. Under the default sort the per-leg
  `limit` that turns four sorts into index scans stays; under any other sort
  or any bound it may be dropped if the leg cannot use it.
- **Counts: a new route**, `GET /data/artifacts/counts`, taking the same
  filters as the list (not sort, not paging). One statement over the four legs
  under search, starred and the time filter, grouped by kind and status; the
  facets are summed from the groups. Each Kind is counted under every filter
  but Kind; each Status under every filter but Status; the total under all of
  them. Status means what the list's status filter means: Failed is a
  Summary's state only, Pending a Summary's or a Tag run's. The response,
  from the prototype:

  ```ts
  type ArtifactCounts = {
    total: number                                // under every filter
    kinds: Record<ArtifactKind, number>          // under every filter but Kind
    kindsAll: number                             // "All kinds"
    statuses: Record<"failed" | "pending", number> // under every filter but Status
    statusesAll: number                          // "Any status"
  }
  ```

- **Spread: a new route**, `GET /data/artifacts/spread`, taking kind, search,
  starred, status, `moment` and the zoom (`lo`, `hi`), never the time bound
  itself. It bins the Written moment, or the window start under `window`
  (an Artifact with no window is left out), with the shared spread bars,
  exactly as the Logs spread does, and answers the Logs spread's response
  shape (`total`, `min`, `max`, `median`, 32 `bins`).
- **Both new routes follow the house rules**: response models in the
  artifacts schemas, the tenancy seam on every leg (which the shared legs
  already carry), a route inventory entry, no payload table, and the
  generated client regenerated. The counts and spread responses are closed
  models with every field required, so the generated client's types are used.

### Frontend

- **`FilterBar`, a shared shell lifted out of the Directory bar**: a search
  slot, a wrapping controls row, a footer, and the phone's "Filters and sort"
  sheet with its active-count button. The Directory bar is rebuilt on it with
  no visible change; History is built on it. The Posts bar moves onto it later
  (out of scope).
- **History's controls**, in order: the search box (the Directory's look);
  Kind and Status as single-choice inline segments (`TgInlineChoice`), each
  label carrying its count, a zero count dimmed but clickable; Starred as the
  Channels bar's on/off pill (`BarToggle`); the moment switch (Written |
  Window) then the time filter (`TimeBoundBar` with open ends, labelled by the
  moment); the shared `SortPicker` (Written | Window start, with direction).
  The footer holds the total, the sort in words and, at its right end, the
  Compact grid pill (the Posts tab's look).
- **The spread** is drawn inside the time filter's popover with the shared
  `Spread` and its zoom, as the Logs spread is, but with History's noun
  ("artifacts", or "window starts" under Window). Clicking a bar sets a Fixed
  bound on it (the shared `barBound`).
- **URL state.** `useHistoryStatusParam` becomes one `useHistoryParams` that
  reads and writes Kind, Status, the time filter (in the shared Time bound
  text form, ADR-033), its moment, the sort and its direction, Search and
  Starred, all validated in the workspace search. `UIContext` loses
  `historySearchQuery` and `starredOnly`; the command palette's History search
  field and starred-only command go through the new hook. Compact grid is a
  per-session flag (`useSessionFlag`), default off.
- **Queries.** The list stays an infinite query, now keyed on every filter, the
  moment and the sort; the counts and the spread are plain queries keyed the
  same way under the `artifacts` prefix, so the existing invalidation after a
  star, note, flag or delete refreshes all three.
- **The card** is one component for all four kinds, as today, with a `compact`
  mode. Its parts, top to bottom: header (kind icon tinted per kind: Summary
  sky, Chat violet, Tag run orange, Discovery teal; status badge; flag chips;
  Written time); the channel line (first three, then a `+N` chip, full list as
  a tooltip, search matches first); the plain title; the window line with the
  "Use this Scope" icon button; the acted-by line; the note; the footer
  (detail, Star, Note, "⋯"). Compact drops the window line, the acted-by line
  and the note text, and shows icon-only actions.
- **Plain title** is a pure function: strip markdown emphasis and code marks
  and leading heading marks, then leading emoji and whitespace. From the
  prototype:

  ```ts
  text.replace(/\*\*|__|`|^#+\s*/g, "")
      .replace(/^(?:\s|\p{Extended_Pictographic}|️)+/u, "")
      .trim()
  ```

- **Search marks** reuse the Posts tab's `highlightText` in the channel line,
  the title and the note, always on while the search is non-blank. Channel
  order under a search is a pure function: matches first, each part in Scope
  order.
- **"Use this Scope"** reuses the hook the current scope line uses; only its
  presentation shrinks to an icon button with the label as its tooltip.
- **The note editor** is a `BarPopover` anchored to the card's note button,
  replacing the box under the list. Save and delete keep today's writes and
  toasts.
- **Day grouping** is a pure function of the loaded rows by local calendar day
  of Written ("Today", "Yesterday", then a short date with the year only when
  not this year), used only while sorted by Written and not in Compact grid.
- **Unchanged behaviour carried over**: the auto-regenerate refusal, delete's
  confirmation dialog (its copy and its clamp), the empty state's two texts,
  infinite scroll, opening an Artifact, the `min-w-0` that keeps a 1,722-channel
  card inside the panel, right-to-left text (`dir="auto"`).
- **What goes**: History's own kind chips, status chips, search controls and
  note box, and any helper only they used.

## Testing Decisions

- **A good test** checks behaviour seen from outside the seam: what a route
  answers for a request, what the tab shows and does after a click. It never
  asserts a query's text, a component's internals or a hook's state.
- **Seam 1: the backend HTTP routes.** Through the test client against the
  test database (as the existing artifact tenancy and Logs spread tests do):
  - A Written bound keeps exactly the Artifacts Written inside `[start, end)`;
    Live and Fixed both; open ends.
  - A Window bound keeps Artifacts whose window overlaps, including one that
    starts before the bound and ends inside it, and never one with no window.
  - Both sorts in both directions; a missing window last either way; three
    pages walked back to back return every Artifact once.
  - Every count equals the length of the list its filters would show: each
    Kind under every filter but Kind, each Status under every filter but
    Status, the total under all, including with a time filter on.
  - The spread's total, min, max and median; bars summing to the total; a zoom
    binning only its range; Window binning window starts and leaving out
    Artifacts without one.
  - Another Account's Artifacts appear in none of the three routes (extend the
    artifact tenancy scoping test).
  - None of the three routes opens a payload table (extend the artifact list
    payload cost guard).
  - The route inventory and the generated client are updated, and their
    guards pass.
- **Seam 2: the History tab.** Render tests (bun and testing-library) against
  a mocked API, in the style of the existing History view and Logged spread
  tests, plus the pure functions tested directly:
  - The bar: each choice's count, a zero dimmed but clickable, the moment
    switch relabelling the time filter, the footer total and sort words, the
    Compact grid pill in the footer.
  - The URL: each filter, the time filter, its moment and the sort round-trip
    through `useHistoryParams`; the command palette's History search and
    starred-only commands set the same state.
  - A card: tinted kind icon, flag chips only while on, the first three
    channels and the count, matches moved first, the plain title (including a
    Failed card's sentence), the "Use this Scope" icon, no repeated status in
    the footer, the "⋯" menu's three items, the note popover's save, Compact's
    reduced card, the search marks.
  - Day headings only under the Written sort and not in Compact grid.
  - The spread in the popover: its noun under each moment, and a bar click
    setting a Fixed bound.
  - Pure functions: plain title, channel order under a search, day grouping,
    the URL parameters' parse and print.
- **One mocked Playwright spec** drives the whole tab with every route stubbed:
  filter by kind and status, open the time filter and click a bar, see the list
  narrow and the total change, sort both ways, open the phone sheet. Run it with
  one worker (the e2e convention). The existing open-artifact spec keeps
  guarding the wide card.
- **The Directory bar's tests** must pass unchanged after it moves onto
  `FilterBar`; that is the guard that the lift changed nothing.
- **Mutation-test the new guards** before trusting them: break the overlap
  rule, the facet rule and the tiebreak once each and watch the backend tests
  go red.
- A new branching component needs a render test or the CRAP ratchet fails.

## Out of Scope

- Retry on a Failed card (a write the prototype could only stub).
- Moving the Posts bar onto `FilterBar`.
- A server-cut snippet for search matches the card cannot show (deep in a
  Summary's text, or the model name).
- Any special range for the spread's outliers; zoom handles them.
- Keyboard mode on History, which is KM-03 and lands after this, its file
  references moved to the new list.
- The prototype's table and day-row list forms, which lost.

## Further Notes

- KM-03 (`.scratch/keyboard-mode/issues/03-discover-history-acting-on-many.md`)
  is written against today's History; after this lands, its references move
  to the new card list and its `*` and `n` keys press Star and Note.
- The prototype's numbers on a real Account (56 Artifacts: Summary 51, Chat 1,
  Discovery 4; Pending 2) are what the counts should look like; the Window
  spread there runs from late 2023 because of one 1,000-day Discovery report.
- `docs/agents/prototyping-with-live-data.md` describes how the prototype ran;
  nothing of its setup belongs in the real code.
