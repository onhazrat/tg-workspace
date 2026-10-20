# Spec: One time editor for every time filter

Status: ready-for-agent

Plan and decisions: `docs/time-bound-editor-plan.md`. Architecture:
`docs/migration/ADR-033-one-time-editor.md`. Prototype: variant 1
(`?variant=1`) on branch
[`prototype/time-bound-editor` @ 10b8c6af](https://github.com/onhazrat/tg-workspace/tree/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19),
notes and a file-by-file map in `prototype.md` beside this file. Vocabulary
(Analysis window, Live window, Fixed window, Duration, End gap, Time bound,
Condition, Channel filter, Directory filter, Post filter, Directory entry,
Reference, Follow) is `CONTEXT.md`'s. Ticket ids carry the prefix `TB`.

## Tickets

Five tickets in `issues/` beside this file. After TB-01, TB-02 and TB-03 run
in parallel.

| Id | Ticket | Blocked by |
|---|---|---|
| TB-01 | One editor, Directory Time bounds on it (`issues/01-one-editor-directory-time-bounds.md`) | None |
| TB-02 | Cited by your channels as a Time bound (`issues/02-cited-by-time-bound.md`) | TB-01 |
| TB-03 | Channel Time bounds and Filters menu symbols (`issues/03-channel-time-bounds-menu-symbols.md`) | TB-01 |
| TB-04 | Zoom on every spread (`issues/04-zoom-on-every-spread.md`) | TB-03 |
| TB-05 | Logs filtered by a Time bound on the server, with a spread (`issues/05-logs-time-bound-on-server.md`) | TB-01, TB-04 |

Each ticket names the prototype files to read, pinned to 10b8c6af, through
`prototype.md`. A ticket closes as `docs/agents/issue-tracker.md` says.

## Problem Statement

An Account filters by time in five places and meets four different editors.
The Posts tab edits the Analysis window with Live and Fixed, four fields and
shortcuts. The Directory edits a Time bound with its own Live and Fixed fields
and "ago / from now" selects. Cited by your channels only takes a whole number
of days from a few chips. The Logs tab only takes two calendar days, the last
one counted whole. The Channels tab has no time filter at all: "Days followed"
and "Days since last update" are numbers, measured from when the page loaded,
so "followed in the last day" has to be written as "Days followed ≤ 1".

Each editor answers "what does Live mean", "can an end be left open" and
"which end is included" its own way. Learning one teaches nothing about the
next, and every fix lands in one place only.

The spreads drawn over bounds cannot be looked into. A Directory moment such
as Last post runs from 2015 to today with nearly every entry in the last bar,
and Subscribers runs from 1 to 20 million: the part that matters is one bar
wide. The Posts tab's time chart can zoom; nothing else can.

The Logs tab's time filter only sees the newest page of each log type, so
"logged in the last 30 days" silently misses anything older than that page.

## Solution

Every time filter is a Time bound edited with the Posts tab's Analysis window
editor: the Live, Fixed mode switch, Start, End, Duration and End gap, and the
elapsed shortcuts. The Posts tab's own editor looks and behaves exactly as it
does today. Elsewhere the same editor sits in a condition menu (Directory,
Channels) or behind the same collapsed line and popover (Logs), and turns on
what that filter needs: an open end, an End ahead of now, No value.

Cited by your channels becomes a Time bound on when the citing Posts were
published. The Channels tab gets seven moments to bound (Followed, Last
update, Sync start, Oldest stored post, Next regular sync, Next dynamic sync,
Discovered) in place of its two day counts. The Logs tab's two calendar days
become a Time bound, which the server applies to the whole log.

Every spread a bound is drawn over gets the Posts time chart's zoom buttons,
and the Channels moments get a spread of their own. Every row of the Posts
and Channels Filters menus carries a symbol, as the Directory's condition menu
does.

## User Stories

### The one editor

1. As an Account, I want every time filter to use the same editor as the Posts tab's Analysis window, so that learning it once teaches me all of them.
2. As an Account, I want the Posts tab's Analysis window editor to look and behave exactly as it does today, so that nothing I rely on there moves.
3. As an Account, I want Live and Fixed to mean the same thing in every time filter, so that a Live bound always moves with the clock and a Fixed one never does.
4. As an Account, I want Start, End, Duration and End gap in every time filter, so that I can say "the last 3 days" as a Duration instead of computing a date.
5. As an Account, I want the elapsed shortcuts (30m, 1h, 24h, 7d, 30d) when I focus Duration or End gap in any time filter, so that common spans are one click.
6. As an Account, I want to leave Start or End empty to leave that end open, so that "since last month" needs no End.
7. As an Account, I want a negative End gap (`-2d`) to end a Live bound two days from now, so that I can find Channels whose next sync is due soon.
8. As an Account, I want "ahead of now" offered only where a moment can be in the future, so that the Logs and Cited by your channels editors do not invite a meaningless bound.
9. As an Account, I want No value as a third segment of the mode switch (Live | Fixed | No value), so that finding entries with no moment at all is one of the same choices.
10. As an Account, I want the fields hidden while No value is chosen, so that I am not asked for a span that does not apply.
11. As an Account, I want a typed value that does not parse to show the same error the Posts editor shows, so that I know what to fix.
12. As an Account, I want an End before the Start refused with a message rather than swapped, so that the bound is never silently something I did not type.
13. As an Account, I want an empty Time bound to read "Any time", so that I can see at a glance that it filters nothing.
14. As an Account, I want the editor on a phone to open as a bottom sheet where the Posts editor does, so that it fits the screen.

### Directory

15. As an Account browsing the Directory, I want a moment's Time bound (Last post, Found and the others) edited with the one editor, so that the Directory works like the Posts tab.
16. As an Account, I want the moment's spread, its No value count and Add or Update with a live count of the Channels it keeps, as today, so that the new editor loses nothing.
17. As an Account, I want clicking a bar of the spread to set a Fixed bound over that bar, so that I can pick a period by pointing at it.
18. As an Account, I want existing Directory links with Time bounds to open unchanged, so that shared links keep working.
19. As an Account, I want Cited by your channels to take any Time bound, not only a whole number of days, so that I can ask for citations from last month only.
20. As an Account, I want Cited by your channels to apply its window to when the citing Posts were published, so that the window means what it says.
21. As an Account, I want existing links with `mine:14d` to keep working as "from 14 days ago", so that saved Directory views keep their meaning.
22. As an Account, I want "Why it's here" to state the window in the same words as the chip ("cite it from 2 weeks ago"), so that the panel and the filter read alike.
23. As an Account, I want the "Why it's here" count to use the same window as the Condition, so that the panel counts what the filter counts.

### Channels

24. As an Account on the Channels tab, I want to bound when I followed a Channel, so that I can review what I followed this week.
25. As an Account, I want to bound when a Channel's name, photo and counters were last refreshed, so that I can find Channels whose details are stale.
26. As an Account, I want to bound a Channel's sync start, so that I can find Channels synced only from a recent point.
27. As an Account, I want to bound a Channel's oldest stored Post, so that I can find Channels with shallow history.
28. As an Account, I want to bound when a Channel's next regular sync and next dynamic sync run, so that I can see which Channels sync soon.
29. As an Account, I want to bound when the Post that led me to a Channel was published, so that I can review recent discoveries.
30. As an Account, I want No value on each Channel moment, so that I can find Channels with no next sync scheduled, for example.
31. As an Account, I want the Channels moments under a Times heading in the Filters menu and in the filter row's picker, so that they are found where the numbers are.
32. As an Account, I want the "Days followed" and "Days since last update" numbers gone, so that there is one way to ask about time.
33. As an Account, I want a Live Channel bound to keep moving while the tab stays open, so that "followed in the last hour" stays true an hour later.
34. As an Account, I want a Channel moment's spread with zoom, so that I can see when my Follows clumped together.
35. As an Account, I want clicking a bar of a Channel moment's spread to keep exactly the Channels the bar counts, so that the bar and Add agree.
36. As an Account, I want each Channel Time bound to read as a chip ("Followed from 30 days ago to now") and to print into the URL, so that I can share the view.

### Logs

37. As an Account on the Logs tab, I want the time filter to be the Posts tab's collapsed line and popover, labelled Logged, so that it works like the Analysis window.
38. As an Account, I want a Logged bound to be Live, so that "the last 24 hours" stays the last 24 hours while I watch.
39. As an Account, I want a Logged bound to include its Start and exclude its End, to the minute, so that it agrees with every other Time bound.
40. As an Account, I want a Logged bound to reach every entry of that log, not only the newest page, so that "the last 30 days" finds what is older than the page.
41. As an Account, I want a spread of when the entries of a log were logged, with zoom, once the server applies the bound, so that I can see when failures clustered.

### Spreads and zoom

42. As an Account, I want Zoom in and Zoom out buttons over every spread a bound is drawn on, the same buttons the Posts time chart has, so that one control does one thing everywhere.
43. As an Account, I want a spread to start whole and zoom in to a third of what it shows per click, so that I can narrow in steps.
44. As an Account, I want zoom to centre on my bound, or on the median when I have none, so that I land where my data is.
45. As an Account, I want Zoom out to return to the whole spread and then disable, so that I cannot get lost.
46. As an Account, I want zoom to stop after six steps, so that bars never get thinner than the data can fill.
47. As an Account, I want a zoomed spread to keep the scale it was first drawn on, so that a chart does not change shape between two clicks.
48. As an Account, I want a zoomed spread's bars recounted over the zoomed range, so that zooming shows more detail rather than a cropped picture.
49. As an Account, I want a time spread to show the time of day once it shows less than three days, so that its bars are told apart.
50. As an Account, I want the Posts tab's number filters (Views, Estimated views, Channel posts) to zoom, so that a heavily skewed Views spread can be read.
51. As an Account, I want the Channels numbers (Subscribers, Reach and the rest) to zoom, so that the same control works on the Channels tab.
52. As an Account, I want zoom to reset each time I open an editor, so that every opening starts whole.

### Menus

53. As an Account, I want each row of the Posts Filters menu to carry the symbol its chip carries, so that the menu and the row read alike.
54. As an Account, I want each row of the Channels Filters menu to carry a symbol (`#` for a number, a clock for a time), so that it matches the Directory's menu.
55. As an Account, I want a Channels number chip to carry `#` as the Directory's does, so that the same kind of Condition looks the same in both tabs.

### Links and compatibility

56. As an Account, I want a Channel Time bound to print in the same text form as a Directory Time bound (`followed_at -30d..now`), so that one syntax means one thing.
57. As an Account opening an old Channels link that bounds `days_followed` or `days_since_update`, I want the tab to open unfiltered rather than broken, so that the page still works.

## Implementation Decisions

- **One editor, three pieces.** The Analysis window editor is split into the
  editor body (mode switch, four fields, elapsed shortcuts), the collapsed line
  with its popover or bottom sheet, and the zoom buttons. Each is reused as is;
  no surface grows its own copy.
- **The editor reads through a source.** The source has exactly the shape of
  the Scope fields the editor already reads, so the Scope is the default source
  and the Posts editor needs no change in wiring. A Time bound draft is the
  other source. Type shapes from the prototype:

  ```ts
  // The fields the editor reads (prototype: WindowEditorSource).
  type WindowEditorSource = Pick<
    ScopeContextType,
    "mode" | "setMode" | "applyValue" | "draftText" | "setDraft" | "commitDraft" | "errors"
  >

  // A Time bound as the editor edits it (prototype: TimeBound).
  // [start, end), either end open; a Live end is signed ms from now.
  type TimeBound = { mode: "live" | "fixed"; start?: number; end?: number }

  // What a filter turns on (prototype: TimeBoundOptions).
  type TimeBoundOptions = { openEnds?: boolean; ahead?: boolean }
  ```

- **The Time bound source** maps the four fields onto a bound: Start and End
  are instants in both modes; Duration sets Start from End (or End from Start
  when End is open, or both from now when both are open); End gap moves End and
  keeps the Duration. A blank Start or End opens that end when `openEnds` is
  on. A leading `-` on End gap means ahead of now when `ahead` is on, and is
  refused otherwise. Drafts commit on blur, on Enter, or after the Posts
  editor's debounce, with the Posts editor's error messages.
- **No value is an editor option**, passed as `{ on, onChange }`; with it the
  mode switch shows a third segment and the fields hide. The Posts editor never
  passes it.
- **Two wrappers.** The bar (collapsed line and popover) for Logs. The embedded
  form for the Directory and Channels condition menus: the moment's name and
  description, its spread, the editor, and Add or Update with a live count.
  Directory and Channels apply on Add or Update; Logs and Posts on blur or
  Enter.
- **Where the options apply.** Directory moments: open ends, ahead, No value.
  Channel moments: open ends, ahead, No value. Cited by your channels: open
  ends. Logs: open ends.
- **One text form.** The Directory's Time bound printer and parser (Live ends
  as signed offsets with `now`, Fixed ends as UTC instants, `..` between, `=
  none`) and its chip wording become one shared module used by the Directory
  and Channel filters.
