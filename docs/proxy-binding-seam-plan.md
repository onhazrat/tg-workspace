# One egress seam: every request to Telegram leaves from an acquired Lane

Supersedes ticket 36 as written ("fan `run_sync_job` out over the partition"),
which named the wrong defect. Decided in session, 2026-09-03. Every choice below
was put as a question with alternatives; the rejected option and the reason it
lost are recorded beside each, because a decision whose alternative is not
written down gets relitigated by whoever reads the code next.

**Why, in one page:** [ADR-012](./migration/ADR-012-egress-seam.md). This plan
is the how; the ADR is the decision and what it costs.

## The rule

**Every HTTP request to Telegram leaves through an acquired Lane.** No Lane in
context, no request. That is the whole invariant, and it is what the operator
asked for: one place in the code that talks to proxies and Telegram.

Holding a **Slot** is a narrower thing and stays optional: it means "I am a
Channel walk, pin me to one proxy for my whole multi-page life."

## Vocabulary

Added to `CONTEXT.md` this session. Restated here because the plan is unreadable
without it.

- **Lane** — one proxy. A long-lived client plus a semaphore bounding requests
  in flight through that proxy, from any kind of work at all.
- **Slot** — one permit to walk a Channel, pinned to a Lane for the walk's whole
  life. `sum(max_parallel)` of them.
- **Partition** — every Slot in one process. One per process, and the worker is
  the only process that builds one.
- **Sync worker** — the process running the scheduler and the drain. Never a Slot.

## What was wrong with ticket 36 as written

Three factual claims did not hold, and finding that out is what reshaped the work.

1. It named three `run_sync_job` callers. There are two. `RUN_SYNC_JOB_CALLERS`
   agrees. `bulk_follow` has a *separate* `asyncio.Semaphore(4)` and, since
   ticket 10, enqueues its chained sync rather than calling `run_sync_job`.
2. It said the legacy `_run_whole_job` path hops proxies. It does not:
   `_process_message` binds the whole legacy job to one Slot deliberately.
   Hopping is live on `auto_summary` alone.
3. It treated double-counted concurrency and proxy hopping as one defect with
   one fix. They are two defects with different victims.

The `2N` over-count it describes is real. It is also the smaller half.

## The inventory that decided the scope

Eleven places reach Telegram or a proxy. `bound_to` appears in **one** place in
the entire codebase, `sync_queue.py:1144`. That ratio is the problem statement.

| Egress | Process | Bound today | Metered |
|---|---|---|---|
| `sync_single_channel` page walk | worker | yes | yes |
| `cache_post_thumb` (CDN) | worker | yes, inherits the walk | no |
| `_run_whole_job` -> `run_sync_job` | worker | one Slot, N scrapes on it | yes |
| `auto_summary` -> `run_sync_job` | worker | **no** | yes |
| `discover_probe` sweep | worker | **no**, own `Semaphore(2)` | no, by decision |
| `cache_channel_photo` (CDN) | worker | **no proxy at all** | no |
| `publish_summary_text` (Bot API) | worker | **no** | no |
| `bulk_follow` probes | **API** | **no**, own `Semaphore(4)` | yes |
| `POST /telegram/scrape`, `/channel-info`, `/resolve-start-time` | **API** | **no** | no |
| `POST /telegram/bot-info`, `/publish` (Bot API) | **API** | **no** | no |
| `GET /telegram/bot-file/{id}` | **API** | bare `httpx`, no retry | no |

`cache_channel_photo` is a privacy bug, not an accounting one. Its twin
`cache_post_thumb` routes through the Lane pool with a docstring saying why:
page fetches and the media they reference must leave from the same egress, or
scraping over Tor hands Telegram's CDN the real IP. The avatar cache kept a bare
client. This is the twin-module trap `CLAUDE.md` warns about, and it is fixed in
this ticket rather than deferred.

## Decisions

### D1. The mandatory seam is the Lane, not the queue

`fetch_with_retry` raises without a Lane in context.

*Rejected:* queue everything. It turns `POST /telegram/channel-info` from a
synchronous answer into a job id the browser polls, which is a product change
smuggled inside a refactor.

### D2. `syncConcurrency` is removed entirely

Partition width becomes `sum(max_parallel)` with no truncation. The setting is
deleted from the settings blob, the registry, the runtime-config payload and the
frontend.

