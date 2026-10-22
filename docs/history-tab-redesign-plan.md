# History tab redesign: plan

Status: grilled and prototyped 2026-10-22; the prototype's variant 1 is final.
Spec: `.scratch/history-tab-redesign/spec.md` (ready-for-agent, no tickets).
Glossary: **Written** and the reworded **History** in `CONTEXT.md`. Prototype:
[`prototype/history-tab-redesign` @ ac9c6255](https://github.com/onhazrat/tg-workspace/tree/ac9c6255378a4e81894b761d71acb1f0ec9d3c26) (see below).

## Goal

History looks and works like the Channels, Posts and Directory tabs, built
from their shared bar kit rather than its own chips and inputs.

## The bar

1. **A shared `FilterBar` shell** lifted out of `DirectoryBar`: a search slot,
   a wrapping controls row, a footer, and the phone's Filters and sort sheet.
   The Directory and History use it. Moving the Posts bar onto it is a
   follow-up, with the Posts tests as its guard. No `FilterRow`: History's
   filters are flat and single-valued.
2. **Controls, in order**: the search box (channels, titles and notes); Kind
   and Status as `TgInlineSegments`, each with "All kinds" / "Any status";
   Starred as a `BarToggle`; the time filter; the `SortPicker`. The Compact
   grid pill sits at the footer's right end, beside the count it affects, so
   the controls fit one row at 1280 px.
3. **Each Kind and Status choice carries a count**, taken under every other
   filter, so a count says what picking it would show ("Summary 51",
   "Pending 2"). Status and Kind stay independent: a Failed Chat matches
   nothing, and the counts say so before the click. A choice counting zero
   is dimmed, never disabled.
4. **The time filter** is a `TimeBoundBar` (`openEnds: true`, as Logs uses
   it) with a switch in front of it choosing what it bounds:
   - **Written**: the Artifact's Written moment falls in the bound.
   - **Window**: the Artifact's frozen Analysis window overlaps the bound,
     which answers "which runs covered last Tuesday". A Scope with no window
     never matches.
   Its popover draws a spread (the Logs tab's `Spread`, TB-05): Written
   instants, or window starts under Window, taken under every History filter
   but the time filter, with zoom and a median. The bars count "artifacts"
   or "window starts". Clicking a bar sets a Fixed bound on it. Under Window
   a bar's count can be below the list's, because a window starting earlier
   can still overlap; that is the overlap rule, not a defect. Outliers get no
   special range: zoom handles a long tail, as in the Directory and Logs.
5. **Sort** on Written (the default, newest first) or the Analysis window's
   start, with the direction arrow. A Scope with no window sorts last either
   way.
6. **The footer** shows the total under every filter ("56 artifacts") and
   the sort in words ("Sorted by Written, newest first").
7. **Every History filter is in the URL**: Kind, Status, the time filter and
   its moment, Sort, Search and Starred. `useHistoryStatusParam` becomes
   `useHistoryParams`, and `UIContext` drops `historySearchQuery` and
   `starredOnly`; the command palette (`useCommandRegistry`,
   `channel-ops.ts`, the starred-only command) goes through the new hook.
   The Compact grid is a session flag, as the Posts tab's is, but starts off:
   History's full card carries the window and the note that are its point.

## The list: cards

Cards won against a Directory-style table and one-line day rows. They are
the only form whose actions work on touch, and the table needed a card
fallback on phones anyway.

- **One column under day headings** ("Today", "Mon, Oct 19"), grouped by
  Written. A heading carries no count: on a paged list it would count only
  the loaded rows. A grid under day headings left half of most days
  empty. The headings show only while sorted by Written; under any other
  sort the cards are one ungrouped list.
- **A card, top to bottom**: the kind (icon tinted per kind: Summary sky,
  Chat violet, Tag run orange, Discovery teal, clear of the status colours),
  the status badge (Failed ×N, Generating, Awaiting response), the Summary
  flag chips while on ("Auto-regenerates", "Auto-publishes") and the Written
  time; the first three channels and a "+N" chip, the full list on hover;
  the title as plain text, without markdown marks or a leading emoji (a
  Failed card keeps its retry sentence); the Analysis window line, ending in
  a quiet "Use this Scope" icon button; the acted-by line; the note.
- **The footer**: the one detail line (posts, messages, candidates), left
  blank when the header's badge already says Failed or Awaiting response;
  Star, Note and a "⋯" menu holding Auto-regenerate, Auto-publish and
  Delete. Delete keeps its confirmation.
- **Search matches are marked** while a search is typed (not "highlighted":
  that is Keyboard mode's **Highlight**), with the
  Posts tab's `highlightText`, in the channel line, the title and the note.
  Matching channels move to the front of the channel line, so a channel match
  is never hidden in the "+N". A match the card cannot show (deep in a
  Summary's text, or the model) finds the card unmarked; no server snippet,
  which would detoast every searched Summary's text.
- **The note is edited in a `BarPopover`** anchored to the card's note
  button, not in a box under an infinitely scrolled list.
- **Compact grid**: smaller cards in an auto-fill grid (the Posts tab's
  `minmax(22rem, 1fr)`), with no day headings, no window line, acted-by line
  or note text, and icon-only actions.

## Backend

`/data/artifacts` grows, rather than gaining siblings:

- **The time filter**: `moment` (`written` | `window`) and the Time bound as
  `mode`/`start`/`end`, resolved as `resolve_log_bound` resolves the Logs
  bound. Written bounds each leg's `timestamp` (a Tag run's `created_at`);
  Window tests overlap on the frozen Scope's `start` and `end`.
- **Sort**: `sort` (`written` | `window`) and a direction. Every order keeps
  the `id` tiebreak, because offset paging depends on it.
- **Counts on their own route**, `GET /data/artifacts/counts`: the total,
  each Kind under every filter but Kind, and each Status under every filter
  but Status, from one statement grouped by kind and status (the
  prototype's `proto-counts`). The list stays a bare array, because
  `findTabArtifacts` and the route's Playwright mocks read it as one.
- **A spread route**, `GET /data/artifacts/spread`, returning the Logs
  spread's shape: 32 bars, `total`, `min`, `max`, `median`, zoom by `lo` and
  `hi`, under every filter but the time filter.

The prototype served all of this from `backend/scripts/proto_history_api.py`
(on the prototype branch only)
on the list's own legs and filters, so the real version is the same SQL
moved into `services/artifacts.py`.

## Not in this effort

Retry on a Failed card, which is a write the prototype could only stub, and
moving the Posts bar onto `FilterBar`.

## Prototype

[`prototype/history-tab-redesign` @ ac9c6255](https://github.com/onhazrat/tg-workspace/tree/ac9c6255378a4e81894b761d71acb1f0ec9d3c26) is a sanitized
one-commit snapshot of the local prototype branch, on top of `main`, as
`docs/agents/prototyping-with-live-data.md` describes. The local branch's
commits, oldest first, which only this machine has: the three list
forms in the shared bar (530b1990), fixes from the browser check (c198d7b0),
the five card ideas (5d4d8593), dropping the losers and tinting kinds
(f8ccaf5c), the Compact grid (71637a0a), the Written spread (a3fe6c2b), the
bound and Sort on the list (263e519d), and totals, counts and the Window
moment (3fa23d98). Variant 0 is today's History; 5d4d8593 still holds the
table and day-row variants. The frontend ran against a deployment's API, and
`proto_history_api.py` read that deployment's database through a read-only
role for the spread, the filtered list and the counts. Star, note, the
Summary flags and delete were stubbed.

## As built

Where the build settled what the plan left open:

- **The URL keys** are `historyKind`, `historyStatus` (kept, so old links
  work), `historyQ`, `historyStarred`, `historyTime` (the Time bound text form,
  `-7d..`), `historyMoment=window`, `historySort=window` and
  `historyOrder=oldest`; a default is absent. They are kept on **every** tab,
  as the Directory's are, rather than on History only as `historyStatus` was:
  the palette sets History's search and Starred from any tab, and the old
  `UIContext` state survived a tab switch too.
- **The spread** is `LoggedSpreadView` with a `noun`, not a second view.
- **The total says "1 artifact"** in the singular.
- **The "⋯" trigger is a plain button**: `TgIconButton` with a tooltip wraps
  its button, so a Radix trigger's handlers never reach it.
- **KM-03's file references** still point at the old `HistoryView` and
  `ArtifactCardParts`; the list's adapter now belongs on `HistoryList`, and
  `*` and `n` press `CardActions`' Star and Note.

## Sequencing

This lands before KM-03. KM-03's file references then move to the new list,
so its keyboard adapter is written once, against the final shape.