- **Channel moments** and their URL keys: Followed `followed_at`, Last update
  `updated_at`, Sync start `sync_start_at`, Oldest stored post
  `oldest_post_at`, Next regular sync `next_regular_sync_at`, Next dynamic sync
  `next_dynamic_sync_at`, Discovered `discovered_at`. A Channel filter Time
  bound Condition carries the moment, mode, start, end and No value, and is
  evaluated in the browser against the Channel's own field. Channels with no
  value fail every bound on that moment.
- **A Live Channel bound re-filters on the Scope's server minute tick**, not on
  the browser clock at render.
- **The two day counts are removed** from the Channels metrics. A link that
  bounds them no longer parses; the tab ignores a filter it cannot read, as it
  does today. They are not translated.
- **Cited by your channels, API contract.** The Condition takes `mode`,
  `start`, `end` (a Time bound, either end open, no No value) in place of
  `days`, applied to the citing References' timestamp as `[start, end)` with a
  Live end relative to the request's now. The "Why it's here" request takes the
  same three fields in place of `days`. `days` is removed from both, and the
  generated client is regenerated. The text form is `mine:<start>..<end>`;
  `mine:14d` still parses, as Live from 14 days ago with an open End, and
  `mine:all` as no window.
- **Logs on the server (TB-05).** Each log list endpoint takes an optional Time
  bound and applies it in SQL before paging, as the text search already is.
  The browser stops filtering by time.
