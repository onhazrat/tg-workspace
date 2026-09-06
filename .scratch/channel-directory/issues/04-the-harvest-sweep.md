# 04: The harvest sweep

**What to build:** Handles referenced by stored Posts enter the Directory on their own, without anybody generating a Discovery report — and the Operator can see what that cost.

**Blocked by:** 03

**Status:** done

- [x] A periodic job walks stored Posts for referenced handles not yet in the Directory and enqueues them, reusing the existing signal extractor for forwards, mentions and links
- [x] It is a sweep, not a write on the sync path, so it never slows a path an Account waits on
- [x] Batch size is configurable and is the throttle
- [x] Work drains through the existing probe queue lane, strictly after every sync lane
- [x] The sweep skips any handle somebody follows, since sync covers those better and more often
- [x] One Account's corpus does not starve another's handles out of the queue
- [x] Probe-lane requests are counted at deployment level and visible to the Operator
- [x] No Account's quota ledger is charged and no fourth Budget is introduced
- [x] A Discovery report still scans the Posts in its Scope and joins Directory rows for metadata — what it means is unchanged

## Notes

No daily ceiling. The adaptive per-proxy wait plus the refresh window are the rate control; the known gap is that pacing reacts after the fact and syncs share the widened wait. The Operator's lever is ticket 03's window.

The three Budgets derive totally from sync mode, so a fourth would break that; charging an Account for corpus work is what the three exist to prevent.

## What shipped

- `jobs/directory_harvest.py` — the sweep. It walks stored Posts through
  `discover.harvest_page`, which reuses `post_references`, so a forward, a
  mention, a masked href and a cross-channel reply count here exactly as they do
  in a report. The sweep changes who asks, not what a reference is.
- **A sweep and not an ingest hook**, which is two arguments rather than one.
  Extracting at ingest would put handle extraction and a Directory write inside
  the walk an Account waits on, and it would leave the deployment with no
  throttle at all — the rate of new handles would be the rate of new Posts,
  which is not a number anybody chose. It also reaches Posts already stored,
  which an ingest hook by construction never would.
- **Two marks over `Post.timestamp`, both in `directory_runtime`.**
  `harvestTail` is the newest Post walked, and ascending order makes that leg
  self-terminating: past the newest Post the query returns only what has
  arrived since, so following the tail costs one empty indexed query per tick.
  `harvestCursor` is the backfill position in the history below it, and it
  wraps — a backward sync stores Posts with *old* timestamps, which land below
  a mark that has already passed them, so a walk that only moved forward would
  never see a handle referenced in fetched history. Its own settings key rather
  than a field in `directory`, the split `sync_runtime` already makes from
  `sync`: one is policy a person sets, the other is state the job writes about
  itself.
- **The two legs have separate budgets, and that is not tidiness.** The tail leg
  has an end and the backfill leg does not, so only one of them is a cost paid
  on every tick for the life of the install —
  `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` is how small "forever" is allowed to
  be. Giving the backfill the tail leg's *leftovers* was tried and starves it:
  on a deployment busy enough to keep the tail leg saturated it would never run.
- **A backlog ceiling, because nothing made the two ends of the pipe agree.**
  The sweep adds on a timer; the probe lane drains only when no sync wants a
  Slot, behind a per-proxy wait that widens under pressure. Unbounded, the
  backlog grows monotonically — and since every harvested row sorts ahead of
  every `REFRESH_PRIORITY` row, ticket 03's staleness refresh would then never
  be dequeued at all, with `refreshDue` climbing as the only signal. The ceiling
  is on the backlog rather than the enqueue rate, because the drain rate is not
  a number this process knows.
- **Two knobs, and only one of them is the throttle.**
  `DIRECTORY_HARVEST_BATCH_SIZE` counts *new* handles, because a batch spent on
  handles already on the map throttles nothing while looking like it throttles
  everything. `DIRECTORY_HARVEST_SCAN_LIMIT` is the cost bound that has to exist
  beside it: once the corpus is harvested almost every Post references only
  known handles, so a tick chasing new ones would walk the whole table before
  giving up.
- **Followed handles are skipped**, deployment-wide rather than per walker.
  Ticket 03's `record_sync_metadata` already writes a followed Channel's entry
  from the page every sync fetches, so probing one here is the same page fetched
  twice by two routes — and the sync route is both cheaper and more frequent.
- **`HARVEST_PRIORITY` is the fairness mechanism**, not a rank. The walk is a
  single cursor and knows nothing about who follows what, so the order it
  *finds* handles in is a fact about which Channels were being synced. One
  number for every harvested handle makes `dequeue_handles` fall through to its
  `handle` tiebreak, and an alphabetical order cannot prefer an account. It sits
  behind `DEFAULT_PROBE_PRIORITY` and ahead of `REFRESH_PRIORITY`: a handle a
  report named beats one nobody asked about, which is still an answer we have
  never had and beats re-fetching one we hold.
- **Nothing is enqueued onto a lane here.** The sweep writes
  `tg_channel_directory` rows and stops; the existing probe sweep puts them on
  `discover_probe_background`, which `LaneScheduler` serves strictly after every
  sync lane. That layering is why this job needs no lane, no Slot and no proxy —
  and why ticket 36's ordering guarantee did not have to be restated.
