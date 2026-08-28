# Adaptive per-proxy wait (ticket 14)

The scraper widens its wait after Telegram pushes back and narrows it again on
sustained success, per proxy, so the deployment stops provoking rate limits
without staying permanently slow.

Handed over by ticket 13 (`docs/one-worker-per-proxy-plan.md`), which found the
two things below and deliberately left them here because both are this ticket's
subject matter.

## The rule that was wrong

`network.fetch_with_retry` armed the 10-minute proxy cooldown on any
`is_network` exception:

```python
is_network = isinstance(exc, (httpx.HTTPError, ConnectionError, OSError)) or is_soft_block
if proxy_url and is_network and not is_soft_block:
    _bad_proxies[proxy_url] = now_ms + NETWORK_PROXY_COOLDOWN_MS
```

`httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so **a 404 from one
deleted channel put its proxy in cooldown**. That predates ticket 13. What
ticket 13 changed is the consequence: cooldown used to remove a lane from
*selection*, and now it also parks the worker bound to it — so on a
single-proxy deployment one dead handle stops dispatch for ten minutes.

A status code is Telegram answering. It is not a proxy fault, and "explicit
rejection or soft block widens the wait" is exactly the distinction
`is_network` never drew.

## Four outcomes, and they are disjoint

`services/proxy_pacing.py` classifies every attempt. The classification is
total over the exception, so a type nobody thought about lands somewhere named
rather than in whichever branch happened to be first.

| Outcome | What happened | Cooldown | Pace |
|---|---|---|---|
| `SUCCESS` | Telegram served the page | cleared | narrows on sustained success |
| `TRANSPORT_FAULT` | the proxy never delivered an answer — connect error, read timeout, DNS | **armed** | unchanged |
| `REJECTION` | Telegram answered 429, 403, or 5xx | no | **widens x2** |
| `SOFT_BLOCK` | the web view served a page withholding the messages | no | **widens x2** |
| `ANSWERED_ERROR` | any other status code — 404, 410, 400, 451 | **no** | unchanged |
| `LOCAL_CONGESTION` | our own lane queue was full (`ProxyLaneUnavailable`) | no | unchanged |

`ANSWERED_ERROR` is the bug fix. `TRANSPORT_FAULT` is what `is_network` was
always trying to mean and is unchanged for genuine faults.

`LOCAL_CONGESTION` is new and it is load-bearing rather than tidy. `hold()` and
`acquire()` raise `ProxyPoolExhausted` after `ACQUIRE_TIMEOUT_SECONDS` (120s),
and `_proxy_acquire` translated that to a bare `ConnectionError` — which the
old rule filed as a proxy fault. Once this ticket makes requests wait on a
paced lane, a deep enough queue reaches that timeout *because of the pacing*,
so without a distinct type the mechanism feeds itself into the cooldown it
exists to avoid, and reports a healthy proxy as dead while doing it. It stays a
`ConnectionError` subclass so the retry loop and the sync log still handle it
exactly as before.

**A rejection no longer arms cooldown, where there is a ladder.** That is the
point of the ticket: a 429 means this egress is rate limited, and the
proportionate answer is to slow down on it, not to declare it dead for ten
minutes. Cooldown becomes the *top rung* of the same ladder — a proxy already
paced to the ceiling and still being refused has run out of ways to be polite,
and that is the one case where "send new work elsewhere" is the honest answer.

**Where there is no ladder, a rejection still parks the proxy.** Only web-view
requests are paced, so for a thumbnail, a Bot API publish or a probe the wait
never widens and the ceiling is unreachable — which review found would leave a
proxy answering 502 on every request in rotation indefinitely, a real
regression hiding inside the fix. For those the only two available answers are
"do nothing" and "cooldown", and an HTTP proxy that has failed upstream
commonly says so with its own 5xx. So `should_arm_cooldown` takes a required
`paced` keyword and the graduated ladder applies exactly where the wait is
served. It stays narrower than the rule it replaces where that matters: a 404
is an `ANSWERED_ERROR` and parks nothing either way.

## The wait

Per proxy URL, held in `network.py` beside `_bad_proxies`, which is the module
that already owns process-local proxy health. The **policy** is a separate pure
transform (`proxy_pacing.py`) for `sync_lanes.py`'s reason: the widen/narrow
property is then testable without an event loop or a proxy behind it.

Keyed by **proxy URL, never by worker**. Ticket 13 binds one worker to one lane
so per-worker and per-proxy coincide today, but the partition is per-process and
the pin survives; state keyed to a worker object would not cross a future
multi-process partition, and the two must not become synonyms in the code.

- Healthy is **zero**. A deployment that is not being pushed back on behaves
  exactly as it did before this ticket — no sleep, no measurable difference.
- A rejection or soft block widens: `max(PACE_STEP_MS, wait x 2)`, capped at
  `PACE_MAX_MS`. Multiplicative from a floor, because multiplying zero stays
  zero.
- `PACE_NARROW_AFTER_SUCCESSES` consecutive successes narrow it by
  `PACE_NARROW_FACTOR`, then the counter resets. Gradual on purpose: snapping
  back to zero on the first success re-provokes the limit that caused the
  widening, which is the oscillation the ticket's "narrows it *gradually*" is
  naming.
- Below half a step the wait snaps to zero, so a recovered proxy actually
  reaches healthy instead of decaying asymptotically toward it for ever.

### Latency drift is a weak signal, and "weak" is a number

An EMA of successful-attempt latency per proxy. An attempt more than
`PACE_DRIFT_RATIO` times the established EMA widens the wait, but:

- by `PACE_DRIFT_FACTOR` (1.25), not the rejection factor (2.0);
- never past `PACE_DRIFT_MAX_MS`, a fraction of the full ceiling. A rejection
  can push the wait to the ceiling; drift alone cannot. A proxy that is simply
  slow must not end up throttled as if it were being refused.
- only once the EMA has `PACE_DRIFT_MIN_SAMPLES` behind it, because the first
  request through a lane is always "slower than average" when there is no
  average.

It costs one float multiply on a number `fetch_with_retry` already measured for
its telemetry. No query, nothing per tick.

### Where the wait is taken

**Before** the lane permit, against a per-proxy `next_allowed_at` cursor that
each request pushes forward as it reserves its turn. Reserving and sleeping are
separate steps with no `await` between the read and the write, so concurrent
requests on a multi-slot lane space out instead of all reading the same cursor
and bursting. The pace is an interval *between* requests, so the first one
reserves and goes; the second sleeps.

The first implementation held the permit across the sleep, arguing that was
what made the wait a rate limit at the egress. Review showed it was wrong twice
over. The cursor already spaces the starts, so the permit contributed no pacing
at all — and holding it parks every *other* kind of traffic pointed at that
proxy behind the sleep. At `PACE_MAX_MS` on a one-slot lane that is four
requests per `ACQUIRE_TIMEOUT_SECONDS`, so thumbnails, bot publishes and probes
would start failing with `ProxyLaneUnavailable` and retrying eight times at two
minutes each. Exactly what ticket 13's `hold()` docstring forbids,
reintroduced by the sleep instead of by the walk.

Serving it before the permit means the egress has to be known before the
acquire, which `ProxyPoolManager.peek_lane_url` answers. A bound worker is
exact; free choice is advisory and can be overtaken by a ranking change, at a
cost of one mistimed request. That resolution also fixes the attribution of a
failure *during* the acquire, which used to be filed against the `"direct"`
egress on a deployment that has no direct egress.

A cancelled sleep gives its turn back. Cancellation reaches a running sync, and
the cursor is the one piece of state here with no self-correcting path.

**Only requests to the Telegram web view are paced**, which is the same
population the signals come from and the same predicate the quota ledger uses
(`is_telegram_web_url`). The Bot API is a different service with different
limits — making a publish wait 30 seconds because the web view is rate limited
would be punishing the wrong request.

## Two constants, and only one of them needed re-deriving

`_worst_case_fetch_seconds` **did** and was missed on the first pass. Every
attempt may now sleep up to `PACE_MAX_MS` before it goes out, so a call against
a proxy paced to the ceiling is `NETWORK_FETCH_RETRIES x PACE_MAX_MS` longer
than its arithmetic said — 240s at the shipping settings, about +28%.
`visibility_timeout_seconds` is built on that number, and a VT that
under-counts is PGMQ redelivering a message a live worker is still walking,
which is the double-scrape decision 32 sizes it against. The 2x factor was
absorbing the gap, so the failure mode was a silently shrinking margin: the
kind discovered by the thing it was meant to prevent.

Its guard pins the pace term **exactly** rather than as a lower bound. The
first version asserted `worst_case >= retries x timeout + retries x
PACE_MAX_MS` and survived its own mutation, because the backoff term alone
(381s) already exceeds the pace term (240s).

## `_NO_HEALTHY_WORKER_WAIT_SECONDS` stays 5.0, and a guard says why

Ticket 13's handover asks that if this ticket introduces deliberate waits
longer than that constant, it be re-derived from them rather than left a
literal. It is not re-derived, and the reason is that the two do not meet:

that constant bounds how long `drain_sync_lanes` waits for a **free and
healthy worker**. A worker serving a paced fetch is `busy` — not free, not
parked — so pacing never lengthens the wait for a worker; it lengthens the
message the worker is already running, which the drain observes as ordinary
backpressure through `all_busy()`. Deriving the constant from `PACE_MAX_MS`
would make every empty-queue sweep block for 30 seconds to no purpose.

"It does not need changing" is exactly the kind of claim that rots, so it is a
guard rather than a comment: a paced worker reports `busy`, and pacing is
asserted to be taken inside the message and never at acquisition.

## Telemetry

Three surfaces, all of them existing ones — extended rather than paralleled,
because ticket 13's parked/busy accounting is what an operator already reads.

1. `fetch_with_retry`'s `telemetry["attempts"][]` gains `waitedMs` (what this
   attempt actually slept) and `paceMs` (the wait in force after it). That is
   the per-request record, and it lands in the sync log payload.
2. `ProxyPoolManager.snapshot()` and the `proxyLanes` block of
   `/jobs/runtime-config` gain `paceMs`, beside the `inCooldown` flag they
   already carry.
3. Entering and leaving pacing log once each, with the wait — the same shape as
   the parked/resumed transitions, and for the same reason. Logging every
   widening would be a line per request under sustained rejection, which is how
   a signal becomes noise.

## Sequence

1. `services/proxy_pacing.py` — outcomes, classification, the pure policy.
2. `services/proxy_pool.py` — `ProxyLaneUnavailable`; `paceMs` in the snapshot.
3. `services/network.py` — the registry, the wait, the corrected cooldown rule.
4. `services/runtime_config.py` — `paceMs` on the wire.
5. `jobs/sync_queue.py` — the constant's reason, stated where it lives.
6. `tests/services/test_adaptive_proxy_wait.py` — guards, each mutation-tested
   until it goes red, and every counting guard run at the **production** retry
   setting rather than `retries=1`. Ticket 08's guards all passed against a
   broken version because they used one attempt.