- **Logs spread (TB-05).** A read of when a log's entries were logged, binned
  by the server over the Time bound's surroundings, with zoom.
- **Zoom, contract.** `/data/directory/distribution` and
  `/data/posts/value-histogram` take an optional `lo` and `hi` (bin only that
  range) and keep the whole spread's scale while zoomed; the value histogram
  request carries the scale it was first drawn on. Whole-spread fields
  (minimum, maximum, median, No value count) stay whole-spread. Channels
  numbers and moments are binned in the browser from the Channels already
  loaded.
- **Zoom, rule.** A spread starts whole. Zoom in shows a third of the shown
  span, centred on the bound (its middle, or its one end) or else on the
  median, clamped inside the whole spread; on a log scale the thirds are taken
  in log(1 + x). Zoom out triples the span around its middle; at the whole
  spread it is disabled. Six steps at most. Zoom state belongs to the open
  editor and resets on reopen.
- **A clicked time bar** sets a Fixed bound rounded out to whole minutes, its
  End one minute past the bar's newest value, so the bound keeps every value
  the bar counts.
- **Captions.** A time spread shows dates, and the time of day once the shown
  span is under three days.
- **Menus.** A Filters menu row draws its symbol as the Directory's condition
  menu does: views measures an eye, counts `#`, times a clock. Channels number
  chips carry `#`.

