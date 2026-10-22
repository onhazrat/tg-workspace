# Request stats prototypes

Settled in a grilling session on 2026-10-22. Prototype: [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d). The goal is to see where the deployment's
Requests go, so that sync cadences, probing and bulk work can be tuned against real load.
Terms are as defined in `CONTEXT.md`: Request, Budget, Charged Request, Uncharged Request,
Wasted Request, Idle Request.

## What exists today

- `tg_quota_usage` holds one count per Account × Budget × UTC day, written only by
  metered work (syncs and bulk follows).
- `tg_directory_probe_usage` keeps a daily tally of probe traffic, charged to nobody.
- Handle checks in `routes/telegram.py` reach Telegram and are counted nowhere.
- Nothing records a Request per Channel, per hour or by outcome.

So the breakdowns below need data that does not exist yet. The prototypes run on synthetic data,
and the breakdowns that survive decide what each Request has to record.

## Decisions

1. **Scope.** Charged and Uncharged Requests together, shown as two layers of one total.
2. **Breakdowns.** Kind of work (auto sync, manual bulk, manual single, follow, Directory
   probe, handle check), Channel, and outcome (useful, Idle, Wasted). Time appears as a trend
   line. No per-Lane breakdown.
3. **Wasted** means failed or turned away by Telegram, every retry after it, and a probe of a
   handle that turns out not to exist. **Idle** is a separate band and is not waste.
4. **Audience.** Operator only.
5. **Placement.** A new Closable tab, **Requests**, open at most once, visible only to an
   Operator.
6. **Range.** The last 30 UTC days by default, with a day picker. The range drives every
   breakdown. Clicking a day on the trend narrows everything to that day and switches the
   trend to hourly.