The reasoning that got here matters more than the outcome. The setting's own UI
copy told operators to "keep Sync concurrency at or below" proxy capacity, which
is a human being asked to maintain by hand an invariant `min()` already enforced.
And Telegram meters the unauthenticated web view by IP, which is why cooldown and
pacing are both keyed by proxy URL. More proxies genuinely is more throughput, so
a hand-set ceiling of 3 over ten proxies was throwing away most of the fleet.

The removal is **monotonic**: width goes from `min(3, sum)` to `sum`, so no
deployment narrows. One proxy stays 1, ten proxies go 3 -> 10.

*The objection that was raised and answered:* `create_engine` takes no pool
arguments, so the process has SQLAlchemy's default 5 + 10 overflow. Thirty-two
concurrent walks against fifteen connections queue silently, and the symptom is
"sync got slower, nothing is in error" — the shape this repo twice records as
undiagnosable after the fact. That is a reason to raise the pool, not to scrape
slowly. See D8.

*Consequence, and it was wrong:* this said `build_workers`'s round-robin
dealing existed only to spread a *truncated* list, so nothing truncating made
it dead. `ProxyWorkerPool._take_free` hands out the first idle worker in list
order, so lane-by-lane dealing sends the first concurrent walks down one proxy
on any deployment whose proxies have more than one slot. At the default of one
slot the two orderings are identical — which is exactly why deleting it would
have looked safe and shown up only on the deployments that had tuned up. Kept,
with the reason written into `build_workers` and asserted in
`test_proxy_worker_partition.py`.

*Also removed here, and not in the plan:* `ProxyWorker.lane` was `ProxyLane |
None`, None meaning direct egress. The synthetic Lane makes "a Slot always has
a Lane" true by construction, so the optional is gone and `build_workers([])`
now returns nothing rather than a list of Lane-less workers.

- ~~The proxy panel's "keep Sync concurrency at or below this" copy.~~ Rewritten
  to say the capacity *is* the number.

### D3. Per-proxy slots stay at 1 by default

`PROXY_DEFAULT_CONCURRENCY_DEFAULT` is unchanged. It is now the only knob that
sets Partition width, and operators raise it per deployment.

*Rejected:* raising it to 2 or 4 in the same change. Removing the ceiling and
raising the floor together means a bad result has two candidate causes.

### D4. `run_sync_job` stops owning concurrency; `_run_whole_job` is deleted

The `asyncio.Semaphore` goes. `run_sync_job` keeps the quota meter, which only it
can do, and its fan-out acquires a Slot per Channel.

`_run_whole_job` is deleted. **The staging check is done (2026-09-03) and it
clears the way**, by a stronger argument than "the lanes are empty".

`pgmq.meta` dates every lane. `manual_single_normal`, ticket 09's only lane and
therefore the only queue a legacy job-shaped message could ever have been written
to, was created 2026-08-25 09:10 UTC. Ticket 10's migration created
`auto_sync_normal` and `manual_bulk_normal` at 17:47 the same day. So the entire
population of possible legacy messages was written inside one 8.6-hour window,
nine days and many restarts ago.

Corroborating: all six `q_` tables hold zero rows, which covers claimed messages
too since a claimed message stays in `q_` with a future `vt`. Across the six
archives, 229,759 messages have drained with **zero** having a null `channelId`,
and `a_manual_single_normal` holds 33 rows whose oldest is 2026-08-28, so nothing
from the legacy window survives even there.

*Checked on staging only.* Any other deployment needs the same two queries before
this deletion ships to it.

### D5. Interactive routes hold a Lane, never a Slot. Nor does the Bot API

The API process builds **no Partition**. Its `/telegram/*` routes acquire a Lane,
which is both the egress guarantee and the rate limit. `resolve_start_time_to_id`
holds one Lane across all its fetches, being the only interactive route that
fetches more than once.

Bot API calls (`publish_summary_text`, `/telegram/publish`, `/bot-info`,
`/bot-file`) hold a Lane so a publish over Tor does not leak, and never a Slot.

*Rejected:* a Partition in the API process. It re-creates this ticket's own
double-count one level up, since per-proxy semaphores are per-process.

*Rejected:* Bot API inside the scrape Partition. A scheduled summary publish
would wait behind a deep backfill, a new failure introduced by a cleanup.