## Testing Decisions

A good test drives the feature from the outside: it renders what the Account
sees or calls what the browser calls, and asserts what comes back. It never
asserts which internal function ran. Four seams, highest first, each with
prior art to copy:

- **The one editor, rendered.** Render the embedded editor and the bar over a
  Time bound, type into the fields, choose Live, Fixed or No value, use a
  shortcut, and assert the bound emitted and the text each field shows: open
  ends, a negative End gap accepted only with `ahead`, drafts, errors, "Any
  time". Prior art: `AnalysisWindowControl.test.tsx`,
  `DirectoryTimeEditor.test.tsx`.
- **The Posts freeze.** `AnalysisWindowControl.test.tsx` keeps every
  assertion (imports may change). TB-01's first commit, on unchanged code, adds
  a markup snapshot of the collapsed Analysis window line and its open popover
  (desktop, and the phone sheet); nothing after it updates that snapshot. A
  Playwright screenshot pair is a useful local check but is not committed: CI
  renders on another platform, so a committed screenshot would fail there.
- **Filter logic.** Text form round trips and evaluation for the Directory,
  Channel and Logs filters: `mine:14d` and `mine:-2w..`, every Channel moment
  key, `days_followed` no longer parsing, `[start, end)`, No value, and a Live
  Channel bound changing its answer when the minute moves. Prior art:
  `directory-filter.test.ts`, `channel-filter.test.ts`, `lib/logs/filters.test.ts`.
- **A spread with zoom, rendered.** Render an editor with its spread, press
  Zoom in and Zoom out, and assert the range requested (server spreads) or the
  bars drawn (browser spreads), the kept scale, centring on the bound or the
  median, the six-step stop, the disabled Zoom out at whole, and that a clicked
  bar's count equals Add's. Prior art: `ChannelMetricEditor.test.tsx`,
  `DirectoryBoundEditor.test.tsx`.
