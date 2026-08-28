"""The adaptive per-proxy wait, and the cooldown rule it replaced (ticket 14).

Two things are pinned here and they fail differently.

**The classification.** `fetch_with_retry` armed the ten-minute proxy cooldown
on any `is_network` exception, and `httpx.HTTPStatusError` subclasses
`httpx.HTTPError` — so a 404 from one deleted channel put its proxy in
cooldown. Since ticket 13 a cooldown parks the worker bound to that lane, so on
a single-proxy deployment one dead handle stopped dispatch for ten minutes.
That failure is silent: throughput halves and nothing is in error.

**The pace.** A rejection widens the wait, sustained success narrows it, and
latency drift nudges it weakly. The failure mode of a controller is not "it
does nothing" — it is oscillation, or a ratchet that never comes back down, and
neither announces itself. So the guards below assert *convergence* and the
*asymmetry between signals*, not merely that a number moved.

Every counting guard that goes through `fetch_with_retry` runs at
`settings.NETWORK_FETCH_RETRIES` rather than `retries=1`. That is ticket 08's
lesson, learned the expensive way: its charging guards all passed against a
broken implementation because a single attempt never re-enters the retry
branch, which is where the bug lived. A 404 goes round eight times in
production, and eight is where this has to be checked.

The mutation to watch each guard go red is named on the guard. All of them were
run.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import pathlib
import time
from collections.abc import Generator
from dataclasses import replace
from typing import Any

import httpx
import pytest

from app.core.config import settings
from app.jobs import sync_queue
from app.services import network
from app.services.proxy_pacing import (
    PACE_DRIFT_MAX_MS,
    PACE_DRIFT_MIN_SAMPLES,
    PACE_MAX_MS,
    PACE_NARROW_AFTER_SUCCESSES,
    PACE_STEP_MS,
    FetchOutcome,
    ProxyLaneUnavailable,
    ProxyPace,
    classify_failure,
    observe_failure,
    observe_success,
    should_arm_cooldown,
)
from app.services.proxy_pool import ProxyLane, ProxyWorker, ProxyWorkerPool, bound_to
from app.services.telegram_web import TelegramWebViewUnavailable

TELEGRAM_URL = "https://t.me/s/somechannel"
BOT_API_URL = "https://api.telegram.org/bot123/sendMessage"
PROXY = "http://proxy-a.example:8080"
OTHER_PROXY = "http://proxy-b.example:8080"


@pytest.fixture(autouse=True)
def _clean_proxy_state() -> Generator[None]:
    """Cooldown and pace are module state, so a leak between tests is a lie.

    Both directions matter: a stale cooldown makes the 404 guard pass without
    the fix, and a stale pace makes a widening guard pass without a rejection.
    """
    network._bad_proxies.clear()
    network.reset_proxy_pacing_for_tests()
    yield
    network._bad_proxies.clear()
    network.reset_proxy_pacing_for_tests()


async def _no_sleep(_seconds: float) -> None:
    """These guards are about *what the wait is*, not about serving it."""
    return None


def _status_error(status_code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", TELEGRAM_URL)
    return httpx.HTTPStatusError(
        str(status_code), request=request, response=httpx.Response(status_code)
    )


def _always_raising(exc: BaseException) -> Any:
    async def _fetch_once(*_args: Any, **_kwargs: Any) -> Any:
        raise exc

    return _fetch_once


class _Binding:
    """A `ProxyBinding` pinning every attempt to one lane, as ticket 13 does.

    The guards drive the **bound** path because that is the path a sync takes:
    the queue consumer binds its slot and `fetch_with_retry` then uses that lane
    for every attempt, retries included. Driving free choice instead would run a
    different code path from production and, with a single proxy configured,
    would spend `ACQUIRE_TIMEOUT_SECONDS` per retry waiting for a lane the
    `tried` set has already excluded.
    """

    def __init__(self, url: str | None) -> None:
        self._url = url

    @property
    def proxy_url(self) -> str | None:
        return self._url


def _run_fetch(
    monkeypatch: pytest.MonkeyPatch,
    fetch_once: Any,
    *,
    url: str = TELEGRAM_URL,
    proxies: list[str] | None = None,
    retries: int | None = None,
) -> dict[str, Any]:
    """One `fetch_with_retry` at the **production** retry setting by default.

    Returns the telemetry either way, so a guard can read the per-attempt
    record whether the call succeeded or raised.
    """
    monkeypatch.setattr(network, "_fetch_once", fetch_once)
    monkeypatch.setattr(network.asyncio, "sleep", _no_sleep)
    effective = settings.NETWORK_FETCH_RETRIES if retries is None else retries

    async def _run() -> dict[str, Any]:
        with bound_to(_Binding(proxies[0] if proxies else None)):
            try:
                _data, telemetry = await network.fetch_with_retry(
                    url, retries=effective, initial_delay_ms=0, proxies=proxies
                )
                return telemetry
            except Exception as exc:  # noqa: BLE001
                return dict(getattr(exc, "telemetry", {}))

    return asyncio.run(_run())


# --------------------------------------------------------------------------
# The classification — the bug ticket 13 handed over
# --------------------------------------------------------------------------


def test_a_404_never_puts_its_proxy_in_cooldown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The headline. Mutation: classify `HTTPStatusError` as `TRANSPORT_FAULT`.

    Equivalently, restore the original rule and arm cooldown on `is_network`.
    Either way this goes red and nothing else in the suite does, which is
    exactly how the bug survived: syncing one deleted channel is an ordinary
    thing to do and the consequence lands on an unrelated channel ten minutes
    later.

    Run at eight attempts on purpose. `HTTPStatusError` satisfies the retry
    predicate, so a 404 re-enters the loop up to `NETWORK_FETCH_RETRIES` times —
    a guard using one attempt exercises none of that.
    """
    _run_fetch(monkeypatch, _always_raising(_status_error(404)), proxies=[PROXY])

    assert network.get_bad_proxies() == []
    assert not network.proxy_in_cooldown(PROXY)