*Known and accepted:* Lanes are per-process and every API replica has its own, so
`proxyDefaultConcurrency` of 2 means 2 per process. One worker plus two API
replicas can put six requests through one proxy. Already true today; this ticket
makes it *more* accurate, because API calls that resolve no proxy today will all
take a Lane. The fix, if it ever matters, is a Postgres-backed slot table, and it
is not worth building for six low-volume routes.

### D6. `body.proxies` is removed

A request must not choose its own egress. Three frontend call sites send it
(`useFollowJob.ts:178`, `add-channel.ts:110`, `refresh-metadata.ts:44`), all
passing `activeProxies`, which is derived from `defaultProxyUrls` — a setting the
server already resolves itself. They are redundant, not legitimate.

Touches: the three schemas, `FollowJobState.proxies`, three frontend files, and a
client regeneration.

### D7. Bulk follow moves to the worker, which means it needs durability

`run_follow_job` is started by `asyncio.create_task` from an API route and
`FollowJobState` is a dataclass in a module-global dict with an
`asyncio.Condition` driving the SSE. Moving it to the worker means the API's
status route and SSE read an empty dict, and cancel sets an event nobody sees.

So it gets a `tg_follow_jobs` table mirroring `tg_sync_jobs`, `pg_notify` for
progress, and the `GET` route as the reconnect fallback. Exactly the shape
tickets 10 and 11 built for sync jobs.

*Rejected:* making a follow job a kind of sync job. Different terminal states,
different result shape.

*This is the largest single piece of the ticket and was accepted knowingly.*

### D8. Sizing derives from the Partition, and direct egress gets a Lane

`pool_size` is derived as Partition width plus fixed headroom for the scheduler
and the API, with the `to_thread` executor raised to match, since it defaults to
`min(32, cpu_count + 4)` and would become the next invisible cliff.

A deployment with no proxies gets a **synthetic direct Lane** with a configurable
width. This is what keeps D1's unconditional raise honest: the alternative is
exempting direct egress, which enforces the seam only on deployments that already
had egress control.

### D9. Discover probes get their own lane, at the lowest priority

Probes drain from a seventh lane, `discover_probe_background`, on a new lowest
tier. `LaneScheduler` is already strict between tiers, so this *is* the
"lower priority than other Telegram requests" the operator asked for, using
machinery that exists.

*Stated limit:* queue priority orders when work **starts**, not what happens to
work already running. A probe already in flight when a sync arrives keeps its
Slot. A probe is a single `t.me/<handle>` fetch, so that window is one request
long, which is why the priority-aware semaphore first proposed is not worth
building.

*Rejected:* giving probes a Budget so the name fits `lane_name(budget, tier)`.
Ticket 23 left them uncharged deliberately — `DiscoverHandleProbe` is
corpus-scoped, so billing one account for deployment-wide work is what the three
Budgets exist to prevent. A Budget on the ledger path that must then be excluded
from it is a special case pretending to be a rule.

*Rejected:* adding `background` to `TIER_ORDER`. It multiplies through the
Budget product and creates three lanes, not one.

So `DRAIN_ORDER` becomes "the Budget x tier product, plus declared non-sync lanes
each with a reason", in the shape of `EXPORT_OMISSIONS`.

### D10. `tg_discover_probes` survives

It stays the backlog of what needs probing; the lane carries the messages that
drain it. `dequeue_handles` answers "which handles still lack a verdict", which
is a question about the corpus, not about work in flight. A pgmq lane cannot
answer it, and rebuilding that as queue state is how the browser-driven version
got it wrong.

### D11. Lane helpers keep raising; a predicate is added

`lane_budget` and `lane_tier` still `raise ValueError` outside the product. A new
`is_sync_lane(lane)` predicate is what the few callers check first.

*Rejected:* returning `None`. It converts a loud failure into a value that flows
somewhere else before it fails.

### D12. The consumer dispatches on the lane it read from

`_handle_one(lane, msg, slot)` already receives the lane, and under D9 the lane
name carries the message's meaning by construction.

*Rejected:* a `kind` field. A second source of truth that can disagree with the
first.

### D13. A probe message holds a Slot

`drain_sync_lanes` acquires a Slot before it chooses a message, because that wait
is its backpressure. A probe drained by that loop gets one whether it needs it or
not, and gives it back after one fetch, at a moment when strict tier ordering
means nothing else wants it.