- `tg_directory_probe_usage` and `services/directory_probe_usage.py` — the
  deployment tally, `ON CONFLICT DO UPDATE` accumulating exactly as
  `quota.charge_requests` does. `_process_probe_message` now opens the same
  `core/request_meter.py` meter the sync path uses, so the two numbers are in
  the same unit. **Metered and charged to nobody are two statements and only the
  first changed**: no owner column, no owner lookup, no fourth Budget. The three
  derive totally from `SyncJobState.sync_mode`, so there is no mode a fourth
  could come from, and charging an account for corpus work is what splitting the
  three exists to prevent.
- `GET /data/discover/probe/queue` gained `requestsToday`, `requestsWeek`,
  `harvestEnabled` and `harvestCursor`. On the existing read rather than a route
  of its own: it is already the probe dashboard, and the number an Operator
  wants beside "how much is queued" is "what has that been costing".
- `ix_tg_posts_timestamp`. `tg_posts` carried only `(channel_name, timestamp)`,
  which a global order with no channel equality cannot use, so the walk would
  have seq-scanned and top-N sorted the table every tick — the "a scheduled job
  pays its cost every tick, forever" shape this repo has already paid for once.

## Caught along the way

- **The batch had to count new handles, not scanned Posts.** The first draft
  capped the walk at `DIRECTORY_HARVEST_BATCH_SIZE` Posts, which reads as a
  throttle and is not one: in steady state almost every Post references only
  handles already on the map, so the cap bounded the *scan* while the number of
  handles reaching the queue was whatever those Posts happened to contain. Two
  knobs, with the ticket's throttle on the half that actually grows the backlog.
- **`known_handles` was one query per handle.** A page can reference a couple of
  hundred handles and the first version asked about them one at a time — the
  "compute it for everything, read one field" shape from the other direction, a
  round trip per answer. One membership query per page now.
- **A tick that finds nothing still has to save its cursor.** Skipping the write
  when nothing was queued looked like an optimisation and would have made the
  sweep re-read the same stretch of Posts on every tick for ever, which is a job
  that costs the same every tick and achieves nothing.
- **The wrap happens inside the tick that reaches the end**, not on the next
  one. A tick that both finished a cycle and started the next would double back
  over Posts it had just read, so the walk stops at the wrap and the following
  tick starts clean.
- **A corrupt mark restarts that leg rather than raising.** The sweep is
  idempotent, so the cost of restarting is one pass over Posts whose handles are
  already on the map; the cost of raising is a scheduled job that stays broken
  until somebody reads a log line.

## Caught by `/code-review`

- **One cursor made the sweep a perpetual full-corpus rescan.** It wrapped the
  moment it reached the end, so the tail-following the design claimed never
  happened: on a corpus smaller than the scan limit every tick re-read
  everything and found nothing, and on a large one a Post stored today waited a
  whole lap — days — before anything looked at it. Split into the tail mark and
  the backfill mark, which is the shape the two jobs actually have.
- **Harvested handles outrank refreshes with nothing bounding the queue.** The
  priority order is deliberate — an answer we have never had beats one we hold —
  but it only stays a *delay* if the backlog is bounded. It was not, and the
  rates are set by different things at the two ends. Hence the ceiling.
- **`ix_tg_posts_timestamp` walks `> after`, so a sentinel of `0` hid every
  dateless Post.** `Post.timestamp` defaults to `0` for a row the scraper stored
  with no usable date; those were invisible to every pass. `HARVEST_START` is
  `-1`.
- **A page that overflowed the batch had its extra handles discarded** after the
  mark had already moved past the Posts that produced them, so they were lost
  until the next lap. The batch is a between-pages check now and a tick may
  overshoot by one page — a bounded overshoot instead of unbounded loss.
- **`is_harvest_running` was written and never wired.** It is `harvestRunning`
  on the queue read now, beside the probe half it was modelled on.

**One fix needed a second fix.** Giving the backfill leg the tail leg's leftover
budget also made `until` unobservable: the tail leg always caught up first, so
the bound was always the newest Post and the mutation that removed it passed.
Its own budget is what makes the bound load-bearing — and is the correct
behaviour anyway, for the starvation reason above.

## Notes for the next ticket

- **Ticket 05 removes the backfill leg entirely.** `Post.retrieved_at` is an
  immutable insert stamp with a single writer, so walking *insertion* order sees
  every Post exactly once whenever it arrived — including one a backward sync
  stored — and needs no wrap, no second mark and no forever-cost. This ticket
  rejected `updated_at` for churning on every re-upsert and did not go looking
  for an insert stamp, which is the miss. The two notes below describe the
  behaviour ticket 05 supersedes.

- **New references are prompt; historical ones have a cycle time.** The tail leg
  reaches a Post on the next tick after it is stored. The backfill leg re-walks
  history at 100 Posts per tick — ~29k a day at the shipped interval — so a
  handle referenced *only* in Posts a backward sync fetched can wait weeks on a
  large corpus. That is the trade the separate budget makes deliberately, and
  `DIRECTORY_HARVEST_BACKFILL_SCAN_LIMIT` is the lever.
- **The backlog ceiling is a blunt instrument and says so.** At the ceiling the
  sweep stops entirely rather than yielding to refreshes, so a deployment whose
  probe lane is permanently saturated harvests nothing. If that happens the
  answer is the refresh window or the proxy fleet, not a bigger ceiling.
- `requestsWeek` is a total, not a series. A series is a chart nothing renders
  yet; the browsing surface over the Directory is still a separate feature, and
  that is where a cost graph belongs.
- The tally is on neither retention inventory and the guard asserts it, matching
  `tg_quota_usage`. If the Directory ever grows a metadata retention window,
  this table is still not part of it.
