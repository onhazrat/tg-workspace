# ADR-012: The Lane is the egress seam

**Status:** Accepted (2026-09-03) — extends
[ADR-007](./ADR-007-tor-deployment.md), whose anonymity guarantee this makes
enforceable rather than conventional. Implementation plan:
[`docs/proxy-binding-seam-plan.md`](../proxy-binding-seam-plan.md).

## Context

The `t.me` web view takes no authentication, so Telegram can only meter a client
by IP. The codebase has always assumed this: proxy cooldown is keyed by URL,
the adaptive pace is per URL, and ticket 13 pinned a Channel's whole backward
walk to one proxy because pushing back is something one IP earns.

What was never enforced is that a request goes through a proxy at all. Eleven
code paths reach Telegram or a proxy. The context manager that binds a request to
one, `bound_to`, appears in exactly **one** place in the codebase.

Three separate defects came out of that, and each was found and fixed on its own:

- `cache_post_thumb` routes media through the shared lane pool, with a docstring
  saying why: page fetches and the media they reference must leave from the same
  egress, or scraping over Tor still hands Telegram's CDN the real IP. Its twin
  `cache_channel_photo` opened a bare client and fetched every channel avatar
  from the real IP for months.
- Three `/telegram/*` routes resolve proxies from `body.proxies`, so a request
  could name its own egress.
- `run_sync_job` opened an `asyncio.Semaphore` beside the proxy partition, sized
  from the same setting, so the worker ran `2N` concurrent scrapes where the
  operator had asked for `N`. Its own docstring said so and called neither number
  good.

None of these is interesting on its own. Together they are one cause: using a
proxy was a thing a call site could remember to do.

## Decision

**Every HTTP request to Telegram leaves through an acquired Lane.** A Lane is one
proxy: a long-lived client plus a limit on requests in flight through it, applying
to every kind of work. `fetch_with_retry` raises without a Lane in context.

**The mandatory seam is the Lane, not the queue.** The queue and its consumer stay
what they are, the mechanism for scheduling background work. Requiring every
Telegram-touching path to become a queue message would turn
`POST /telegram/channel-info` from a synchronous answer into a job id the browser
polls, which is a product change wearing a refactor's clothes.

**Holding a Slot stays optional and means one thing:** "I am a Channel walk, pin
me to one proxy for my whole multi-page life." A single request, a bot publish or
a handle probe takes a Lane and no Slot.

**`syncConcurrency` is deleted.** Partition width becomes the sum of per-proxy
slots with no truncation, and the database pool and thread executor derive from
that width instead of silently capping it. The setting asked an operator to keep
a hand-typed number consistent with a derived one, and its own UI copy said so:
"Keep Sync concurrency at or below this when using proxies."

**There is no convenience exemption.** A deployment with no proxies configured
gets a synthetic direct Lane rather than a bypass. Skipping the rule when no
proxies exist would enforce it only on the population that already had egress
control.

**Enforcement is doubled:** a runtime raise, plus an inventory guard naming every
exempt call site with a reason. Neither half does the other's job. The raise makes
a new call site impossible rather than discouraged; the inventory stops the
exemption list growing quietly, which is the failure prose already suffered here.

## Consequences

- **Throughput rises on every proxied deployment, and nobody regresses.** Width
  goes from `min(syncConcurrency, sum(slots))` to `sum(slots)`. One proxy stays
  at one. Ten proxies go from three concurrent walks to ten.
- **The database pool becomes load-bearing and must be stated.** `create_engine`
  took no pool arguments, so the process ran on SQLAlchemy's default five plus ten
  overflow. `syncConcurrency` at three was, by accident, the only thing standing
  between the partition and that pool. Remove one without sizing the other and
  concurrent walks queue on connections, with no error anywhere and the symptom
  "sync got slower". Same for the `asyncio.to_thread` executor and its
  `min(32, cpu_count + 4)` default.
- **An operator loses the "many exits, low parallelism" position.** With the
  ceiling gone, the only way to reduce concurrent walks is to lower per-proxy
  slots, and that limit is shared with thumbnails, bot publishes and probes. A Tor
  user wanting six circuits but two walks can no longer express it without
  throttling everything else. Accepted deliberately: the throughput of real proxy
  fleets was judged to matter more, and the position can be restored later by
  reintroducing a ceiling that defaults to the width rather than to 3.
- **Per-proxy limits stay per-process, and every API replica has its own Lanes.**
  One worker plus two API replicas can put three times `proxyDefaultConcurrency`
  through one proxy. This was already true; the seam makes it more accurate rather
  than worse, since API calls that resolve no proxy today will all take a Lane. A
  Postgres-backed slot table would make the limit deployment-wide and is not worth
  building for six low-volume routes.
- **Tests acquire a real Lane against a fake pool, through a fixture.** The cost is
  one-time and it keeps the invariant true in the environment that checks it.

## What this does not decide

**The quota ladder still cannot see the paths that never enqueue.**
`auto_summary`'s sync and bulk follow's probes are on no lane, so there is no tier
to choose for them. Binding makes them share the egress; it does not put them on
the ladder, and ticket 23's reason for keeping `auto_summary` off it stands: its
sync is a prerequisite for a scheduled summary, so deprioritising it regenerates
the summary on stale input.

**Which process work runs in.** That is a durability question, answered per job
type. Bulk follow moves to the worker and gains a durable job row for exactly that
reason, and it is a consequence of this ADR rather than part of it.

**Whether `proxyDefaultConcurrency` should rise from 1.** It is now the only knob
setting partition width, database pool and how hard the deployment leans on each
IP. Raising it in the same change that removes the ceiling would leave a bad
result with two candidate causes.