*Rejected:* restructuring the drain to choose before acquiring, to save holding a
Slot for one HTTP request.

### D14. The Partition moves to `proxy_pool.py`

It is a module global in `sync_queue.py` today, and `sync_orchestrator` must now
take Slots from it while deliberately not importing `sync_queue` (which is why
`ReleasableSlot` is a `Protocol`).

*Rejected:* a lazy in-function import the other way, making the cycle
bidirectional and lazy in both directions. That is how import order becomes
load-bearing.

### D15. The seam is enforced twice, and there is no convenience exemption

A runtime raise in `fetch_with_retry`, plus an inventory guard naming every
exempt call site with a reason, in the shape of `RUN_SYNC_JOB_CALLERS`.

Tests acquire a real Lane against a fake proxy pool via a fixture. The raise is
**not** skipped when no proxies are configured — that would enforce the seam only
on the population that already had egress control. An explicit
`unbound(reason=...)` in the shape of `unscoped_select` is available if a genuine
exemption ever appears.

## Work, in dependency order

1. ~~Glossary entries in `CONTEXT.md`.~~ Done.
2. ~~`cache_channel_photo` through the Lane pool.~~ Done (`fd17bae`). Small, and
   a privacy fix that should not wait behind a refactor.
3. ~~Partition moves to `proxy_pool.py`~~ (D14). Done (`becc375`). Pure move,
   no behaviour. `_load_partition_inputs` moved with it, out of
   `sync_orchestrator`, which is what removed the lazy import in each direction.
4. ~~Synthetic direct Lane and derived pool sizing~~ (D8). Done.
5. ~~Mandatory Lane binding: the raise, the fixture, the inventory guard~~
   (D1, D15). Done, and **the raise turned into a required argument** — see
   below. Everything after this depends on the seam existing.
6. ~~`run_sync_job` fans out over Slots; semaphore deleted; `_run_whole_job`
   deleted after the staging check~~ (D4). Done. `SyncSlot` and `SlotLost`
   moved to `proxy_pool` with it, which is what let `sync_orchestrator` drop
   its top-level `sync_queue` import and leave that pair with one direction
   instead of two.
7. ~~`syncConcurrency` removed end to end, including the migration that strips
   the key~~ (D2, D3). Done. The leftover would not have raised — unclassified
   fields are dropped on the way *in* — it would have been served back to the
   browser as a setting that changes nothing, which is why it is stripped.
8. ~~`body.proxies` removed, client regenerated~~ (D6). Done. There were more
   senders than the three D6 counted: `publishSummary` and `fetchBotInfo` took
   the list as a positional argument from five call sites. `buildActiveProxies`
   survives, computing a list nobody sends, because callers read its length as
   "would anything actually be routed" — truer than `proxyEnabled`, which is
   true with no URLs configured.
9. ~~Probe lane, `DRAIN_ORDER` reshaped, `is_sync_lane`, lane dispatch~~
   (D9, D11, D12, D13). Done. **No new tier**, in the end: `NON_SYNC_LANES` is
   a declared list served by an unweighted pass after `TIER_ORDER`, which is
   simpler than the "new lowest tier" the decision described and gives the same
   ordering. It also needed a **dequeue lease** nobody had thought about — see
   below.
10. ~~`tg_follow_jobs` table, `pg_notify`, SSE rewrite, `run_follow_job` moved
    to the worker~~ (D7). Done. **No queue**, in the end: a `pg_notify` trigger
    the worker consumes, in `scheduler.request_job_run`'s shape, because a
    follow job is one message that runs for minutes rather than N messages that
    each want a Slot. Its probes take Slots from the Partition directly, which
    is what removed `FOLLOW_SCRAPE_CONCURRENCY`.

## What review found

Eleven issues, three serious. Worth recording because two of them were guarded
by tests that could not see them.

1. **The probe lane was enqueued and never drained.** `_LaneBuffers` walked
   `lanes_in_tier(tier)`, and the probe lane belongs to no tier. So the sweep
   queued a batch every tick, nothing read it, every dequeue lease lapsed into a
   duplicate, and no handle ever got a verdict. `test_probe_lane.py` asserted
   the *policy* by calling `LaneScheduler.next_lane` with a hand-built
   `available` set — it never asked whether the lane reached the scheduler at
   all. Fixed with a `NON_SYNC_GROUP` the drain offers last, and two tests that
   go through `drain_sync_lanes`.