def test_a_404_does_not_widen_the_wait_either(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: add `ANSWERED_ERROR` to `WIDENING_OUTCOMES`.

    The correction is not "cooldown was too strong, so pace it instead". A
    handle that no longer exists says nothing about the rate Telegram will
    accept, and slowing the egress down over it would be the same mistake
    wearing the new mechanism.
    """
    _run_fetch(monkeypatch, _always_raising(_status_error(404)), proxies=[PROXY])

    assert network.proxy_pace_ms(PROXY) == 0


def test_a_transport_fault_still_arms_cooldown(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop the `TRANSPORT_FAULT` branch from `should_arm_cooldown`.

    The other direction, and the one a fix like this is most likely to break.
    `is_network` was too wide; the answer is to narrow it, not to stop marking
    dead proxies — a proxy that never delivered an answer is still the thing
    cooldown was built for.
    """
    _run_fetch(
        monkeypatch,
        _always_raising(httpx.ConnectError("connection refused")),
        proxies=[PROXY],
    )

    assert network.proxy_in_cooldown(PROXY)


def test_a_transport_fault_does_not_widen_the_wait(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: add `TRANSPORT_FAULT` to `WIDENING_OUTCOMES`.

    Cooldown already handled it, and stacking a wait on top means the proxy
    comes back from its ten minutes still throttled for a fault that had
    nothing to do with Telegram's pacing.
    """
    _run_fetch(
        monkeypatch,
        _always_raising(httpx.ConnectError("connection refused")),
        proxies=[PROXY],
    )

    assert network.proxy_pace_ms(PROXY) == 0


def test_a_soft_block_is_not_filed_with_the_dead_proxies(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: test `ConnectionError` before `TelegramWebViewUnavailable`.

    `TelegramWebViewUnavailable` subclasses `ConnectionError`, so the obvious
    ordering files a soft block as a transport fault — the original bug, moved
    into the module written to fix it. Ticket 08 hit the same edge from the
    charging side and had to read a flag rather than the base class.
    """
    _run_fetch(
        monkeypatch, _always_raising(TelegramWebViewUnavailable()), proxies=[PROXY]
    )

    assert not network.proxy_in_cooldown(PROXY)
    assert network.proxy_pace_ms(PROXY) > 0


def test_a_full_lane_queue_is_not_a_proxy_fault() -> None:
    """Mutation: raise a bare `ConnectionError` from `_proxy_acquire` again.

    This is the self-reinforcing one. `hold()` gives up after
    `ACQUIRE_TIMEOUT_SECONDS`, and a paced lane is precisely what makes its own
    queue deep enough to reach that — so with the bare type the pace would
    manufacture the cooldown it exists to replace, and blame a healthy proxy on
    the way out.
    """
    assert classify_failure(ProxyLaneUnavailable("full")) is (
        FetchOutcome.LOCAL_CONGESTION
    )
    assert not should_arm_cooldown(
        ProxyPace(), FetchOutcome.LOCAL_CONGESTION, paced=True
    )
    assert observe_failure(ProxyPace(), FetchOutcome.LOCAL_CONGESTION) == ProxyPace()


def test_a_lane_timeout_still_reaches_callers_as_a_connection_error() -> None:
    """Mutation: make `ProxyLaneUnavailable` inherit from `Exception`.

    The new type must be invisible to everything that is not classifying it.
    The retry predicate and the sync log both key on `ConnectionError`, so a
    plain subclass swap would stop retrying a transient full lane and would
    escape as a type nothing above `fetch_with_retry` handles.
    """
    assert issubclass(ProxyLaneUnavailable, ConnectionError)


@pytest.mark.parametrize("status", [429, 403, 500, 502, 503])
def test_an_explicit_rejection_widens_rather_than_parks(status: int) -> None:
    """Mutation: return `ANSWERED_ERROR` for 429.

    A 429 is Telegram naming the problem. Widening is the proportionate answer
    and the whole product of this ticket; parking the lane for ten minutes is
    what it replaces.
    """
    assert classify_failure(_status_error(status)) is FetchOutcome.REJECTION
    assert not should_arm_cooldown(ProxyPace(), FetchOutcome.REJECTION, paced=True)
    assert observe_failure(ProxyPace(), FetchOutcome.REJECTION).wait_ms > 0


@pytest.mark.parametrize("status", [400, 404, 410, 451])
def test_a_status_about_the_resource_changes_nothing(status: int) -> None:
    """Mutation: treat any 4xx as a rejection.

    The distinction the whole ticket turns on: 429 and 403 are about *us*, 404
    and 451 are about the channel. Widening on the second kind would make one
    account's dead handles throttle every other account's syncs through the
    same egress.
    """
    outcome = classify_failure(_status_error(status))
    assert outcome is FetchOutcome.ANSWERED_ERROR
    assert not should_arm_cooldown(ProxyPace(wait_ms=PACE_MAX_MS), outcome, paced=True)
    assert observe_failure(ProxyPace(), outcome) == ProxyPace()


def test_the_classification_is_total_and_the_unknown_case_is_inert() -> None:
    """Mutation: fall through to `TRANSPORT_FAULT` instead of `UNKNOWN`.

    Every exception has to land somewhere named. The default matters more than
    the named branches, because it is what a type nobody anticipated gets — and
    a default of "the proxy is dead" is how one unhandled parse error would
    park a lane for ten minutes.
    """
    assert classify_failure(ValueError("nothing to do with the network")) is (
        FetchOutcome.UNKNOWN
    )
    assert not should_arm_cooldown(ProxyPace(), FetchOutcome.UNKNOWN, paced=True)
    assert observe_failure(ProxyPace(), FetchOutcome.UNKNOWN) == ProxyPace()


# --------------------------------------------------------------------------
# Widening and narrowing
# --------------------------------------------------------------------------


def test_the_first_rejection_moves_the_wait_off_zero() -> None:
    """Mutation: widen with a bare `wait_ms * PACE_WIDEN_FACTOR`.

    Zero times two is zero. Without the additive first step a healthy proxy
    absorbs an unbounded run of 429s and never reacts at all — the controller
    would be inert exactly when it is needed and would look implemented.
    """
    assert observe_failure(ProxyPace(), FetchOutcome.REJECTION).wait_ms == PACE_STEP_MS


def test_rejections_widen_multiplicatively_and_stop_at_the_ceiling() -> None:
    """Mutation: drop the `min(..., ceiling)`.

    Unbounded doubling reaches a wait longer than the message's visibility
    timeout in about a dozen rejections, at which point PGMQ redelivers the
    message to a second worker while the first is still asleep in it.
    """
    pace = ProxyPace()
    seen = []
    for _ in range(12):
        pace = observe_failure(pace, FetchOutcome.REJECTION)
        seen.append(pace.wait_ms)

    assert seen[:3] == [PACE_STEP_MS, PACE_STEP_MS * 2, PACE_STEP_MS * 4]
    assert max(seen) == PACE_MAX_MS
    assert pace.at_ceiling


def test_one_success_does_not_undo_a_widening() -> None:
    """Mutation: reset `wait_ms` to zero on any success.

    The oscillation this ticket's "gradually" is guarding against. Snapping
    back on the first success re-provokes the limit that caused the widening,
    and the deployment then alternates between hammering Telegram and being
    refused by it — busier than the steady state and slower than either.
    """
    paced = ProxyPace(wait_ms=4_000.0)
    after_one = observe_success(paced, latency_ms=100)

    assert after_one.wait_ms == 4_000.0


def test_narrowing_takes_a_run_of_successes_and_converges_to_zero() -> None:
    """Mutation: narrow on every success instead of every Nth.

    Two properties in one, because either alone passes a broken controller: it
    must take `PACE_NARROW_AFTER_SUCCESSES` successes to move at all, *and* it
    must actually arrive at zero rather than decaying toward it for ever. The
    floor snap is what makes the second true — without it the wait is 3ms
    indefinitely and the telemetry shows a permanently paced deployment nothing
    is pushing back on.
    """
    # Asserted before the loop, because the loop is written in terms of the
    # constant: setting it to 1 makes `range(N - 1)` empty and the "did not
    # narrow yet" assertion below passes vacuously. That mutation survived the
    # first version of this guard.
    assert PACE_NARROW_AFTER_SUCCESSES >= 2, (
        "narrowing on every success is the oscillation this guard exists for"
    )

    pace = ProxyPace(wait_ms=4_000.0)
    for _ in range(PACE_NARROW_AFTER_SUCCESSES - 1):
        pace = observe_success(pace, latency_ms=100)
    assert pace.wait_ms == 4_000.0

    pace = observe_success(pace, latency_ms=100)
    assert pace.wait_ms < 4_000.0

    for _ in range(200):
        pace = observe_success(pace, latency_ms=100)
    assert pace.wait_ms == 0.0
    assert pace.is_healthy


# --------------------------------------------------------------------------
# Latency drift: a weak signal, and "weak" is a number
# --------------------------------------------------------------------------


def _with_baseline(wait_ms: float = 0.0, latency_ms: float = 100.0) -> ProxyPace:
    pace = ProxyPace(wait_ms=wait_ms)
    for _ in range(PACE_DRIFT_MIN_SAMPLES):
        pace = observe_success(pace, latency_ms=latency_ms)
    return pace


def test_drift_needs_an_established_baseline() -> None:
    """Mutation: drop the `PACE_DRIFT_MIN_SAMPLES` check.

    The first request through a cold lane is always slower than an average that
    does not exist yet. Without the minimum, every lane throttles itself the
    moment it is configured — worst on the deployment that just added proxies
    to go faster.
    """
    pace = observe_success(ProxyPace(), latency_ms=100)
    pace = observe_success(pace, latency_ms=100_000)

    assert pace.wait_ms == 0.0


def test_sustained_drift_widens_the_wait() -> None:
    """Mutation: never widen on drift.

    The checkbox this satisfies. A proxy going slow without ever returning a
    status code is the case no other signal here can see.
    """
    pace = _with_baseline()
    drifted = observe_success(pace, latency_ms=100 * 10)

    assert drifted.wait_ms > 0


def test_drift_is_weaker_than_a_rejection_and_capped_lower() -> None:
    """Mutation: give drift `PACE_WIDEN_FACTOR` and `PACE_MAX_MS`.

    "Weak signal" has to be a number or it is decoration. Latency has many
    innocent causes — a big page, a slow hop, a noisy neighbour — and a proxy
    that is merely slow must never end up throttled as though Telegram had
    refused it. So drift climbs slower and stops far lower.
    """
    from_drift = _with_baseline()
    for _ in range(50):
        from_drift = observe_success(
            from_drift, latency_ms=from_drift.latency_ema_ms * 10
        )

    from_rejection = ProxyPace()
    for _ in range(50):
        from_rejection = observe_failure(from_rejection, FetchOutcome.REJECTION)

    assert from_drift.wait_ms <= PACE_DRIFT_MAX_MS
    assert from_rejection.wait_ms == PACE_MAX_MS
    assert from_drift.wait_ms < from_rejection.wait_ms


def test_drift_never_pulls_a_rejected_proxy_back_down() -> None:
    """Mutation: `return min(widened, ceiling)` without the early return.

    A proxy paced to 20s by 429s and then merely slow must not be *relaxed* to
    drift's 5s ceiling. Widening that can lower a wait is not widening, and the
    failure is invisible: throughput goes up and the rejections come back.

    The wait is set **after** the baseline rather than through
    `_with_baseline`, because establishing a baseline takes
    `PACE_DRIFT_MIN_SAMPLES` successes and that is enough to narrow the wait on
    the way — a first draft asserted against the seeded value and failed on the
    controller working correctly.
    """
    pace = replace(_with_baseline(), wait_ms=20_000.0)
    drifted = observe_success(pace, latency_ms=pace.latency_ema_ms * 10)

    assert drifted.wait_ms >= 20_000.0


def test_drift_is_measured_before_the_sample_joins_the_average() -> None:
    """Mutation: fold the sample into the EMA, then compare against it.

    Self-defeating in a way that still passes a naive test: at an alpha of 0.2 a
    spike drags the mean it is being compared against toward itself, and it does
    so *more* the larger the spike is. The biggest outliers are the ones the
    mutation hides best.
    """
    baseline = _with_baseline(latency_ms=100.0)
    ratio_just_over = baseline.latency_ema_ms * 2.05

    assert observe_success(baseline, latency_ms=ratio_just_over).wait_ms > 0


def test_a_drifting_success_does_not_count_toward_narrowing() -> None:
    """Mutation: increment `successes` on the drift branch too.

    A slow success is not evidence of the sustained health narrowing rewards.
    Counting it lets a lane that is drifting badly narrow its wait at the same
    time as widening it, which is a controller arguing with itself.
    """
    pace = _with_baseline(wait_ms=4_000.0)
    drifted = observe_success(pace, latency_ms=pace.latency_ema_ms * 10)

    assert drifted.successes == 0


# --------------------------------------------------------------------------
# Serving the wait
# --------------------------------------------------------------------------


def test_a_healthy_egress_waits_for_nothing_and_stores_nothing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: give `PACE_STEP_MS` as a floor to every request.

    A deployment nobody is pushing back on must not notice this ticket exists —
    ticket 13's rule for the proxy-less case, applied to the healthy case. And
    the cursor dict must stay empty, or it grows by one entry per egress ever
    seen, which is the leak `_prune_expired_cooldowns` already had to fix once.
    """

    async def _ok(*_args: Any, **_kwargs: Any) -> Any:
        return "page"

    telemetry = _run_fetch(monkeypatch, _ok, proxies=[PROXY])

    assert [a["waitedMs"] for a in telemetry["attempts"]] == [0]
    assert network._pace_next_allowed_ms == {}


def test_concurrent_requests_on_one_lane_are_spaced_not_simultaneous() -> None:
    """Mutation: read the cursor without writing it back.

    A lane with four slots and a 2s pace must emit one request every 2s, not
    four every 2s. Without the reservation each of the four reads the same
    "next allowed" moment, sleeps the same amount, and they leave together —
    a delay with none of the effect the delay is for, and it only misbehaves
    under concurrency, which is the failure that never shows up in a
    single-request test.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=2_000.0)

    reserved = [network._reserve_pace_turn(PROXY) for _ in range(4)]

    assert reserved[0] == pytest.approx(0.0, abs=50)
    assert reserved[1] == pytest.approx(2_000.0, abs=50)
    assert reserved[2] == pytest.approx(4_000.0, abs=50)
    assert reserved[3] == pytest.approx(6_000.0, abs=50)


def test_the_pace_is_kept_per_proxy_and_not_shared() -> None:
    """Mutation: key `_proxy_pace` by anything but the proxy URL.

    One rate-limited egress must not slow down a healthy one — that is the
    "per proxy" in the ticket title, and it is also what keeps capacity honest
    when one proxy of several is in trouble.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=8_000.0)

    assert network.proxy_pace_ms(PROXY) == 8_000
    assert network.proxy_pace_ms(OTHER_PROXY) == 0
    assert network._reserve_pace_turn(OTHER_PROXY) == 0.0


def test_the_wait_is_taken_outside_the_lane_permit() -> None:
    """Mutation: move `_wait_for_pace` back inside the `async with`.

    **This assertion is inverted from the one that shipped first**, following
    ticket 11's rule that an inverted assertion beats a deleted one — the
    original claimed the sleep belonged inside the hold, and review showed that
    was wrong twice over. `_reserve_pace_turn` already spaces the starts, so
    the permit contributed no pacing at all; and holding it parks every other
    kind of traffic on that proxy behind the sleep. At `PACE_MAX_MS` on a
    one-slot lane that is four requests per `ACQUIRE_TIMEOUT_SECONDS`, so
    thumbnails, bot publishes and probes would start failing with
    `ProxyLaneUnavailable` — precisely what `hold()`'s docstring forbids,
    reintroduced by the sleep rather than by the walk.

    Structural, because the property is about *where* the sleep happens and no
    return value carries it.
    """
    tree = ast.parse(inspect.getsource(network.fetch_with_retry))

    def _calls_pace(node: ast.AST) -> bool:
        return any(
            isinstance(n, ast.Call)
            and isinstance(n.func, ast.Name)
            and n.func.id == "_wait_for_pace"
            for n in ast.walk(node)
        )

    holds = [n for n in ast.walk(tree) if isinstance(n, ast.AsyncWith)]
    assert holds, "fetch_with_retry no longer acquires a lane"
    assert not any(_calls_pace(h) for h in holds), (
        "the per-proxy wait must not be served while the lane permit is held"
    )
    assert _calls_pace(tree), "fetch_with_retry no longer serves the pace at all"


def test_the_lane_is_resolved_before_the_permit_so_a_failed_acquire_is_attributed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: assign `pace_key` inside the `async with` body again.

    Two things depend on knowing the egress before the acquire. The wait cannot
    be served outside the permit without it, and a failure *during* the acquire
    has to be attributed to the proxy it was for — it used to be folded against
    the `"direct"` egress and reported as `"proxyUrl": "direct"` in the sync log
    of a deployment that has no direct egress at all.

    The **seeded pace is what makes this observable**. A failure during the
    acquire reports `paceMs` for whichever egress the attempt was attributed
    to, and `"direct"` has no pace — so with the key resolved late this reads
    zero for a deployment whose only egress is at 8s. Asserting the outcome
    alone passed against the mutation, because `LOCAL_CONGESTION` is inert
    whichever key it is filed under.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=8_000.0)

    async def _exhausted(*_args: Any, **_kwargs: Any) -> Any:  # pragma: no cover
        raise AssertionError("the acquire should have failed first")

    from app.services import proxy_pool

    def _boom(self: Any, lane: Any) -> Any:
        raise proxy_pool.ProxyPoolExhausted("no slot")

    monkeypatch.setattr(proxy_pool.ProxyPoolManager, "hold", _boom)
    telemetry = _run_fetch(monkeypatch, _exhausted, proxies=[PROXY], retries=1)

    attempt = telemetry["attempts"][0]
    assert attempt["outcome"] == str(FetchOutcome.LOCAL_CONGESTION)
    assert attempt["paceMs"] == 8_000, (
        "a failure during the acquire must be attributed to the proxy it was for"
    )
    assert not network.proxy_in_cooldown(PROXY)


def test_only_the_web_view_is_paced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Mutation: pace every URL.

    The Bot API travels the same proxies and answers to different limits. A
    publish made to wait thirty seconds because the *web view* is throttled is
    punishing the wrong request — and taking the signal from it would file
    another service's 429 against this egress's pace.

    The **cursor** is seeded as well as the pace, and that is what gives the
    guard teeth: the first request on an egress never waits by design, so
    against a freshly widened pace a paced and an unpaced call both report zero
    and "pace every URL" survives. This is the second request.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=8_000.0)
    network._pace_next_allowed_ms[PROXY] = time.monotonic() * 1000 + 8_000.0

    async def _ok(*_args: Any, **_kwargs: Any) -> Any:
        return {"ok": True}

    telemetry = _run_fetch(monkeypatch, _ok, url=BOT_API_URL, proxies=[PROXY])

    assert [a["waitedMs"] for a in telemetry["attempts"]] == [0]


def test_a_rejection_on_the_bot_api_does_not_pace_the_proxy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: record the outcome regardless of the URL.

    The other half of the same rule. Bot API rate limits are per bot token, not
    per egress IP, so folding one into this egress's pace would slow every
    channel walk on that proxy over a limit they are not subject to.
    """
    _run_fetch(
        monkeypatch,
        _always_raising(_status_error(429)),
        url=BOT_API_URL,
        proxies=[PROXY],
    )

    assert network.proxy_pace_ms(PROXY) == 0


def test_the_wait_it_served_is_not_counted_as_latency() -> None:
    """Mutation: leave `latency` as the whole attempt duration.

    The feedback loop, and the subtlest defect in the ticket. The pace feeds on
    latency drift, so counting its own sleep as latency makes every widening
    into evidence for widening again — a ratchet that climbs to the ceiling on
    a healthy proxy and never comes down.

    This is the one guard that sleeps for real: with a faked `asyncio.sleep` no
    time passes, so both the correct and the mutated version report roughly
    zero and the mutation survives.

    The cursor is seeded rather than left to the pace alone, because the
    **first** request after a widening correctly does not wait — the pace is an
    interval *between* requests, so it sets the cursor for the next one and
    goes. Only a second request sleeps, and this is that second request.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=300.0)
    network._pace_next_allowed_ms[PROXY] = time.monotonic() * 1000 + 300.0

    async def _ok(*_args: Any, **_kwargs: Any) -> Any:
        return "page"

    async def _run() -> dict[str, Any]:
        original = network._fetch_once
        network._fetch_once = _ok  # type: ignore[assignment]
        try:
            _data, telemetry = await network.fetch_with_retry(
                TELEGRAM_URL, retries=1, initial_delay_ms=0, proxies=[PROXY]
            )
            return telemetry
        finally:
            network._fetch_once = original  # type: ignore[assignment]

    started = time.monotonic()
    telemetry = asyncio.run(_run())
    elapsed_ms = (time.monotonic() - started) * 1000

    attempt = telemetry["attempts"][0]
    assert elapsed_ms >= 250, "the pace did not actually sleep"
    assert attempt["waitedMs"] >= 250
    assert attempt["latency"] < 150


# --------------------------------------------------------------------------
# The top rung
# --------------------------------------------------------------------------


def test_a_rejection_arms_cooldown_only_once_the_wait_is_at_its_ceiling() -> None:
    """Mutation: arm cooldown on any rejection, or never.

    Both halves have to hold. Arming on the first 429 is the behaviour this
    ticket removes; never arming leaves a permanently refusing proxy retried at
    the ceiling for ever, with its worker still accepting messages that cannot
    succeed. Cooldown becomes the top rung of the ladder rather than the whole
    of it.
    """
    assert not should_arm_cooldown(ProxyPace(), FetchOutcome.REJECTION, paced=True)
    assert not should_arm_cooldown(
        ProxyPace(wait_ms=PACE_MAX_MS / 2), FetchOutcome.REJECTION, paced=True
    )
    assert should_arm_cooldown(
        ProxyPace(wait_ms=PACE_MAX_MS), FetchOutcome.REJECTION, paced=True
    )


def test_the_ceiling_rung_fires_on_the_rejection_after_the_wait_maxed_out(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: fold the failure in first, then ask `should_arm_cooldown`.

    Off by one rejection, and in the unsafe direction: the widened value is at
    the ceiling by construction, so reading it after the fold arms cooldown on
    the rejection that *reached* the ceiling rather than the one that found no
    room left. The pace would never actually be given a chance at its widest.
    """
    pace = ProxyPace()
    while not pace.at_ceiling:
        assert not should_arm_cooldown(pace, FetchOutcome.REJECTION, paced=True)
        pace = observe_failure(pace, FetchOutcome.REJECTION)

    assert should_arm_cooldown(pace, FetchOutcome.REJECTION, paced=True)


def test_the_ceiling_rung_is_wired_up_in_that_order_too(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: fold the failure in, *then* read the pace for the decision.

    The policy guard above cannot catch this one — it never goes through
    `fetch_with_retry`, so it is blind to the order the call site asks in. That
    mutation survived until this guard existed, which is the whole reason
    `_record_pace_failure` returns the previous value rather than letting the
    caller re-read the dict.

    Driven one attempt at a time so the pace is observable between rejections;
    the retry loop itself is covered by the guards above.
    """
    fetch = _always_raising(_status_error(429))

    for _ in range(40):
        if network.proxy_pace_ms(PROXY) >= PACE_MAX_MS:
            break
        _run_fetch(monkeypatch, fetch, proxies=[PROXY], retries=1)
    else:  # pragma: no cover - the ceiling is reached in about eight
        pytest.fail("the pace never reached its ceiling")

    assert not network.proxy_in_cooldown(PROXY), (
        "the rejection that *reached* the ceiling must not also park the lane"
    )

    _run_fetch(monkeypatch, fetch, proxies=[PROXY], retries=1)
    assert network.proxy_in_cooldown(PROXY)


def test_a_broken_proxy_is_still_parked_on_traffic_that_has_no_ladder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop the `or not paced` arm of `should_arm_cooldown`.

    Only web-view requests are paced, so a thumbnail, a Bot API publish or a
    probe never widens the wait and `at_ceiling` is `False` for ever — which
    made the ceiling rung unreachable for them and left a proxy answering 502
    on every request in rotation indefinitely. Before this ticket `is_network`
    covered `HTTPStatusError` and parked it, so losing that would have been a
    real regression hiding inside a fix.

    An HTTP proxy that has failed upstream commonly says so with its own 5xx,
    which is why this is the case worth spending the blunt instrument on. A 404
    is an `ANSWERED_ERROR` and still parks nothing — the rule stays narrower
    than the one it replaced where that matters.
    """
    _run_fetch(
        monkeypatch,
        _always_raising(_status_error(502)),
        url=BOT_API_URL,
        proxies=[PROXY],
        retries=1,
    )

    assert network.proxy_in_cooldown(PROXY)


def test_traffic_with_no_ladder_still_ignores_a_status_about_the_resource(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: arm cooldown for any unpaced failure.

    The other side of the guard above. Widening the unpaced rule from
    `REJECTION` to "anything that failed" would re-open the original bug on the
    thumbnail path, where 404s are entirely routine — a deleted photo would
    park the proxy that fetched it.
    """
    _run_fetch(
        monkeypatch,
        _always_raising(_status_error(404)),
        url=BOT_API_URL,
        proxies=[PROXY],
        retries=1,
    )

    assert not network.proxy_in_cooldown(PROXY)


def test_the_visibility_timeout_accounts_for_the_pace() -> None:
    """Mutation: drop `pace_ms` from `_worst_case_fetch_seconds`.

    **This is the constant ticket 13's handover was actually about.** The first
    cut answered for `_NO_HEALTHY_WORKER_WAIT_SECONDS`, which turned out not to
    need it, and left the one that did untouched: every attempt may now sleep
    up to `PACE_MAX_MS` before it goes out, so a call against a proxy paced to
    the ceiling is `NETWORK_FETCH_RETRIES x PACE_MAX_MS` longer than the old
    arithmetic said.

    `visibility_timeout_seconds` is built on this number, and a VT that
    under-counts is PGMQ redelivering a message a live worker is still walking
    — the double-scrape decision 32 sizes it against. The 2x factor was
    absorbing the gap, so the failure mode was a silently shrinking margin,
    which is the kind discovered by the thing it was meant to prevent.

    The pace term is pinned **exactly**, not as a lower bound. A first version
    asserted `worst_case >= retries x timeout + retries x PACE_MAX_MS` and
    survived its own mutation, because at the shipping settings the backoff
    term alone (381s) already exceeds the pace term (240s) — the assertion was
    true whether or not the pace was counted. Restating the arithmetic here is
    the tautology worth having: it is the one place that says the two formulas
    have to agree.
    """
    retries = settings.NETWORK_FETCH_RETRIES
    backoff_ms = sum(
        (2**i) * settings.NETWORK_FETCH_INITIAL_DELAY_MS for i in range(retries - 1)
    )
    without_pace = retries * settings.NETWORK_FETCH_TIMEOUT_SECONDS + backoff_ms / 1000

    worst_case = sync_queue._worst_case_fetch_seconds()

    assert worst_case - without_pace == pytest.approx(retries * PACE_MAX_MS / 1000)
    assert sync_queue.visibility_timeout_seconds() >= 2 * worst_case - 1


def test_a_cancelled_wait_gives_its_turn_back() -> None:
    """Mutation: drop the `CancelledError` branch in `_wait_for_pace`.

    Cancellation reaches a running sync — `POST /jobs/sync/{id}/cancel` travels
    over `LISTEN`/`NOTIFY` — and the cursor is the one piece of state here with
    no self-correcting path. A reservation nobody used makes the next request
    on that egress wait for a turn that never happened.

    Both halves are asserted. Checking only that the cursor came back would
    pass against a version that never reserved a turn at all, and checking only
    that it moved would pass against the mutation — so the guard watches it go
    out and come back.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=5_000.0)
    seeded = time.monotonic() * 1000 + 5_000.0
    network._pace_next_allowed_ms[PROXY] = seeded

    reserved: list[float] = []

    async def _run() -> None:
        task = asyncio.ensure_future(network._wait_for_pace(PROXY))
        await asyncio.sleep(0)
        reserved.append(network._pace_next_allowed_ms[PROXY])
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    asyncio.run(_run())

    assert reserved[0] > seeded, "the turn was never reserved"
    assert network._pace_next_allowed_ms.get(PROXY, 0.0) == pytest.approx(seeded)


def test_a_soft_block_never_arms_cooldown_however_many_arrive() -> None:
    """Mutation: let `SOFT_BLOCK` reach the ceiling rung.

    A channel Telegram will not serve on the web view is soft-blocked for every
    egress equally, so parking a lane over it punishes the proxy for a property
    of the channel — and on a single-proxy deployment a handful of private
    channels would stop dispatch entirely.
    """
    pace = ProxyPace()
    for _ in range(50):
        assert not should_arm_cooldown(pace, FetchOutcome.SOFT_BLOCK, paced=True)
        pace = observe_failure(pace, FetchOutcome.SOFT_BLOCK)

    assert pace.at_ceiling


# --------------------------------------------------------------------------
# Telemetry, and the drain constant
# --------------------------------------------------------------------------


def test_every_attempt_reports_what_it_waited_and_what_it_was(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop `outcome` from the failed-attempt record.

    The sync log payload is the only one of the three telemetry surfaces that
    crosses processes, so it is the one an operator actually reads about the
    worker. Without the classification on the record, "the pace widened" and
    "the pace did not widen" are indistinguishable after the fact — which is
    the position this ticket started from.
    """
    telemetry = _run_fetch(
        monkeypatch, _always_raising(_status_error(429)), proxies=[PROXY], retries=3
    )

    attempts = telemetry["attempts"]
    assert len(attempts) == 3
    assert {a["outcome"] for a in attempts} == {str(FetchOutcome.REJECTION)}
    assert all("waitedMs" in a and "paceMs" in a for a in attempts)
    assert attempts[-1]["paceMs"] > attempts[0]["paceMs"]


def test_the_lane_snapshot_and_its_settings_twin_agree_on_the_shape() -> None:
    """Mutation: add `paceMs` to `snapshot()` only.

    `runtime_config` rebuilds the lane payload from settings when the pool has
    no lanes yet, so a key added to one and not the other makes a lane's shape
    depend on whether anything has fetched through it. That is the twin-module
    trap the two photo caches wrote down — a fix applied to one of a pair is
    half a fix.

    **Both** twins are inspected, which the first version did not do: it read
    `runtime_config` twice, once through a dead `.split()` that could never
    contain the identifier it searched for. So the mirror-image mutation — drop
    `paceMs` from `snapshot()`, keep it in `runtime_config` — left it green,
    and that is the direction that actually makes a lane's shape depend on
    whether anything has fetched through it.
    """
    from app.services import runtime_config
    from app.services.proxy_pool import ProxyPoolManager

    settings_twin = inspect.getsource(runtime_config._network_runtime_payload)
    pool_twin = inspect.getsource(ProxyPoolManager.snapshot)

    assert '"paceMs"' in pool_twin, "the pool's own lane payload lost paceMs"
    assert '"paceMs"' in settings_twin, (
        "the settings-built lane payload must carry paceMs like the pool's does"
    )
    assert "proxy_pace_ms" in settings_twin


def test_a_paced_worker_is_busy_rather_than_parked() -> None:
    """Mutation: make `is_parked` consult the pace as well as the cooldown.

    This is what keeps `_NO_HEALTHY_WORKER_WAIT_SECONDS` honest. A worker
    serving a paced fetch is running a message; treating it as parked would
    make the drain report "every proxy is in cooldown" for a deployment that is
    scraping perfectly well, just slowly — the parked-versus-hung confusion
    ticket 13 exists to have ended.

    The worker is given a **real lane**, because `proxy_url` is None for a
    laneless one and `is_parked` short-circuits on that — the first version of
    this guard passed against a mutation that consulted the pace, for the same
    reason `test_worker_count` once passed against its own docstring.
    """
    network._proxy_pace[PROXY] = ProxyPace(wait_ms=PACE_MAX_MS)
    lane = ProxyLane(
        url=PROXY,
        max_parallel=1,
        sem=asyncio.Semaphore(1),
        client=httpx.AsyncClient(),
    )
    worker = ProxyWorker(index=0, lane=lane)
    worker.busy = True
    pool = ProxyWorkerPool([worker], in_cooldown=lambda _url: False)

    assert worker.proxy_url == PROXY, "the guard needs a worker with a lane"
    assert not pool.is_parked(worker)
    assert pool.capacity_report() == (1, 0, 1)


def test_the_drain_gives_up_faster_than_the_pace_ceiling_on_purpose() -> None:
    """Mutation: re-derive the constant from `PACE_MAX_MS`.

    Ticket 13's handover asked that this be re-derived if deliberate waits
    longer than it appeared. They did, and it is not, because the two never
    meet: the constant bounds the wait for a *free and healthy worker*, and a
    paced worker is busy. Deriving it from the ceiling would park every
    empty-queue sweep for thirty seconds for nothing.

    Asserted as an inequality with a stated reason rather than left as a
    comment, per ticket 11's rule that an assertion nothing checks is a claim
    that rots.
    """
    assert sync_queue._NO_HEALTHY_WORKER_WAIT_SECONDS < PACE_MAX_MS / 1000
    assert sync_queue._NO_HEALTHY_WORKER_WAIT_SECONDS == 5.0


def test_the_guards_reference_functions_that_still_exist() -> None:
    """Mutation: rename `_wait_for_pace` without updating this file.

    The structural guard above greps for a name. A rename would leave it
    passing vacuously — the failure mode this repo has already shipped, where a
    `test_worker_count` assertion passed against its own docstring.
    """
    for name in ("_wait_for_pace", "_reserve_pace_turn", "_record_pace_failure"):
        assert hasattr(network, name), f"{name} is gone; the guards above are stale"

    source_path = pathlib.Path(network.__file__)
    assert "_wait_for_pace" in source_path.read_text()
