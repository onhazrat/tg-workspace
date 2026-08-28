"""Adaptive per-proxy wait: what an attempt's outcome means, and what it does
to the pace of the proxy it went out on (ticket 14).

**Kind: pure transform.** No `Session`, no client, no clock — every function
here takes state and returns state. `sync_lanes.py`'s reason: the property this
module exists for is "widen on pushback, narrow on sustained success, and
converge", and that is worth being able to test without an event loop, a proxy,
or a queue behind it. The mutable registry keyed by proxy URL lives in
`network.py`, beside `_bad_proxies`, which is the module that already owns
process-local proxy health.

## Why the classification is the ticket rather than a detail of it

`fetch_with_retry` armed the 10-minute cooldown on any `is_network` exception:

    is_network = isinstance(exc, (httpx.HTTPError, ConnectionError, OSError))

`httpx.HTTPStatusError` subclasses `httpx.HTTPError`, so **a 404 from one
deleted channel put its proxy in cooldown**. That predates ticket 13; what
ticket 13 changed is the consequence, because a cooldown now parks the worker
bound to that lane — on a single-proxy deployment, one dead handle stopped
dispatch for ten minutes.

A status code is Telegram answering. It is not a proxy fault. And "an explicit
rejection or a soft block widens the wait" is exactly the distinction
`is_network` never drew, which is why the fix belongs here and not in a
narrower `isinstance` test somewhere.

The same trap has now bitten this repo twice: ticket 08 charged the quota
ledger once per call because a 404 satisfying `is_network` re-entered the retry
branch, so one charge billed eight round trips as one. Both times the type
lattice was the thing nobody looked at.

## The outcomes are disjoint and the classification is total

`SUCCESS`           Telegram served the page. Clears cooldown; narrows the pace
                    on sustained repetition.
`TRANSPORT_FAULT`   The proxy never delivered an answer — connect error, read
                    timeout, DNS. **The only thing that arms cooldown on its
                    own**, which is what `is_network` was always trying to mean.
`REJECTION`         Telegram answered 429, 403, or 5xx. Widens the pace. Arms
                    cooldown only once the pace is at its ceiling — or straight
                    away for a request that has no ladder, because only
                    web-view traffic is paced (see `should_arm_cooldown`).
`SOFT_BLOCK`        The web view served a page withholding the messages. Widens
                    the pace, never arms cooldown — see below.
`ANSWERED_ERROR`    Any other status code: 404, 410, 400, 451. Telegram
                    answered, and the answer is about the resource rather than
                    about us. **Changes nothing.**
`LOCAL_CONGESTION`  Our own lane queue was full. Changes nothing, because it
                    says nothing about the proxy or about Telegram.
`UNKNOWN`           Anything else. Changes nothing, deliberately: a type nobody
                    anticipated lands somewhere named instead of in whichever
                    `isinstance` branch happens to be first, which is the shape
                    of the bug this module is fixing.

`ANSWERED_ERROR`, `LOCAL_CONGESTION` and `UNKNOWN` have the same *effect* and
are still three outcomes, because collapsing distinct causes into one branch on
the grounds that they behave alike today is how `is_network` came to mean four
things at once.

`LOCAL_CONGESTION` is load-bearing rather than tidy. `hold()` and `acquire()`
give up after `ACQUIRE_TIMEOUT_SECONDS` and `_proxy_acquire` translated that
into a bare `ConnectionError`, which the old rule filed as a proxy fault. Once
requests wait on a paced lane, a deep enough queue reaches that timeout
*because of the pacing* — so without a distinct type the mechanism feeds itself
into the cooldown it exists to replace, and reports a healthy proxy as dead on
the way.

## Why a rejection stops arming cooldown, and what replaced it

A 429 means this egress is rate limited. Declaring the proxy dead for ten
minutes is not proportionate to that, and on a single-proxy deployment it is
indistinguishable from an outage. Slowing down on it is the proportionate
answer, and it is the whole product of this ticket.

Cooldown does not disappear; it becomes the **top rung of the same ladder**. A
proxy already paced to `PACE_MAX_MS` and *still* being refused has run out of
ways to be polite, and "send new work elsewhere" is then the honest answer
rather than a blunt one. Without that rung, a permanently refusing proxy would
be retried at the ceiling for ever while its worker kept accepting messages
that could not succeed — which is what the pre-ticket cooldown was right about.

**A soft block never reaches that rung.** A channel Telegram will not serve on
the web view is usually private or restricted, and it is soft-blocked for every
egress equally; parking a worker over it would punish the proxy for a property
of the channel. It still widens the pace, because a *sudden* run of soft blocks
across channels that used to work is one of the ways an IP gets throttled, and
widening is cheap enough to be worth spending on an ambiguous signal. Arming a
ten-minute cooldown is not.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import StrEnum

import httpx

from app.services.telegram_web import TelegramWebViewUnavailable

# --------------------------------------------------------------------------
# Policy constants
# --------------------------------------------------------------------------

#: The wait a proxy widens to from healthy. Multiplicative widening from zero
#: stays zero, so the first step is additive and every one after it is not.
PACE_STEP_MS = 500.0

#: What an explicit rejection or a soft block multiplies the wait by.
PACE_WIDEN_FACTOR = 2.0

#: The ceiling. Also the point at which a further rejection stops meaning
#: "slow down" and starts meaning "this proxy is unusable" — see the module
#: docstring on the top rung.
PACE_MAX_MS = 30_000.0

#: Consecutive successes before the wait narrows one step. Narrowing on *every*
#: success would undo a widening as fast as one request, which re-provokes the
#: limit that caused it.
PACE_NARROW_AFTER_SUCCESSES = 5

#: What one narrowing step multiplies the wait by. Gradual on purpose: this is
#: the "narrows it gradually" half of the ticket, and the failure it avoids is
#: an oscillation between the ceiling and zero rather than a convergence.
PACE_NARROW_FACTOR = 0.7

#: Below this the wait snaps to zero. Without it a recovered proxy decays
#: asymptotically and never actually reaches healthy, so the telemetry would
#: show a permanently-slightly-paced deployment that is not being pushed back
#: on at all.
PACE_FLOOR_MS = PACE_STEP_MS / 2

#: Weight of the newest sample in the per-proxy latency EMA.
PACE_LATENCY_EMA_ALPHA = 0.2

#: How many samples the EMA needs before drift is allowed to mean anything.
#: The first request through a lane is always "slower than average" when there
#: is no average, and a cold lane must not throttle itself on that.
PACE_DRIFT_MIN_SAMPLES = 5

#: How far above the EMA an attempt must land to count as drift.
PACE_DRIFT_RATIO = 2.0

#: What drift multiplies the wait by — deliberately smaller than
#: `PACE_WIDEN_FACTOR`. Drift is a symptom with many innocent causes; a 429 is
#: Telegram saying so.
PACE_DRIFT_FACTOR = 1.25

#: The ceiling drift alone may push the wait to. A rejection can reach
#: `PACE_MAX_MS`; latency cannot. This is what makes "weak signal" a number
#: rather than an adjective — a proxy that is merely slow must not end up
#: throttled as though it were being refused.
PACE_DRIFT_MAX_MS = 5_000.0

#: Status codes that mean Telegram is refusing this egress rather than
#: answering about the resource. 5xx is included by range in `classify_failure`.
REJECTION_STATUS_CODES = frozenset({403, 429})


class FetchOutcome(StrEnum):
    """What one attempt turned out to be. See the module docstring."""

    SUCCESS = "success"
    TRANSPORT_FAULT = "transport_fault"
    REJECTION = "rejection"
    SOFT_BLOCK = "soft_block"
    ANSWERED_ERROR = "answered_error"
    LOCAL_CONGESTION = "local_congestion"
    UNKNOWN = "unknown"


class ProxyLaneUnavailable(ConnectionError):
    """Our own lane queue was full, and no request went out.

    A `ConnectionError` subclass so the retry loop and the sync log keep
    handling it exactly as they handled the bare `ConnectionError` it replaces.
    The subclass exists so `classify_failure` can tell it apart from a proxy
    that failed to deliver, which the base type cannot.

    Lives here rather than in `proxy_pool.py` so that classification depends on
    nothing that owns a client — this module stays importable by anything.
    """


def classify_failure(exc: BaseException) -> FetchOutcome:
    """Total over the exception. Order matters: the specific types first.

    `TelegramWebViewUnavailable` and `ProxyLaneUnavailable` are both
    `ConnectionError` subclasses, so a check against the base class first would
    file a soft block and a full queue with the dead proxies — which is the
    original bug in a new place.
    """
    if isinstance(exc, TelegramWebViewUnavailable):
        return FetchOutcome.SOFT_BLOCK
    if isinstance(exc, ProxyLaneUnavailable):
        return FetchOutcome.LOCAL_CONGESTION
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in REJECTION_STATUS_CODES or status >= 500:
            return FetchOutcome.REJECTION
        return FetchOutcome.ANSWERED_ERROR
    if isinstance(exc, (httpx.HTTPError, ConnectionError, OSError)):
        return FetchOutcome.TRANSPORT_FAULT
    return FetchOutcome.UNKNOWN


#: The outcomes that widen the wait. Named once here rather than repeated as a
#: literal at each branch: an eighth outcome then has to decide whether it
#: widens, instead of defaulting to "no" by being absent from a tuple somewhere.
WIDENING_OUTCOMES = frozenset({FetchOutcome.REJECTION, FetchOutcome.SOFT_BLOCK})


@dataclass(frozen=True)
class ProxyPace:
    """One proxy's pace. Frozen because every transition returns a new value.

    Keyed by **proxy URL** wherever it is stored, never by worker. Ticket 13
    binds one worker to one lane so the two coincide today, but the partition
    is per-process and that pin survives — state keyed to a worker object would
    not cross a future multi-process partition, and the day the two stop being
    synonyms is not the day to discover the code assumed they were.
    """

    wait_ms: float = 0.0
    successes: int = 0
    latency_ema_ms: float | None = None
    latency_samples: int = 0

    @property
    def is_healthy(self) -> bool:
        return self.wait_ms <= 0.0

    @property
    def at_ceiling(self) -> bool:
        return self.wait_ms >= PACE_MAX_MS


def _widened(wait_ms: float, *, factor: float, ceiling: float) -> float:
    """One widening step, never below a step and never above `ceiling`.

    `max(PACE_STEP_MS, ...)` is the whole reason the first step works: a wait of
    zero multiplied by any factor is still zero, so a healthy proxy would take
    an unbounded number of rejections to react.

    Never *lowers* the wait, which matters for the drift path: a proxy paced to
    20s by rejections must not be pulled down to drift's 5s ceiling by one slow
    request.
    """
    if wait_ms >= ceiling:
        return wait_ms
    return min(max(PACE_STEP_MS, wait_ms * factor), ceiling)


def _narrowed(wait_ms: float) -> float:
    narrowed = wait_ms * PACE_NARROW_FACTOR
    return 0.0 if narrowed < PACE_FLOOR_MS else narrowed


def observe_failure(pace: ProxyPace, outcome: FetchOutcome) -> ProxyPace:
    """Fold a failed attempt in. Only `WIDENING_OUTCOMES` change anything.

    A transport fault deliberately does *not* widen. It arms cooldown instead
    (the caller's job), and a proxy that never delivered an answer has told us
    nothing about the rate Telegram will accept — pacing on it would slow the
    lane down over a fault that has already been handled by a stronger measure.
    """
    if outcome not in WIDENING_OUTCOMES:
        return pace
    return replace(
        pace,
        wait_ms=_widened(pace.wait_ms, factor=PACE_WIDEN_FACTOR, ceiling=PACE_MAX_MS),
        successes=0,
    )


def _is_drifting(pace: ProxyPace, latency_ms: float) -> bool:
    if pace.latency_ema_ms is None or pace.latency_samples < PACE_DRIFT_MIN_SAMPLES:
        return False
    if pace.latency_ema_ms <= 0:
        return False
    return latency_ms > pace.latency_ema_ms * PACE_DRIFT_RATIO


def _folded_latency(pace: ProxyPace, latency_ms: float) -> tuple[float, int]:
    if pace.latency_ema_ms is None:
        return latency_ms, 1
    ema = (
        PACE_LATENCY_EMA_ALPHA * latency_ms
        + (1 - PACE_LATENCY_EMA_ALPHA) * pace.latency_ema_ms
    )
    return ema, pace.latency_samples + 1


def observe_success(pace: ProxyPace, latency_ms: float) -> ProxyPace:
    """Fold a successful attempt in: drift check, then narrow-or-count.

    **Drift is measured against the EMA before this sample joins it.** Folding
    first would let a spike move the mean it is being compared against — at
    `PACE_LATENCY_EMA_ALPHA` of 0.2 that blunts exactly the samples worth
    reacting to, and blunts them more the larger the spike is.

    A drifting attempt also resets the success run. It succeeded, but it is not
    evidence of the sustained health that narrowing is supposed to reward.
    """
    drifting = _is_drifting(pace, latency_ms)
    ema, samples = _folded_latency(pace, latency_ms)

    if drifting:
        return ProxyPace(
            wait_ms=_widened(
                pace.wait_ms, factor=PACE_DRIFT_FACTOR, ceiling=PACE_DRIFT_MAX_MS
            ),
            successes=0,
            latency_ema_ms=ema,
            latency_samples=samples,
        )

    successes = pace.successes + 1
    wait_ms = pace.wait_ms
    if successes >= PACE_NARROW_AFTER_SUCCESSES:
        wait_ms = _narrowed(wait_ms)
        successes = 0
    return ProxyPace(
        wait_ms=wait_ms,
        successes=successes,
        latency_ema_ms=ema,
        latency_samples=samples,
    )


def should_arm_cooldown(pace: ProxyPace, outcome: FetchOutcome, *, paced: bool) -> bool:
    """Whether this attempt's outcome means "stop sending work to this proxy".

    `pace` is the state *before* the outcome was folded in. Three cases:

    * a transport fault, always — the proxy did not deliver an answer;
    * an explicit rejection when the wait is already at the ceiling, because
      there is no wider wait left to try;
    * an explicit rejection on a request that **has no ladder**, because for it
      the only two available answers are "do nothing" and "cooldown".

    A soft block never qualifies, and neither does an answered status code.

    `paced` is a **required keyword**, ticket 32's lesson: an optional one
    would have left every existing call site passing nothing and still passing
    its tests, while silently taking the branch that never parks anything.

    ## Why the third case exists

    Only Telegram web-view requests are paced, so for a thumbnail, a Bot API
    publish or a probe the wait never widens and `at_ceiling` is `False` for
    ever — which made the ceiling rung unreachable and left a proxy answering
    502 on every request in rotation indefinitely. Before this ticket
    `is_network` covered `HTTPStatusError` and parked it. An HTTP proxy that
    has failed upstream commonly says so with its own 5xx, so losing that was a
    real regression rather than a tidier rule.

    The asymmetry is the honest one: the graduated ladder is available exactly
    where the wait is served, and where it is not, the blunt instrument is
    still better than nothing. It is narrower than what it replaces in the way
    that matters — a 404 is an `ANSWERED_ERROR` and parks nothing either way.
    """
    if outcome is FetchOutcome.TRANSPORT_FAULT:
        return True
    if outcome is not FetchOutcome.REJECTION:
        return False
    return pace.at_ceiling or not paced