2. **The API answered with a permanently stale follow job.** `create_follow_job`
   cached its state in `_active_jobs` in the API process, `get_follow_job`
   prefers memory over the row, and the runner mutates a different copy in the
   worker — so every `GET` said `pending` for ever and `/events` never emitted
   `[DONE]`. Every test missed it because they all call
   `clear_follow_jobs_for_tests()`, emptying the dict that was wrong.
3. **Two unbounded `slot.acquire()` calls could hang for ever.** With every
   proxy parked, `_take_free` never yields, and the fan-outs in `run_sync_job`
   and `run_follow_job` had no deadline — a bulk follow's tasks would all park
   with the row left `running`. `SLOT_WAIT_SECONDS` bounds both. The
   `asyncio.Semaphore` they replaced always granted, so the Slots introduced it.

Also fixed: a worker flush could un-cancel a job cancelled by the API; the
direct Lane's width was argued from the worker's scraping needs while also
capping the whole API tier at three concurrent requests; `tg_follow_jobs` had
no retention; the probe lane inherited a 2.4-hour visibility timeout sized for
a page walk; `_cancelled` opened a session per checkpoint per handle; and
`start_bulk_follow` held the request's session open across two awaits.

## What the ticket left open

- ~~The dequeue lease is not renewed.~~ **Closed**, and by deleting the lease
  rather than renewing it. A queued message is claimed by nobody, so there was
  no holder to renew from, and the lease made `retry_after` mean two things
  depending on which writer set it. The sweep now enqueues nothing while the
  lane holds anything: emptiness is the lane's own answer to "what is
  outstanding", so a handle already queued cannot be selected however long it
  has been waiting. Costs a duty cycle — the lane drains, then waits up to one
  tick to refill — which is `DISCOVER_PROBE_JOB_INTERVAL_SECONDS`' to fix if it
  ever matters.
- **A Partition rebuilt mid-job leaves the job on the old one.** `run_sync_job`
  and `run_follow_job` capture the Partition once, and `get_partition` rebinds
  it when the proxy signature changes and nothing is busy — a window that
  exists between handles. The two pools then hand out their own Slots until the
  job ends. Bounded (it needs an operator settings change mid-job) and it
  matches the documented "an operator's change lands on the next idle drain";
  the *fetch* is unaffected, because `_proxy_acquire` resolves the lane through
  the live pool manager rather than through the captured Partition.
- **The direct Lane is one width for two processes.** In the worker it is the
  scraping width; in the API it bounds every outbound request the tier makes.
  Splitting them needs the Lane to know which process it is in, which nothing
  tells it today.

## Found while doing it

**Moving a call onto `fetch_with_retry` hands it the page-fetch retry budget,
and that is wrong for anything cosmetic or anything on a per-page path.**
`NETWORK_FETCH_RETRIES` is 8 attempts with a 3s escalating delay, sized for a
page fetch where losing the page loses the sync. The avatar cache is re-resolved
on every page of a walk, so at the default one dead avatar URL cost eight
backed-off attempts per page: `tests/api/test_sync_jobs.py` went from 13 seconds
to 8 minutes. `MEDIA_FETCH_RETRIES = 1` is the cap, shared by both image caches.

Every remaining step that moves a call onto the seam inherits this question.
Ask what the caller's retry budget should be *before* moving it, not after the
suite slows down.

**The direct Lane has to be exempt from cooldown, and nothing in D8 said so.**
Cooldown steers new work away from a failing proxy and onto the healthy ones.
There are no healthy ones when the fleet is one synthetic Lane, so arming it
stops the whole deployment for ten minutes and reports every Slot as parked —
strictly worse than the transient failure that armed it. The pace ladder below
cooldown still applies, and that is the rung that can make a single-address
deployment polite without stopping it.

**D15's runtime raise is a required argument instead, and that is stronger.**
The plan asked for `fetch_with_retry` to raise when no Lane is in context, with
a `contextvar` carrying the fact and a fixture so tests could set it. What
landed is `_fetch_once(*, client: httpx.AsyncClient)` — required, keyword-only,
no default — because the only thing that produces a client is
`build_lane_client`. A caller with no Lane cannot call it, so there is nothing
to check at runtime and no fixture to write. The `contextvar` version would
have been a rule the type checker could not see, enforced by a flag a test
could set without acquiring anything.

