# One time editor: plan

Every time filter in the app is edited with the Posts tab's Analysis window
editor. Why is in ADR-033 (`docs/migration/ADR-033-one-time-editor.md`); the
terms are **Analysis window** and **Time bound** in `CONTEXT.md`.

Prototype: variant 1 on
[`prototype/time-bound-editor` @ 10b8c6af](https://github.com/onhazrat/tg-workspace/tree/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19),
switch with `?variant=1`. It was checked on staging data on 2026-10-20. Its code
is prototype code (no tests, prototype naming, a `?variant=` gate); fold the
decisions in, never the code as is.

## Decisions

### The editor

- One editor body, three pieces taken out of `AnalysisWindowControl.tsx`: the
  editor (`WindowEditor`, the mode switch, the four fields and the elapsed
  shortcuts), the collapsed line with its popover or bottom sheet
  (`WindowOverlay`), and the zoom buttons (`ZoomControls`).
- The editor reads and writes through a source with the shape of the
  `ScopeContext` fields it already uses (`mode`, `setMode`, `applyValue`,
  `draftText`, `setDraft`, `commitDraft`, `errors`). The Scope is the default
  source, so the Posts editor needs no wiring. A Time bound draft is the other
  source.
- **The Posts tab's Analysis window editor looks and behaves exactly as on
  `main`.** Its code may change. `AnalysisWindowControl.test.tsx` keeps its
  assertions, and a Playwright screenshot of the collapsed line and the open
  popover is taken on `main` before TB-01 and compared after.
- Two wrappers. **Bar**: the collapsed line and popover, for Logs. **Embedded**:
  inside a condition menu, with the moment's name, its description, its spread,
  and Add or Update with a live count, for Directory and Channels.
- A Time bound turns on what it needs. **Open ends**: clearing Start or End
  leaves that end open (Directory, Channels, Logs, Cited by your channels).
  **Ahead**: a negative End gap (`-2d`) ends after now (Directory and Channels
  only). **No value**: a third segment of the mode switch, Live | Fixed |
  No value, which hides the fields (Directory and Channels moments only).
- When an edit applies is the caller's: Directory and Channels on Add or
  Update, Logs and Posts on blur or Enter.
- An empty Time bound reads "Any time".

### Where it applies

| Surface | Moments | Notes |
|---|---|---|
| Posts | the Analysis window | unchanged |
| Directory | its six moments (DPF) | same URL text form as today |
| Cited by your channels | when the citing Posts were published | server-side Time bound, replaces `days` |
| Channels | seven moments, below | evaluated in the browser |
| Logs | when each entry was logged | Bar wrapper, label "Logged" |

- **Cited by your channels.** `DirectoryMineCondition` and `DirectoryWhyRequest`
  take `mode`, `start`, `end` in place of `days`, applied to
  `PostReference.timestamp` as `[start, end)` with a Live end relative to now.
  `days` is dropped from the API outright and the client regenerated. Old
  `mine:14d` links keep parsing, as Live from 14 days ago with an open End. The
  new text form is `mine:-2w..`. "Why it's here" reads the window in the chip's
  words ("cite it from 2 weeks ago"), not the bar's summary.
- **Channel moments**, with their URL keys: Followed `followed_at`, Last update
  `updated_at`, Sync start `sync_start_at`, Oldest stored post
  `oldest_post_at`, Next regular sync `next_regular_sync_at`, Next dynamic sync
  `next_dynamic_sync_at`, Discovered `discovered_at`. No "Last post": the
  Channels stats carry no timestamp for it.
- **The Channels day counts go.** `days_since_update` and `days_followed` leave
  `channel-metrics.ts` entirely. Old links that bound them no longer parse, and
  the tab ignores the filter (decided, not translated).
- **A Live Channel bound advances.** The Channels grid re-filters on the server
  minute tick the Scope already keeps (`minuteNow`), not on `Date.now()` at
  render.
- **One text form.** The Directory's Time bound printer and parser (`END`,
  `endValue`, `instantText`, `offsetText`, and the chip words
  `timeBoundWords`) move to one shared module that the Directory and Channel
  filters both use.
- **Logs**: `[start, end)` at minute precision, replacing the two inclusive
  calendar days.

### Spreads and zoom