- **The HTTP API.** Directory `list`, `count` and `why` with a Cited by your
  channels Time bound (Live and Fixed, each end open), `days` refused;
  `distribution` and `/posts/value-histogram` with `lo` and `hi` and the scale
  kept; the log list endpoints with a Time bound, applied before paging. Prior
  art: `test_directory_browse.py`, `test_post_value_histogram.py`,
  `test_stats_logs.py`.
- Mutation-test every new guard before trusting it: break the rule, watch the
  test fail, restore it.

## Out of Scope

- A spread on Cited by your channels (citing Posts over time). It needs a new
  server read, and its window is almost always "the last N days".
- A "Last post" Channel moment, which needs a timestamp the Channels stats do
  not carry.
- Translating old `days_followed` and `days_since_update` links.
- Any change to the Posts tab's Analysis window editor, its time chart or its
  zoom.
- Moving the Logs tab's other filters (status, bot, model, channel) to the
  server.

## For implementers

Written for `/implement-spec`: one integration branch, one worktree and branch
per ticket, each ticket built test-first. Practical rules, each of which has
cost a session before.

- **The task graph.** TB-01 first, alone. Then TB-02 and TB-03 in parallel.
  Then TB-04 (after TB-03), then TB-05 (after TB-04).
- **Port what the ticket names, rewrite the rest.** Each ticket's context
  pointers link the prototype files at 10b8c6af that it should port. Port them
  out of `time-bound-prototype/` with the `?variant=` gate dropped, and write
  the tests first. Never port the variant switch, its app-shell and
  workspace-search wiring, the Vite proxy entries or the prototype API script.
  `prototype.md` lists what the prototype got wrong; the tickets say the right
  thing.
- **Set up each worktree with `bash scripts/worktree-setup.sh`.** It links the
  root `.env`, runs `bun install`, and creates and migrates a private pytest
  database (`app_test_<worktree>`). Run `--teardown` when the worktree goes.
  Two pytest runs on one database truncate each other's rows and fail with
  hundreds of misleading foreign-key errors.
- **Branch from the integration branch, fetched fresh.** A GitHub merge does
  not move the local `origin/main`.
- **The generated client conflicts between parallel tickets.** TB-02 runs
  beside TB-03 and TB-04, and TB-02, TB-04 and TB-05 each change a schema.
  Never hand-merge `openapi.json` or the generated client: take either side,
  then regenerate on the merged tree and commit that.
- **After a route or response-model change** (TB-02, TB-04, TB-05), regenerate
  the client, grep `frontend/tests` for that route's `page.route` mocks (only
  CI's Playwright catches a stale mock), and run both the build typecheck and
  `bun run typecheck:tests`.
- **A new branching component needs a render test**, or CI's frontend CRAP
  ratchet fails. Check it locally before pushing.
- **Handler docstrings ship in the public client.** Keep ticket ids in a `#`
  comment above the route, never in its docstring.
- **Playwright runs serially** (one worker), from the worktree's `frontend/`.
  A backend route change needs the backend container rebuilt before e2e; a
  stale API fails in ways that look like frontend bugs.
- **Never restart the shared database** (`docker compose up --build db`)
  while another worktree is testing.
- **Commits on a ticket branch need no signature**; the integration branch
  lands on `main` by squash merge. The typos hook rejects plural SQL keywords;
  check that a commit actually landed.
- **Staging is read-only.** The prototype's API and its database role are not
  part of this work.
- **Close a ticket** as `docs/agents/issue-tracker.md` says: `Status: done` and
  a dated comment naming the branch and the merge commit.

## Further Notes

- Checked on staging data on 2026-10-20 through the prototype: the Directory
  Time bound (Last post, 3 days: 42,846 Channels), Cited by your channels from
  2 weeks ago (617 Channels, 22 citing Posts for one entry), Channels Followed
  in 30 days (332 of 553), Logs in 3 days (24 entries down to 1), and zoom on
  Subscribers (1 to 20.2M zoomed to 2.59K to 15.6K), Last post, Views and the
  Channels numbers.
- With a Posts number editor open, its histogram is asked for again every few
  seconds while a sync adds Posts. That is `main`'s behaviour (every Posts read
  refreshes when a sync lands) and not part of this work.
- TanStack Router reads `?variant=1` as a number. Any new text search
  parameter must accept a number too.

## Comments

- 2026-10-21: code-review fixes for the integration branch are on `claude/tb-review-fixes` (one Time bound resolver, query-model validation for the Logs routes, one binning helper, shared spread pieces in `components/Spread.tsx`, Directory bars rounded out to whole minutes).