`_build_client` was the whole hole: `_fetch_once` fell back to it whenever no
client was passed, which made "fetch without acquiring a Lane" a one-keyword
change, and `fetch_with_retry` took it on every proxy-less deployment. It
survives as `_build_diagnostic_client`, named for its exemption, because
`test_proxy` and `get_tor_ip` ask ipify about one *named* proxy that may not be
in the pool at all.

**Moving a fetch out of the tick that dequeued it needs a lease.** The sweep
used to dequeue a batch and fetch it in the same call, so each handle got a
verdict before the tick returned and left the due set that way.
`dequeue_handles` is a pure read, and once the tick only *enqueues*, every tick
handed out the same first `DISCOVER_PROBE_BATCH_SIZE` handles again — one flood
of duplicate messages every `DISCOVER_PROBE_JOB_INTERVAL_SECONDS` for as long
as the backlog took to drain. `dequeue_handles` now moves `retry_after` forward
by `DEQUEUE_LEASE_MINUTES`, which is the column the failure backoff already
uses and means the same thing.

**Moving a job to the worker moves its cancellation too, and an
`asyncio.Event` does not cross a process.** The cancel arrives in the API and
the runner is in the worker, so `cancel_requested` had to become a column: a
ring alone would lose a cancel that arrived while the worker was restarting,
and the batch would finish after being cancelled. The same fact reshaped the
SSE stream — there is no `asyncio.Condition` in the API process to wait on any
more, so it subscribes to `pg_notify` and re-reads the row.

**A new `USER_OWNED` table trips four inventories, and that is the system
working.** `SCOPES`, the test-cleanup `TG_TABLES`, `EXPORT_OMISSIONS`, and the
frozen owner-backfill list all failed until `tg_follow_jobs` was placed in each
with a reason. The backfill one needed a new concept: `CREATED_AFTER_THE_BACKFILL`,
because "this table did not exist when revision `c0d1e2f3a4b5` ran" is a fact
about a moment that nothing in the models records. It is declared, and the
declaration is checked against the migration it names.

**Two guards written for step 4 could not fail, and both were the same
mistake.** One asserted `"db_pool_capacity()" in inspect.getsource(...)` and
stayed green against a hard-coded thread count, because a *log line* below the
sizing still named the function — the substring trap `test_worker_count.py`
already documents. The other ordered call sites by `ast.walk`, which is
breadth-first, so it reported the same sequence whichever statement came first.
Read the expression you mean, and sort by `lineno` when you mean order.

## Guards this ticket owes

- Every request out of this process holds a Lane. Runtime raise plus an AST
  inventory of exemptions with reasons.
- A walk started by `auto_summary` does not hop proxies — the property
  `test_proxy_worker_partition.py` already asserts for lane work.
- The avatar cache and the thumb cache are guarded as a **pair**, the way
  `test_photo_cache_lookup_cost.py` already is.
- `DRAIN_ORDER` is the Budget product plus declared extras, and every lane in it
  was created by a migration.
- Probes never drain while a sync lane has a message.
- `test_worker_count.py` and `test_proxy_worker_partition.py` stay green.

Mutation-test each of these before trusting it. A green suite proves nothing
until it has been watched to go red; that caught a false pass six times in the
simplification programme, including one guard that could not fail at all.

## Stale references to fix while here

- ~~`sync_queue.py:47`'s claim that ticket 13 made the `auto_summary`
  distinction stop mattering.~~ Rewritten: it is inside the Partition now and
  outside the lane ladder, which is the distinction that actually holds.
- ~~`sync_queue.py:977`'s `2N` note.~~ Gone with the behaviour.
- ~~`RUN_SYNC_JOB_CALLERS`'s reason naming `_sync_stale_channels`~~, and the
  same stale name in `sync_single_channel`'s docstring. Both now say
  `_sync_channels_for_summary`, and the inventory is down to one caller.

## Not in scope

The quota ladder still cannot see the non-lane paths, and that stays true.
`auto_summary` remains outside it deliberately: its sync is a prerequisite for a
scheduled summary, so putting it on a best-effort lane would regenerate the
summary on stale input. That was considered and rejected in the original ticket
and the reasoning survives intact.