- Every spread a bound is drawn over has the Posts time chart's zoom buttons:
  Directory measures and moments, Channels metrics, Channels moments, and the
  Posts number filters (Views, Estimated views, Channel posts). The Posts time
  chart keeps its own zoom unchanged.
- A spread starts whole. Zoom in shows a third of what is shown, centred on the
  bound, or on the median when there is none. Zoom out triples it again until
  the whole spread is back. Six steps at most. On a log scale the thirds are
  taken on the log axis.
- **A zoomed spread keeps the whole spread's scale.** The Posts histogram
  request carries the scale it was first drawn on, so a zoomed Views chart
  does not flip to linear.
- Directory spreads and Posts number histograms are binned by the server over
  the zoomed range (`lo`, `hi` on `/data/directory/distribution` and
  `/data/posts/value-histogram`). Channels metrics and moments are binned in
  the browser from the Channels already loaded.
- The Channels moment editor gets the Directory's spread. A clicked bar sets a
  Fixed bound rounded out to whole minutes, its End past the bar's newest
  value, so the bar's count and Add's count agree.
- A time spread shows the time of day once the shown span is under three days.

### Menus

- Every row of the Posts and Channels **Filters** menus carries a symbol, drawn
  as the Directory's condition menu draws one: `#` for a number, a clock for a
  time, an eye for the views measures.
- Channels number chips use `#`, as the Directory's do.

## Work, in order

| # | Ticket | Depends on |
|---|---|---|
| TB-01 | Editor core: source, `WindowEditor` (with No value), `WindowOverlay`, `ZoomControls`, the Time bound source with open ends and ahead. Posts unchanged, proven by the screenshot pair | |
| TB-02 | One Time bound text form and chip words, shared by the Directory and Channel filters | |
| TB-03 | Directory Time bound on the embedded editor | TB-01, TB-02 |
| TB-04 | Cited by your channels as a Time bound: API, legacy `mine:14d`, Why wording, client regenerated | TB-01, TB-02 |
| TB-05 | Channel Time bounds: seven moments, the minute tick, the editor with its spread, the Filters menu Times section, day counts removed | TB-01, TB-02 |
| TB-06 | Logs Time bound on the Bar wrapper, over the loaded page | TB-01 |
| TB-07 | Spread zoom everywhere, server `lo`/`hi` and kept scale, time-of-day captions | TB-03, TB-05 |
| TB-08 | Filters menu symbols and Channels `#` chips | |
| TB-09 | Logs Time bound on the server: the log list endpoints take the bound and filter in SQL, as the text search already does | TB-06 |
| TB-10 | Logs spread, drawn by the server, with zoom | TB-09, TB-07 |

TB-09 and TB-10 are why the Logs tab has no spread yet. Each log type loads its
newest 500 entries (`DEFAULT_LOG_PAGE_SIZE`) and the Time bound filters only
those, so a spread drawn in the browser would end where the page ends and look
like nothing older exists.

## Not in this plan

- A spread on Cited by your channels (citing Posts over time). It needs a new
  server read over `PostReference.timestamp`, and its window is almost always
  "the last N days", where a spread adds least.
- A "Last post" Channel moment, which needs a timestamp in the Channels stats.

## Verification, per ticket

- Mutation-test every new guard before trusting it (root `CLAUDE.md`).
- A new branching component needs a render test, or CI's frontend CRAP ratchet
  fails.
- A changed response or request shape: grep `frontend/tests` for that route's
  `page.route` mocks, and run `bun run typecheck:tests` as well as the build
  typecheck.
- Regenerate the client after any schema change (TB-04, TB-07, TB-09).

## What the prototype found

- `?variant=1` reads as the number 1 in TanStack Router's search parsing; any
  search parameter meant as text must accept a number too.
- With No value as a separate button beside the editor, it sat alone on its
  own row; as the third mode segment it reads as one choice.
- "Why it's here" in the bar's summary ("in Live · 14d ago → open") read as
  code; the chip's words read as a sentence.
- A clicked Channels bar first counted one fewer than the bar: the newest
  value sat on the bar's end, which a bound excludes.
- With the Posts number editor open, its histogram re-asks the server every
  few seconds while a sync adds Posts. `main` does the same:
  `invalidatePostViews` refreshes every Posts read when a sync lands.