7. **Uncharged in the Channel breakdown.** One aggregate row per uncharged kind ("Directory
   probes", "Handle checks"), ranked against real Channels.
8. **Account filter.** All Accounts, or one Account. It narrows every breakdown.
9. **Data.** Synthetic, scaled from a deployment's real daily totals per Budget and real
   probe totals, with real Channel handles, read through the existing read-only role. The
   per-Channel split, the hours and the outcomes are invented.
10. **Chart library.** Recharts 3 through shadcn's Chart component is the default for every
    variant (research in `.scratch/request-stats/research-chart-library.md`). The call is not
    clear on coverage, so the prototype compares it against ECharts 6 and Plotly (`plotly.js` 3
    with `react-plotly.js` 4, which the research did not cover) in two places: the Sankey
    (variants B, B2, B3) and a throwaway `?bench=sparklines` page that times 300 virtualized
    sparklines in each library, measured in Chromium.
11. **Palette.** The prototype adds categorical tokens `--chart-1..8` for light and dark, taken
    from the dataviz skill's validated palette, to replace the five neutral greys. Outcomes
    get fixed colours: Wasted in red, Idle in amber, useful in neutral.

## Variants (`?variant=`)

- **0. Current.** Today's per-Account quota usage table, rehosted on the tab unchanged. It is
  the reference for what an Operator can see today.
- **A. Ranked tables.** A kind-of-work breakdown, then a Channel leaderboard sorted by
  Requests, with Idle and Wasted columns.
- **B. Flow.** A Sankey from Charged/Uncharged to kind of work to outcome, in Recharts.
- **B2. Flow, ECharts.** The same as B, drawn in ECharts.
- **B3. Flow, Plotly.** The same as B, drawn in Plotly.
- **C. Treemap.** Area is Requests, nested kind > Channel, colour is the Wasted share.
- **D. Timeline.** A stacked area of Requests per hour or day by kind, with a Channel table
  below that filters on the selected range.

Every variant shares the range, the day drill-down and the Account filter.

**Dropped on 2026-10-22 after review on staging data:** B, B2, B3 and C, then D, whose own
timeline the trend above every variant replaced. **A is the layout kept.** The chart-library
comparison continues in the sparkline bench only.

**The trend (`?trend=`), settled 2026-10-22.** The trend is drawn in Plotly rather than
Recharts, for its zoom, pan, range slider and unified hover. It is as fine as each tier keeps:
daily before 30 days, hourly to 7 days, 5-minute buckets from each Request after that. Of
four takes, two were dropped (T2 and T3) and two (T1, one stack; T4, a row per kind) became
one chart with four switches in its header: separate by kind, separate by outcome, and for
each, stacked or separate. A stacked dimension splits the area inside a row; a separate one
gets a row per value on its own scale, and both separate gives a row per kind and outcome.
The stack shows how the kinds add up; the rows keep a quiet kind readable beside probing.
Where kind and outcome are both shown, each kind's band is a step of its own colour toward the
chart's surface, opaque, with a hairline between layers: full where Useful, 55% where Idle,
30% where Wasted (patterns shimmered on thin spikes; translucent tints were too close).
Buckets follow the zoom, re-summed from the stored tiers to about 220 across the view, from
a day down to 5 minutes, so hover always gives a bucket's exact count; buckets of 30
minutes or more are drawn as a gentle curve, finer ones as steps. Each row's scale comes
from the buckets in view and stops at 1.15 times their 99th percentile when the tallest is
more than 1.5 times it; a bucket above the scale gets a notch whose hover gives its total.
Switching keeps the zoom, and the chart opens full screen.

**Both trends stay.** The daily bars (the first trend, in Recharts) sit above the Plotly
trend: the bars give the range at a glance, Plotly digs into it. The `?trend=` switch is gone.

**Yield (2026-10-22).** Useful, Idle and Wasted say whether a Request changed anything, not
how much: one new Post per Request and twenty both count as Useful. The Channel table adds
**New Posts per Request** (20 is a full page, 0 nothing new), sortable and filterable,
from the new-Post counts each Request records. Probes and handle checks fetch
no Posts; their yield is their Useful share.

**One range for the whole tab.** The range on top cuts everything to the minute: totals,
tables, the trend and a Channel's Requests. A day an edge cuts keeps the share of its
Requests the hourly totals put inside. All times read in UTC.

## Recording and retention (decided 2026-10-22)

Three tiers, each kept for a different span:

- **Each Request**, one record per Request, for the last **7 days**.
- **Hourly totals** for the last **30 days**.
- **Daily totals**, kept **indefinitely**.

1. **One Request's record** carries its time, kind, the Account charged (or none), the
   Channel or Directory handle, the Lane, the outcome class proxy pacing already computes
   (answered, turned away, soft block, transport fault), the attempt number, the latency,
   and whether the page changed anything, so Idle is recorded rather than estimated. When
   the Request fetched a page of Posts (not a picture or a metadata-only page), it also
   carries how many Posts on the page were new and how many were repeats.
2. **The hourly and daily totals** both keep kind × Account × Channel × outcome. Hourly
   totals also keep the Lane. Daily totals come to roughly 1.5k rows a day.
3. **The quota ledger stays separate.** `tg_quota_usage` remains the one thing enqueue and
   the ceilings read. A check holds that each day's charged daily totals, per Account and
   Budget, equal the ledger.
4. **The prototype shows the tiers.** Ranges past 30 days are allowed and drawn daily only.
   A Channel row opens its individual Requests for the last 7 days. The time filter's
   spread marks the 7-day and 30-day edges.
5. **An ADR** (ADR-035 in `docs/migration/`) records this, written with the recording spec.

## Recording spec decisions (grilling, 2026-10-22)

What one Request is, and what counts:

6. **A Request is one attempt that reached the network**, every Telegram host alike: the
   web view (t.me), its CDN (pictures) and the Bot API. Answered attempts on the web view
   are charged as today; a transport fault is an Uncharged Wasted Request; an attempt
   refused locally (Lane queue full) never left, so it is not a Request. The ledger check
   compares charged, answered Requests only.
7. **Pictures and metadata pages** belong to the kind of work that made them (a sync's
   pictures are Auto sync). Each Request keeps a **page type**: posts, media or metadata.
8. **Changed anything** (Useful rather than Idle) means the page made the app write
   something: a new Post, a stored Post's counters or text, or the Channel's metadata.
9. **Probes and handle checks follow the same rule.** A probe is Useful when it changes the
   Directory entry (verdict, title, subscriber count) or adds new Posts to the entry's
   samples; it records how many new sample Posts it carried. Otherwise it is Idle.
10. **A private handle is not Wasted.** The probe tells a private handle from a missing one
    (today both become "unavailable", because the soft-block check raises before the page
    is parsed). Private is Useful when it changes the entry, Idle when the entry already
    said so. Only a handle that does not exist is Wasted.

What each Request carries, and the totals:

11. **Wasted has a cause** in the record and in the hourly and daily totals, the classes
    proxy pacing already computes plus one: turned away (403, 429, 5xx), soft block,
    transport fault, answered error (404, 410, 400, 451), missing handle. Every attempt is
    judged by its own answer: a retry that brings the page is Useful or Idle, one that
    fails is Wasted with its own cause. "Retry" is not a cause; the attempt number and the
    chain id say it.
12. **A Wasted Request carries an error code** (HTTP status or exception class), and every
    retry a **chain id**: the first attempt of the page fetch, across the fetch's own
    retries and the page's outer retries. A queue redelivery starts a new chain.
13. **New and repeated Post counts** are summed into the hourly and daily totals, so New
    Posts per Request works past 7 days.

Writing and keeping:

14. **Recorded at the one choke point**, `fetch_with_retry`, into a buffer in each process
    (API and worker), flushed every few seconds, at the end of each metered block (where
    the ledger is written) and on shutdown. Attribution rides the same `contextvars` as the
    request meter.
15. **A job rolls the totals up** from the per-Request rows: hourly totals from closed
    hours, daily totals from hourly.
16. **Pruning** joins the hourly retention job as batched deletes, no partitioning. The
    7-day and 30-day spans are environment variables.
17. **History before recording** is read, not backfilled: the ledger's charged daily totals
    and the probe daily totals, drawn without Channel or outcome, as the prototype does.
18. **The ledger check** is both a test of the write path and a daily job after each UTC
    day closes that logs a warning and a metric on any mismatch.
19. **`tg_network_logs` stays** as the debugging log; folding it in is a follow-up.
20. **The 404 retried eight times, each charged**, is a separate ticket, landed after
    recording so the tab shows it before and after.

Kinds, attribution and the tab:

21. **Bot API calls are a kind of their own**, "Bot API": publishing, bot info and bot
    files. Uncharged.
22. **CDN pictures and Bot API calls stay Uncharged**, so the ledger means what it means
    today. A sync's pictures are Auto sync by kind and Uncharged by layer.
23. **A Request with no known work behind it** is recorded under a kind "Other", and a test
    fails if any known path records "Other".
24. **The rollup job runs every 5 minutes**, idempotent: it recomputes every hour touched
    since its last run, the open hour included, replacing rather than adding, then rebuilds
    those days' daily totals from the hourly ones. The tab reads totals only, at most 5
    minutes behind.
25. **Page type is kept in the hourly and daily totals** as well as on each Request.
26. **The Lane is recorded as the proxy's host and port**, credentials stripped, or
    "direct".
27. **A best-effort flag** (work past its Account's Budget) is on each Request and in the
    hourly totals.
28. **`REQUEST_RECORD_DAYS=7` and `REQUEST_HOURLY_DAYS=30`**, in `config.py` and
    `.env.example`; startup refuses an hourly span shorter than the record span.
29. **The tab reads** the finest tier for each stretch of the trend, daily totals for the
    tables (hourly for a day the range cuts), the per-Request rows for a Channel's list, and
    the ledger-only history before recording started; one Operator-only endpoint per need.
30. **Settings' Usage panel stays** as the Budget view ("how much is left today"), linking
    to the Requests tab ("where did Requests go").

Packaging:

31. **One spec, one effort**, prefix `RQS`: recording and its API first, so data builds up
    while the Requests tab is built. ADR-035 is written with the spec.
32. **The docs land after the spec and tickets**: one docs PR from a fresh branch off
    `origin/main` with `CONTEXT.md`, this plan, ADR-035, the spec, the tickets and the
    chart-library research note. Before it, a sanitized snapshot of the prototype is pushed
    as `prototype/request-stats` (the deployment's name scrubbed from code and history,
    shown before pushing). The local prototype branch is never pushed.

## Follow-up tickets

- **Stop retrying answered errors.** A 404 is retried eight times, each attempt charged, up
  to 32 inside a sync page. Land it after recording, so the tab shows it before and after.
- **Fold `tg_network_logs` into the Request record**, once the record has proved itself.
- **Remove the leftover endpoints** `/telegram/scrape` and `/telegram/resolve-start-time`,
  which no frontend calls any more.

## After the prototypes

The spec is `.scratch/request-stats/spec.md` (prefix `RQS`), its tickets are in
`.scratch/request-stats/issues/` (RQS-01 to 16 to build, 17 to 19 the follow-ups), and ADR-035
(`docs/migration/ADR-035-every-request-is-recorded.md`) records why every Request is recorded
beside the ledger.
