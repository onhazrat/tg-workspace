# Request stats: see where every Request goes

Status: ready-for-agent

Ticket prefix: `RQS`.

Settled by a UI prototype on live staging data and four rounds of decisions (2026-10-22), all in
`docs/request-stats-prototype-plan.md`. Its recording decisions ("Recording and retention" and
"Recording spec decisions", numbered 1 to 32) are cited below as "decision N"; its first list,
"Decisions" 1 to 11, which shaped the tab, as "tab decision N". **ADR-035** records that every Request is recorded beside the ledger, in three
tiers; read it before changing what a Request is. The terms **Request**, **Budget**, **Charged
Request**, **Uncharged Request**, **Wasted Request**, **Idle Request**, **Lane** and **Queue
lane** are in `CONTEXT.md`, and their entries were updated for this work. The prototype is the
Requests tab's variant A with both trends, on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d); its README says what it shows and how to run it. It ran on synthetic data scaled from a deployment's real totals, so its data layer is
not a model for the build (see Further Notes).

The work is built with `implement-spec`: tickets form a task graph, each built test-first
(`tdd`) at one of the two seams in Testing Decisions. Recording tickets come first, so data
builds up while the tab is built.

## Problem Statement

As the Operator, I can see how many Requests each Account spent per Budget per day, and
nothing else. I can't tell which Channels they went to, how many brought nothing new, or how
many were thrown away by Telegram turning us away, a proxy timing out or a 404 being retried
eight times. Directory probing grew to about nine Requests in ten before anyone noticed,
because probes, handle checks, pictures and Bot API calls are counted in a separate tally or
nowhere.

So when Telegram starts pushing back, or a Budget runs out early, I'm guessing. I can't see
that a Channel is synced twenty times a day while it posts once, that one proxy fails three
times as often as the others, or that a quiet Account's Requests vanish under probing. The
only per-fetch trail is a debugging log for syncs, kept a month, per User, with no totals.

## Solution

Every Request the app makes to Telegram is recorded at the one place every call goes
through: what kind of work made it, which Account it was charged to (if any), which Channel
or handle it was for, which Lane it left from, what kind of page it fetched, how long it
took, and whether it was Useful, Idle or Wasted (and if Wasted, why). Each Request is kept
for a week, hourly totals for a month, daily totals forever. Charging doesn't change: the
quota ledger stays the one thing Budgets read, and a daily check holds the recorded charged
totals equal to it.

A new Operator-only **Requests** tab shows it all for any time range, to the minute:
- totals and their split into Charged and Uncharged, Useful, Idle and Wasted;
- a daily bar trend, and under it a zoomable trend that stacks or separates kinds of work
  and outcomes, gets finer as you zoom (down to 5 minutes for the last week), and keeps one
  burst from flattening the rest;
- a table by kind of work, and a table of Channels by Requests with search, filters, sorting,
  New Posts per Request, and checkboxes that narrow the whole tab to the Channels picked;
- each Channel's individual Requests from the last week;
- a comparison of Accounts.

Before recording started, the tab shows the ledger's own daily totals, so its history
reaches back past launch.

## User Stories

Recording:

1. As the Operator, I want every Request to Telegram recorded, so that nothing reaches Telegram unseen.
2. As the Operator, I want a picture from Telegram's CDN and a Bot API call recorded as Requests, so that all Telegram load is counted, not only the web view.
3. As the Operator, I want each retry recorded as a Request of its own, so that I see what retries cost.
4. As the Operator, I want an attempt that never left (a full Lane) not recorded, so that only real load is counted.
5. As the Operator, I want each Request to say which kind of work made it (auto sync, manual bulk, manual single, follow, Directory probe, handle check, Bot API), so that I know what to tune.
6. As the Operator, I want a sync's pictures and metadata pages counted under the sync, so that "what does syncing this Channel cost" has one answer.
7. As the Operator, I want each Request to keep its page type (Posts, picture, metadata), so that I can still split pictures out.
8. As the Operator, I want each Request to name the Account charged, or none, so that I can compare Accounts.
9. As the Operator, I want each Request to name its Channel or Directory handle, so that I can rank Channels.
10. As the Operator, I want each Request to name its Lane by the proxy's host and port, with no credentials, so that I can find a failing proxy.
11. As the Operator, I want each Request's latency, so that I can see slow proxies and slow hours.
12. As the Operator, I want each Request's attempt number and a chain id linking a failure to its retries, so that one failing page reads as one story.
13. As the Operator, I want to know whether a Request ran on best-effort (past its Account's Budget), so that I see how much work runs past Budget.
14. As the Operator, I want a page of Posts to record how many were new and how many we already had, so that I can see each Channel's yield.
15. As the Operator, I want a Request recorded as Useful when it made the app write something (a new Post, moved counters, an edit, Channel metadata), so that refreshing view counts is not mistaken for waste.
16. As the Operator, I want a Request that succeeded and wrote nothing recorded as Idle, so that I can find Channels synced more often than they post.
17. As the Operator, I want a Request Telegram turned away, soft-blocked, answered with an error, or never answered recorded as Wasted with that cause, so that I know which fix applies.
18. As the Operator, I want a Wasted Request to carry its error code (HTTP status or exception class), so that I can group failures.
19. As the Operator, I want a retry that brings the page recorded as Useful or Idle, not Wasted, so that waste means waste.
20. As the Operator, I want a probe that changes a Directory entry or adds new sample Posts recorded as Useful, and one that confirms what we knew as Idle, so that I see how much probing re-checks the same answer.
21. As the Operator, I want a probe to record how many new sample Posts it brought, so that probing has a yield too.
22. As the Operator, I want a probe of a missing handle recorded as Wasted and a probe of a private one judged like any other, so that a private Channel stops looking like a dead one.
23. As the Operator, I want the Directory to tell a private handle from a missing one, so that the answer is kept rather than lost.
24. As the Operator, I want a Request from work nobody declared recorded under "Other", so that nothing disappears silently, and I want a test to fail when a known path records "Other".
25. As the Operator, I want recording not to slow fetching, so that the stats don't cost the thing they measure.
26. As the Operator, I want a crash to lose at most a few seconds of Requests, the same as the ledger, so that the gap stays small and visible.

Totals and keeping:

27. As the Operator, I want each Request kept for a week, so that I can open any Channel's individual Requests.
28. As the Operator, I want hourly totals kept for a month, so that I can zoom into any hour of the last 30 days.
29. As the Operator, I want daily totals kept forever, so that I can compare months.
30. As the Operator, I want the week and the month set by environment variables, so that a deployment can keep more or less.
31. As the Operator, I want startup to refuse an hourly span shorter than the per-Request span, so that the rollup never needs rows already pruned.
32. As the Operator, I want hourly and daily totals by kind, Account, Channel, outcome, cause, page type, and new and repeated Posts, so that every table works past the week.
33. As the Operator, I want hourly totals to also keep the Lane and the best-effort flag, so that a month of proxy health and Budget overflow is visible.
34. As the Operator, I want the totals at most 5 minutes behind, so that the tab is close to live.
35. As the Operator, I want the daily charged totals checked against the ledger each day, with a warning and a metric on any mismatch, so that I trust both.
36. As the Operator, I want the ledger unchanged, so that Budgets, lanes and ceilings behave exactly as before.

The Requests tab:

37. As the Operator, I want a Requests tab, open at most once and only for me, so that the stats have one home.
38. As the Operator, I want one time range on top that cuts everything on the tab to the minute, so that every number answers the same question.
39. As the Operator, I want the range picker to show when Requests were made, with the 7-day and 30-day edges marked, drag-select, zoom, scroll and a full-screen view, so that I can pick a burst precisely.
40. As the Operator, I want to see All, Charged or Uncharged with counts, so that I can look at what Budgets pay for alone.
41. As the Operator, I want to pick Accounts and, with two or more, compare them side by side in colours that don't clash with the kinds, so that I see who spends what.
42. As the Operator, I want totals for Requests, Useful, Idle and Wasted at the top, so that I see the shape at a glance.
43. As the Operator, I want a daily bar trend, so that I see the range's days at a glance.
44. As the Operator, I want a zoomable trend under it that gets finer as I zoom, from a day per bucket down to 5 minutes for the last week, with each bucket's exact count on hover, so that I can dig into any moment.
45. As the Operator, I want the trend to stack or separate kinds and outcomes with four switches (separate by kind, separate by outcome, and for each, stacked or separate), so that I can read totals or each part on its own scale.
46. As the Operator, I want each kind's band shaded by outcome (full colour Useful, about half Idle, under a third Wasted), so that kind and outcome read together.
47. As the Operator, I want each row's scale fitted to what's in view and capped above a lone spike, with a notch that gives the spike's real value, so that one burst doesn't flatten the rest.
48. As the Operator, I want the trend in full screen without losing my zoom, so that I can read a long range.
49. As the Operator, I want to turn the zoomed span into the tab's range, so that the tables follow what I'm looking at.
50. As the Operator, I want hiding a kind in the trend's legend to hide it in By kind of work, and back, so that both answer the same question.
51. As the Operator, I want Useful, Idle and Wasted chips that hide an outcome everywhere on the tab at once, so that I can look at waste alone.
52. As the Operator, I want a table by kind of work with Requests, share, an outcome bar, Idle % and Wasted %, and a checkbox to hide each kind, so that the rest reads in proportion.
53. As the Operator, I want clicking a kind to narrow the Channel table to Channels with that work, so that I can see where a kind goes.
54. As the Operator, I want Channels ranked by Requests, with Directory probes and Handle checks as rows of their own, so that uncharged work ranks against real Channels.
55. As the Operator, I want to search Channels, filter by kind, hide uncharged rows, and filter on any measure (Requests, Idle and Wasted counts and shares, syncs, failed syncs, new Posts, Requests per sync, New Posts per Request), whole-row or per kind, so that I can find the outliers.
56. As the Operator, I want New Posts per Request for each Channel (20 is a full page, 0 nothing new), so that I can tell a Channel that brings one new Post per Request from one that brings twenty.
57. As the Operator, I want to sort by any column, so that the worst Channels come first.
58. As the Operator, I want checkboxes on the Channel table, all ticked by default, that narrow the whole tab to the Channels ticked, so that I can study a few Channels at a time.
59. As the Operator, I want a Channel's row to open its individual Requests from the last week, within the range, with time, kind, Account, Lane, outcome, cause, error code, attempt, latency and Posts, so that I can see exactly what happened.
60. As the Operator, I want all times in UTC, so that days match the Budget's reset.
61. As the Operator, I want ranges before recording started to show the ledger's daily totals, so that the history doesn't start at launch.
62. As the Operator, I want the tab usable on a phone, so that I can check it away from my desk.
63. As the Operator, I want the Settings Usage panel kept, with a link to the Requests tab, so that "how much is left today" and "where did it go" each have their place.

## Implementation Decisions

### What a Request is (decisions 6, 7, 21 to 23)

- A Request is one attempt that reached the network, on any Telegram host: the web view, its CDN, the Bot API. An attempt refused locally (the Lane's queue full) is not one. Charging is unchanged: an answered web view attempt is charged as today, and everything else is Uncharged.
- Kinds: auto sync, manual bulk, manual single, follow, Directory probe, handle check, **Bot API** (new, Uncharged), and **Other** for any Request with no declared work behind it. Pictures and metadata pages take the kind of the work that made them.
- Page type: `posts`, `media`, `metadata`.

### Outcome (decisions 8 to 11)

- Every attempt is judged by its own answer.
- **Useful**: the Request made the app write something. For a sync page, that's a new Post, a stored Post's counters or text, or the Channel's metadata. For a probe, it's a change to the Directory entry (verdict, kind, title, subscriber count) or new sample Posts. A handle check follows the same rule: Useful when its answer made the app write something (Channel metadata, a Directory entry), Idle otherwise.
- **Idle**: succeeded and wrote nothing.
- **Wasted**, with a cause: turned away (403, 429, 5xx), soft block, answered error (404, 410, 400, 451), transport fault (no answer), missing handle (a probe or handle check of a handle that does not exist). These are proxy pacing's existing classes plus missing handle. "Retry" is not a cause; the attempt number and chain id carry it.
- Reporting "changed anything" needs these signals, none of which exists today:
  - counter refresh reports whether any value moved;
  - the initial-pass upsert reports whether any stored Post's text changed;
  - the metadata refresh reports whether anything changed;
  - the probe verdict writer reports whether the entry changed and how many sample Posts were new.
- The probe path tells a **private** handle from a missing one. The soft-block page is parsed before it raises, and a private Channel gets its own Directory status. A probe of a private handle is Useful when it changes the entry and Idle when the entry already said private.

### Recording (decisions 1, 12, 14, 26, 27)

- Recorded inside `fetch_with_retry`, the one choke point, per attempt. The Lane is the proxy's host and port with credentials stripped, or `direct`.
- Attribution rides `contextvars`, like the request meter: a recording context set by each kind of work names the kind, Account, Budget, Channel or handle, page type, best-effort flag and chain. Work that sets none records "Other".
- The chain id is the id of the first attempt of a page fetch. It spans the fetch's own retries and the page's outer retries. A queue redelivery starts a new chain.
- Each process (API and worker) holds a buffer flushed every few seconds, at the end of each metered block (the same `finally` that writes the ledger) and on shutdown. The flush runs off the event loop and never holds a session across `await`.
- The per-Request record, from decision 1 as amended (shape, not a schema):

  ```ts
  // One Request. Kept REQUEST_RECORD_DAYS.
  type RequestRecord = {
    id: string; at: Instant; latencyMs: number
    kind: "auto" | "bulk" | "single" | "follow" | "probe" | "handle" | "botApi" | "other"
    charged: boolean; accountId: string | null; budget: Budget | null; bestEffort: boolean
    channel: string | null   // a Channel's handle, or the Directory handle probed or checked
    lane: string             // "host:port" or "direct"
    pageType: "posts" | "media" | "metadata"
    outcome: "useful" | "idle" | "wasted"
    cause: "turnedAway" | "softBlock" | "answeredError" | "transportFault" | "missingHandle" | null
    errorCode: string | null // HTTP status or exception class, on Wasted only
    attempt: number; chainId: string
    newPosts: number | null; repeatedPosts: number | null  // Posts pages; new sample Posts for a probe
  }
  ```

### Totals (decisions 2, 11, 13, 15, 24, 25, 27)

- **Hourly totals**, kept `REQUEST_HOURLY_DAYS`: one row per hour × kind × Account × Channel × outcome × cause × page type × Lane × best-effort, with Requests, charged Requests, new Posts and repeated Posts.
- **Daily totals**, kept forever: the same without Lane and best-effort.
- A scheduled job every 5 minutes recomputes every hour touched since its last run (the open hour included) from the per-Request rows, **replacing** those hours' rows, then rebuilds those days' daily rows from the hourly ones. It is idempotent and keeps its own watermark. It never adds onto existing totals.
- Directory probes and Handle checks have no Channel. Their totals carry the handle as `null` at the hourly and daily grain, and the tab shows them as one aggregate row each (tab decision 7).

### Keeping (decisions 16, 28)

- `REQUEST_RECORD_DAYS=7` and `REQUEST_HOURLY_DAYS=30`, in settings and `.env.example`. Startup refuses an hourly span no longer than the record span.
- The existing hourly retention job prunes per-Request rows and hourly totals in batched deletes. Daily totals are never pruned. There is no partitioning at about 0.7M per-Request rows; revisit past about 10M.
- The new tables are Operator stats, not user-owned. Each one is classified in every inventory that requires it (tenancy scopes, retention windows, the `tg_*` cleanup inventory, the service-kind inventory) with a reason, and none of those guards is loosened.

### The ledger (decisions 3, 18)

- `tg_quota_usage` and `tg_directory_probe_usage` are unchanged and still the only thing enqueue and the ceilings read.
- A daily job after each UTC day closes compares that day's charged daily totals per Account and Budget with the ledger. It logs a warning and emits a metric on any mismatch.

### The API (decisions 17, 29)

- Operator-only, gated on the Permission that reads every Account's quota usage today (`QUOTA_READ_ANY`). Response models in the schemas package, through the generated client.
- One endpoint per need, each taking the range (UTC instants, to the minute), Accounts, Charged/Uncharged, and the Channels left out:
  - **Trend**: buckets at the finest tier covering each stretch (5-minute buckets from per-Request rows inside the last week, hourly inside the month, daily before), each carrying its span and counts by kind × outcome.
  - **Breakdown**: totals by kind and by Channel (with the aggregate rows), from daily totals, using hourly totals for a day the range cuts. Each row has the counts the Channel table and its measures need: Requests, Useful, Idle, Wasted, syncs and failed syncs, new and repeated Posts, charged.
  - **Spread**: when Requests were made, for the range picker, over everything kept.
  - **A Channel's Requests**: the per-Request rows for one Channel or aggregate row, within the range and the last week, newest first, paged.
  - **History before recording**: the ledger's charged daily totals per Account and Budget, and the probe daily totals, for days before the first recorded Request. Drawn without Channel or outcome.
- The prototype's fact shape is the contract the tab's logic was built on. The API serves rows that map onto it one to one:

  ```ts
  // From the prototype: what every table and trend on the tab folds.
  type Fact = {
    day: string; hour: number | null; at?: number   // UTC; `at` for 5-minute buckets
    kind: Kind; channel: string | null; account: string | null
    outcome: "useful" | "idle" | "wasted"; requests: number
    stats?: { runs: number; failed: number; posts: number }
  }
  ```

### The Requests tab (decisions 4 and 30, tab decisions 1 to 11, the prototype's variant A)

- A Closable workspace tab, **Requests**, open at most once, offered only to the Operator. It is loaded lazily, so Plotly downloads only when the tab opens.
- **Filter bar** (the app's `FilterBar`): title; All / Charged / Uncharged with counts; an Accounts facet; a "Requested" time bound (the app's time-bound editor and spread, with the 7-day and 30-day edges marked, drag-select, zoom, scroll and full screen). Its footer shows the total, the range in UTC (to the minute when cut mid-day), and "N Channels left out" with Pick all.
- **One range for everything**, applied to the minute. Every part of the tab reads the same filter: totals, both trends, both tables, the Account comparison, a Channel's Requests. The range picker's spread draws every day kept.
- **Tab-wide state** shared by every part: the range, Accounts, Charged/Uncharged, hidden kinds, hidden outcomes, Channels left out.
- **Account comparison** with two or more Accounts, in a violet ramp that doesn't clash with the kinds.
- **Stat strip**: Requests, Useful, Idle, Wasted.
- **Daily bar trend** (Recharts, the prototype's "0 Current").
- **Zoomable trend** (Plotly, `plotly.js-dist-min` 3 through `react-plotly.js`'s factory) under it:
  - **Switches**: Separate by kind and Separate by outcome, each with Stacked | Separate. A stacked dimension splits the area in a row; a separate one gets a row per value on its own scale; both separate give a row per kind × outcome.
  - **Buckets follow the zoom**: re-summed to about 220 across the view, from 5 minutes to a day (5, 15 and 30 minutes, 1, 2, 4, 6 and 12 hours, a day). Hover gives each bucket's span, grain and exact count. Buckets of 30 minutes or more are drawn as a gentle spline (smoothing 0.6), finer ones as steps.
  - **Shades**: each kind's colour stepped toward the chart surface, opaque: Useful 100%, Idle 55%, Wasted 30%, with a hairline in the surface colour between layers.
  - **Scale**: each row's y range comes from the buckets in view. When the tallest is more than 1.5 times the 99th percentile, the scale stops at 1.15 times that percentile, and a notch marks each bucket above it, with the real value on hover.
  - **Legend**: a legend click is the kind table's Show checkbox (or the outcome chip, when the legend lists outcomes); a double click isolates one, or shows all again.
  - Range slider, range buttons (6h, 1d, 7d, 30d, All), tier bands, full screen without a remount (Esc leaves), and "Use the visible range".
  - All times are passed to Plotly as zoneless UTC strings, so the axis, hover and picked ranges agree whatever the browser's time zone.
  - **Outcome chips** (Useful, Idle, Wasted) above it, shared with the kind table; the last shown can't be hidden.
- **By kind of work**: Show checkbox, Kind (Directory probe and Handle check marked uncharged), Requests, Share, the outcome bar, Idle %, Wasted %. Hidden kinds and outcomes recompute the rest in proportion. A row click narrows the Channel table to that kind.
- **Channels by Requests**:
  - **Search and filters**: search; Kinds facet; Hide uncharged; a measure filter with criteria search over every measure, whole-row or per kind, edited with the app's bound histogram and fields; sort picker; filter row.
  - **Rows**: pick checkbox (header: every listed row), rank, Channel, Requests, Idle, Wasted, Idle %, Wasted %, New Posts / Req (hover: share of a 20-Post page; aggregate rows show a dash and sort last), outcome bar. Columns for a hidden outcome go.
  - **Paging**: show 25, then 50 more.
  - **A row click** opens the Channel's Requests in a sheet.
- **Colours**: categorical tokens for the six kinds (and Bot API, Other) and outcome tokens with icons (Useful neutral ✓, Idle amber dashed circle, Wasted red ⚠), from the dataviz palette, for light and dark.
- **Phone width**: no sideways scroll, a 16px gutter.
- The Settings Usage panel stays and links to the tab.

## Testing Decisions

- **A good test drives the outside.** On the backend that's work happening against a fake Telegram, then the Operator API's answers. On the frontend it's a person's clicks and what the tab shows. No test reaches into the buffer, a query's SQL or a component's state.
- **Seam 1: the backend.** Telegram is faked at `network._fetch_once`, the seam the quota ledger tests use. Everything above it is real: a Channel's sync through hand-drained Lanes, the probe job, the handle-check route, publishing. A test makes work happen, flushes the buffers, runs the rollup job, then reads the Requests API over HTTP. Cases:
  - **Recording basics:**
    - one Request per attempt, and none for a locally refused attempt;
    - kind, Account, Channel, Lane and page type for a sync, its pictures and metadata, a probe, a handle check and a Bot API publish;
    - charged only for an answered web view attempt.
  - **Outcomes:**
    - Useful for new Posts, moved counters, an edit and changed metadata; Idle for a page that wrote nothing;
    - Wasted causes for 429, a soft block, 404, a transport fault and a missing handle;
    - a retry that succeeds is not Wasted, and chain ids tie a page's attempts across both retry layers.
  - **Probes:**
    - a probe adding sample Posts is Useful and records them;
    - a re-probe with the same verdict is Idle;
    - a private handle gets its own Directory status and is never Wasted.
  - **Attribution:** a Request with no context records "Other", and the guard fails for any known path doing so.
  - **Totals:**
    - hourly and daily totals equal the per-Request rows;
    - the rollup is idempotent when run twice;
    - an hour that gets a late Request is recomputed.
  - **Keeping and the ledger:**
    - retention with a moved clock prunes per-Request rows past `REQUEST_RECORD_DAYS` and hourly rows past `REQUEST_HOURLY_DAYS`, never daily rows;
    - startup refuses an hourly span no longer than the record span;
    - the ledger check passes on a clean day and reports a forced mismatch;
    - the existing quota ledger tests pass unchanged.
  - **The API:**
    - range cut to the minute;
    - Channels left out;
    - history before recording comes from the ledger;
    - a non-Operator gets refused.

  Prior art: `test_quota_ledger.py` (the `_fetch_once` seam, mutations named on tests), `test_lane_draining.py` (hand-drained Lanes), `test_discover_probe_sweep.py`, `test_retention_split_four_ways.py`, `test_quota_usage_route.py`.
- **Seam 2: the frontend.** A Playwright spec over the mocked Requests API:
  - the range cuts every part and shows in UTC;
  - Charged/Uncharged and Accounts narrow the totals, and two Accounts compare;
  - picking Channels narrows the tab, and Pick all restores it;
  - each trend switch combination draws, the legend and the kind table's Show box toggle together, and the outcome chips hide everywhere;
  - zooming and "Use the visible range" set the range, and full screen keeps the zoom;
  - sorting by New Posts / Req, and a measure filter;
  - a Channel's Requests open in the sheet;
  - a phone-sized viewport has no sideways scroll.

  Render tests for each new branching component, as the CRAP ratchet requires. Unit tests for the pure trend logic the prototype carries: re-bucketing to the zoom, the cap and notches, the shade steps, the kind and outcome split. Prior art: the Posts tab and Summary specs' journeys, `window.test.ts`.
- **The guards each ticket will meet**:
  - the route inventories (`bash scripts/route-guards.sh`) and the permission checks;
  - tenancy classification of each new table;
  - the retention inventories, with the new spans declared;
  - the `tg_*` cleanup inventory;
  - service kinds, response-model hygiene, the egress seam, and the worker-count guard.

  None is loosened.
- **Mutation-test each new test and guard** before trusting it, and name the mutation in the commit body (`Mutation-checked: ...`), as the repo's guide asks.

## Out of Scope

- The follow-up tickets in the plan:
  - stop retrying answered errors (a 404 is charged eight times, up to 32 inside a page), landed after recording so the tab shows it before and after;
  - fold `tg_network_logs` into the Request record;
  - remove the leftover `/telegram/scrape` and `/telegram/resolve-start-time` endpoints.
- A "Wasted by cause" section, Lane breakdowns and cause-stacked trends on the tab. The record and totals keep cause and Lane, so they can be added without new data.
- Grouping a Channel's Requests into retry chains in the sheet (the chain id is recorded).
- Alerts on waste or ledger mismatch beyond the daily check's warning and metric.
- Changing Budgets, lanes or ceilings, or charging pictures and Bot API calls.
- Partitioning the tables, and scaling the worker past one replica.

## Further Notes

- **Volume on staging:** about 25–35k sync and 50–80k probe Requests a day, so about 100k per-Request rows a day and about 0.7M kept. Hourly totals come to tens of thousands of rows a day, daily totals about 1.5–3k.
- **Prototype data is not the build's.** The prototype synthesized outcomes, split hours across Channels by share, and scaled cut days. The real totals carry Channel, hour and outcome, so the tab reads them directly, and those shortcuts go. The prototype's backend script and its `/proto` dev proxy are throwaway.
- **Real facts the prototype surfaced:**
  - probing is about nine Requests in ten;
  - Auto sync is about 46% Idle;
  - about 57% of probe Requests end "unavailable", and some of those are private handles;
  - Plotly draws timestamps in the browser's local time, so the trend must pass zoneless UTC strings.
- **Already found while prototyping:** a time-bound fix (an elapsed field accepts a bare `0`) sits as its own commit on the prototype branch, for a separate PR.
- **Glossary:** the Request, Uncharged Request, Wasted Request and Idle Request entries were updated with these decisions.
