"""HTTP client with proxy lane pool, Tor support, and telemetry."""

from __future__ import annotations

import asyncio
import logging
import random
import re
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, cast

import httpx
from stem import Signal
from stem.control import Controller

from app.core.config import settings
from app.core.request_meter import record_telegram_request
from app.services.network_settings import DIRECT_EGRESS_KEY, normalize_proxy_url
from app.services.proxy_pacing import (
    FetchOutcome,
    ProxyLaneUnavailable,
    ProxyPace,
    classify_failure,
    observe_failure,
    observe_success,
    should_arm_cooldown,
)
from app.services.proxy_pool import ProxyLane
from app.services.telegram_web import (
    TelegramWebViewUnavailable,
    is_telegram_web_url,
    is_telegram_web_view_url,
    telegram_channel_post_url,
)

logger = logging.getLogger(__name__)

_bad_proxies: dict[str, float] = {}
_tor_counter_lock = asyncio.Lock()
_tor_request_counter = 0
_is_rotating_tor = False

#: The adaptive wait each egress is currently keeping, keyed by proxy URL —
#: `"direct"` for a deployment with no proxies, which is the same key the
#: attempt telemetry has always used (ticket 14).
#:
#: **Keyed by proxy, not by worker**, although ticket 13 binds one worker to one
#: lane so the two coincide today. The partition is per-process and that pin
#: survives; a dict keyed by worker object would not cross a future
#: multi-process partition, and it would silently stop being per-proxy the first
#: time one worker was replaced with another on the same lane.
_proxy_pace: dict[str, ProxyPace] = {}

#: The earliest wall-clock moment (monotonic, ms) the next request on each
#: egress may start. Separate from `_proxy_pace` because it is a *cursor* rather
#: than a policy: every request pushes it forward as it reserves its turn, which
#: is what spaces concurrent requests on a multi-slot lane out instead of
#: letting them all read the same wait and then leave together.
_pace_next_allowed_ms: dict[str, float] = {}


def _prune_expired_cooldowns(now_ms: float) -> None:
    """Expired entries were only filtered on read, so the dict grew forever."""
    for url in [u for u, until in _bad_proxies.items() if until <= now_ms]:
        _bad_proxies.pop(url, None)


def get_bad_proxies() -> list[dict[str, Any]]:
    now = time.time() * 1000
    _prune_expired_cooldowns(now)
    return [
        {
            "url": url,
            "cooldownRemaining": max(0, int((cooldown_until - now) / 1000)),
        }
        for url, cooldown_until in _bad_proxies.items()
        if now < cooldown_until
    ]


def proxy_in_cooldown(proxy_url: str) -> bool:
    now = time.time() * 1000
    return _bad_proxies.get(proxy_url, 0) > now


# --------------------------------------------------------------------------
# The adaptive per-proxy wait (ticket 14)
# --------------------------------------------------------------------------


def proxy_pace_ms(proxy_url: str) -> int:
    """The wait this egress is currently keeping between requests, in ms.

    Zero on a deployment nothing is pushing back on, which is every deployment
    most of the time — read by `ProxyPoolManager.snapshot()` and so by
    `/jobs/runtime-config`.
    """
    return int(_proxy_pace.get(proxy_url, ProxyPace()).wait_ms)


def reset_proxy_pacing_for_tests() -> None:
    _proxy_pace.clear()
    _pace_next_allowed_ms.clear()


def _store_pace(key: str, pace: ProxyPace) -> None:
    """Write the new pace back, logging only the transitions.

    Entering and leaving pacing log once each — the same shape as ticket 13's
    parked/resumed lines, and for the same reason. A line per widening would be
    a line per request under sustained rejection, which is how the signal that
    matters gets buried in the one that does not.
    """
    previous = _proxy_pace.get(key, ProxyPace())
    if previous.is_healthy and not pace.is_healthy:
        logger.warning(
            "proxy pacing engaged: %s is now waiting %dms between requests "
            "after Telegram pushed back",
            key,
            int(pace.wait_ms),
        )
    elif not previous.is_healthy and pace.is_healthy:
        logger.info("proxy pacing cleared: %s is back to full rate", key)

    if pace.is_healthy and pace.latency_ema_ms is None:
        # Nothing worth remembering: no wait and no latency history.
        #
        # This is **not** a general leak guard, and an earlier comment here
        # claimed it was. `observe_success` always sets an EMA, so any egress
        # that has ever succeeded keeps its entry for the life of the process —
        # deliberately, because the EMA is what drift is measured against and
        # discarding it would make every recovered proxy cold again. What the
        # dict is bounded by is the configured proxy list plus `"direct"`, not
        # by this branch, which only ever removes a key that failed before it
        # ever worked.
        _proxy_pace.pop(key, None)
        return
    _proxy_pace[key] = pace


def _reserve_pace_turn(key: str) -> float:
    """Claim this request's slot on the egress timeline. Returns ms to sleep.

    Synchronous by construction, and that is the whole correctness argument:
    there is no `await` between reading the cursor and writing it back, so two
    requests on a multi-slot lane cannot both read the same "next allowed"
    moment and then leave together. Each one pushes the cursor forward as it
    takes its turn, so a lane with four slots and a 2s pace still emits one
    request every 2s rather than four every 2s.
    """
    pace = _proxy_pace.get(key)
    wait_ms = pace.wait_ms if pace is not None else 0.0
    now_ms = time.monotonic() * 1000
    start_at = max(now_ms, _pace_next_allowed_ms.get(key, 0.0))

    if wait_ms <= 0 and start_at <= now_ms:
        _pace_next_allowed_ms.pop(key, None)
        return 0.0

    _pace_next_allowed_ms[key] = start_at + wait_ms
    return max(0.0, start_at - now_ms)


def _release_pace_turn(key: str, reserved_until: float, wait_ms: float) -> None:
    """Give back a turn that was reserved and never used.

    Only when the cursor is still where this reservation left it — anything
    later has already booked its turn behind ours and moving the cursor under
    it would double-book that moment.
    """
    if _pace_next_allowed_ms.get(key) != reserved_until:
        return
    rolled_back = reserved_until - wait_ms
    if rolled_back <= time.monotonic() * 1000:
        _pace_next_allowed_ms.pop(key, None)
    else:
        _pace_next_allowed_ms[key] = rolled_back


async def _wait_for_pace(key: str) -> int:
    """Sleep this request's share of the egress's wait. Returns the ms slept.

    Taken **before** the lane permit, not while holding it. Holding it was the
    first implementation and it was wrong twice over: `_reserve_pace_turn`
    already spaces the starts, so the permit added no pacing at all, while it
    did park every *other* kind of traffic pointed at that proxy behind the
    sleep — at `PACE_MAX_MS` on a one-slot lane that is four requests per
    `ACQUIRE_TIMEOUT_SECONDS`, so thumbnails and bot publishes would start
    failing with `ProxyLaneUnavailable`. Exactly what ticket 13's `hold()`
    docstring forbids, reintroduced by the sleep instead of by the walk.

    A cancelled sleep gives its turn back. Cancellation reaches a running sync
    (`POST /jobs/sync/{id}/cancel` travels over `LISTEN`/`NOTIFY`), and the
    cursor is the one piece of state here with no self-correcting path — a
    reservation nobody used would make the next request wait for a turn that
    never happened.
    """
    pace_wait = _proxy_pace.get(key, ProxyPace()).wait_ms
    delay_ms = _reserve_pace_turn(key)
    if delay_ms <= 0:
        return 0
    reserved_until = _pace_next_allowed_ms.get(key)
    try:
        await asyncio.sleep(delay_ms / 1000)
    except asyncio.CancelledError:
        if reserved_until is not None:
            _release_pace_turn(key, reserved_until, pace_wait)
        raise
    return int(delay_ms)


async def _resolve_pace_key(
    proxies: list[str] | None,
    tried: set[str],
    proxy_concurrency: tuple[int, dict[str, int]] | None,
) -> str | None:
    """Which egress this attempt will use, resolved *before* the permit.

    The wait has to know what it is pacing, and `acquire()` only reveals that
    after it has taken the slot — so this answers the same question without
    one. `None` means "do not pre-wait": every lane is excluded or in cooldown,
    and there is nothing to be timely about.

    A bound worker (ticket 13) is exact, because the binding *is* the answer.
    Free choice is advisory: `peek_lane_url` reports the lane the pool would
    pick right now, and the ranking can move before `acquire()` runs. The cost
    of being wrong is one request paced against a neighbouring lane's cursor.
    """
    if not proxies:
        return DIRECT_EGRESS_KEY

    from app.services.proxy_pool import bound_proxy_url, ensure_pool_configured

    bound = bound_proxy_url()
    if bound is not None:
        return bound

    default_slots, overrides = proxy_concurrency if proxy_concurrency else (1, {})
    pool = await ensure_pool_configured(proxies, default_slots, overrides)
    return pool.peek_lane_url(exclude=tried)


def _record_pace_success(key: str, latency_ms: float) -> None:
    _store_pace(key, observe_success(_proxy_pace.get(key, ProxyPace()), latency_ms))


def _record_pace_failure(key: str, outcome: FetchOutcome) -> ProxyPace:
    """Fold a failure in and return the pace **as it was before** it.

    The caller needs the previous value, not the new one: `should_arm_cooldown`
    asks whether the wait had already reached the ceiling when this rejection
    arrived, and the widened value is at the ceiling by construction — reading
    it after the fold would arm cooldown on the *first* rejection that reached
    the top, one step earlier than the rule says.
    """
    previous = _proxy_pace.get(key, ProxyPace())
    _store_pace(key, observe_failure(previous, outcome))
    return previous


def _validate_telegram_web_view_page(
    *, request_url: str, final_url: str, html: str
) -> None:
    if is_telegram_web_view_url(request_url) and not is_telegram_web_view_url(
        final_url
    ):
        raise TelegramWebViewUnavailable()
    if is_telegram_web_view_url(request_url):
        has_action = "tgme_page_action" in html
        has_widgets = "tgme_widget_message_date" in html
        if has_action and not has_widgets:
            raise TelegramWebViewUnavailable()


def _build_diagnostic_client(proxy_url: str | None) -> httpx.AsyncClient:
    """A one-shot client for the two proxy **diagnostics**, and nothing else.

    `test_proxy` and `get_tor_ip` ask `api.ipify.org` which address a given
    proxy exits from. Neither reaches Telegram, and neither can use a Lane:
    the operator is testing a URL that may not be in the pool at all, and
    routing the test through whichever Lane the pool picked would answer about
    the wrong proxy — which is worse than not answering.

    Named for the exemption rather than left as a general builder. It was
    `_build_client`, and `_fetch_once` fell back to it whenever no client was
    passed, which made "fetch without acquiring a Lane" a one-keyword change
    (ADR-012). `tests/services/test_egress_seam.py` holds the inventory of
    every callable allowed to reach it.
    """
    kwargs: dict[str, Any] = {
        "timeout": settings.NETWORK_FETCH_TIMEOUT_SECONDS,
        "follow_redirects": True,
    }
    if proxy_url:
        kwargs["proxy"] = normalize_proxy_url(proxy_url)
    return httpx.AsyncClient(**kwargs)


async def _fetch_once(
    url: str,
    *,
    client: httpx.AsyncClient,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    binary: bool = False,
) -> Any:
    """One request, through a Lane's client. **There is no other way out.**

    `client` is required, and the only thing that produces one is
    `proxy_pool.build_lane_client`. That is the runtime half of ADR-012's rule:
    a caller with no Lane cannot reach the network from here, because it has
    nothing to pass. The other half is the inventory in
    `tests/services/test_egress_seam.py`, which fails any module in `app/` that
    builds a client of its own.

    It used to take `client=None` and fall back to `_build_client`, an
    ephemeral client with the proxy set from the argument. That fallback was
    the whole hole: it made "fetch without acquiring anything" a one-keyword
    change, and `fetch_with_retry` took it on every proxy-less deployment.
    """

    async def _request(http_client: httpx.AsyncClient) -> Any:
        if method == "POST":
            response = await http_client.post(url, json=json_body)
        else:
            response = await http_client.get(url)
        response.raise_for_status()
        if binary:
            content_type = (
                response.headers.get("content-type", "").split(";")[0].strip()
            )
            return response.content, content_type
        data = response.text if is_telegram_web_url(url) else response.json()
        if isinstance(data, str) and is_telegram_web_view_url(url):
            _validate_telegram_web_view_page(
                request_url=url,
                final_url=str(response.url),
                html=data,
            )
        return data

    return await _request(client)


def _rotate_tor_identity_sync(control_port: int, password: str) -> None:
    with Controller.from_port(port=control_port) as controller:
        if password:
            controller.authenticate(password=password)
        else:
            controller.authenticate()
        controller.signal(Signal.NEWNYM)


async def rotate_tor_identity(
    control_port: int | None = None, password: str | None = None
) -> None:
    global _is_rotating_tor, _tor_request_counter
    if _is_rotating_tor:
        return
    _is_rotating_tor = True
    port = control_port or settings.TOR_CONTROL_PORT
    pwd = password or settings.TOR_CONTROL_PASSWORD or ""
    try:
        await asyncio.to_thread(_rotate_tor_identity_sync, port, pwd)
        _tor_request_counter = 0
        await asyncio.sleep(2)
    finally:
        _is_rotating_tor = False


@asynccontextmanager
async def _proxy_acquire(
    proxies: list[str] | None,
    tried: set[str],
    *,
    proxy_concurrency: tuple[int, dict[str, int]] | None,
) -> AsyncIterator[ProxyLane]:
    from app.services.proxy_pool import (
        ProxyPoolExhausted,
        bound_proxy_url,
        ensure_pool_configured,
        get_proxy_pool,
    )

    default_slots, overrides = proxy_concurrency if proxy_concurrency else (1, {})

    if not proxies:
        # **A caller with no proxies takes the direct Lane, and does not
        # reconfigure the pool** (ADR-012). Passing the empty list on to
        # `configure` would have this call *evict* the fleet somebody else
        # resolved — closing live clients mid-request — and the next proxied
        # caller would evict it straight back. The pool is one object shared by
        # every caller in the process; an empty list is one caller's answer, not
        # the deployment's.
        pool = get_proxy_pool()
        try:
            async with pool.hold(pool.direct_lane()) as direct:
                yield direct
        except ProxyPoolExhausted as exc:
            raise ProxyLaneUnavailable(str(exc)) from exc
        return

    pool = await ensure_pool_configured(proxies, default_slots, overrides)

    # **A bound worker does not hop, including on retry** (ticket 13). The
    # partition assigns one proxy per queued message, so every attempt this
    # call makes goes out the same egress: that is the whole of "the rate any
    # one proxy sees is predictable".
    #
    # The fallback a reader will want to add here — try another lane when this
    # one fails — is the mechanism that turns one bad proxy into several. It
    # moves a dead proxy's load onto the healthy ones at the exact moment
    # Telegram is already pushing back. Capacity is supposed to *drop* when a
    # proxy dies; redistributing hides the number this ticket exists to make
    # honest, and the Channel is picked up next sweep by a worker bound to a
    # proxy that works.
    bound = bound_proxy_url()
    if bound is not None:
        lane = pool.lane_by_url(bound)
        if lane is not None:
            # Same translation as the free-choice path below: a saturated bound
            # lane is a network fault from the caller's point of view, so it
            # goes round the retry loop and ends up in the sync log rather than
            # escaping as a type nothing above here handles.
            #
            # `ProxyLaneUnavailable` rather than a bare `ConnectionError`
            # (ticket 14). It is still a `ConnectionError`, so nothing above
            # notices — but the old bare type was indistinguishable from a proxy
            # that failed to deliver, so a full lane queue armed the ten-minute
            # cooldown. That became self-reinforcing the moment pacing landed: a
            # paced lane is exactly what makes its own queue deep enough to hit
            # `ACQUIRE_TIMEOUT_SECONDS`.
            try:
                async with pool.hold(lane) as held:
                    yield held
            except ProxyPoolExhausted as exc:
                raise ProxyLaneUnavailable(str(exc)) from exc
            return
        # The operator removed this proxy while the walk was in flight. Falling
        # through to free choice is right: the alternative fails a sync for a
        # settings edit, and there is no longer a lane to be predictable about.

    try:
        async with pool.acquire(exclude=tried) as lane:
            tried.add(lane.url)
            yield lane
    except ProxyPoolExhausted as exc:
        raise ProxyLaneUnavailable(str(exc)) from exc


#: Attempts a media fetch gets. One, meaning no retry ladder at all.
#:
#: `retries=N` is N *attempts*, and the default 8 with a 3s escalating delay is
#: sized for a page fetch, where losing the page loses the sync. Media is not
#: that. An avatar is re-resolved on **every page** of a walk, so the page loop
#: already is the retry, and a thumb is cosmetic. Left at the default, one dead
#: avatar URL cost eight backed-off attempts per page: `tests/api/test_sync_jobs.py`
#: went from 13 seconds to 8 minutes when the avatar cache first moved onto the
#: lane pool, which is what surfaced this.
#:
#: Shared by both image caches rather than spelled twice, because they are twins
#: and `test_image_cache_egress.py` asserts they stay that way.
MEDIA_FETCH_RETRIES = 1


async def fetch_with_retry(
    url: str,
    *,
    retries: int | None = None,
    initial_delay_ms: int | None = None,
    proxies: list[str] | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
    tor_control_port: int | None = None,
    method: str = "GET",
    json_body: dict[str, Any] | None = None,
    binary: bool = False,
) -> tuple[Any, dict[str, Any]]:
    """Fetch with proxy-lane retries and telemetry.

    With ``binary=True`` the payload is ``(bytes, content_type)`` instead of
    decoded text/JSON — used for media that must travel the same proxy or Tor
    lane as the page fetches, so scraping over Tor does not leak the real
    egress IP to Telegram's CDN.

    **One Request for quota purposes is one attempt Telegram answered** (ticket
    08), charged to whatever `core/request_meter` block is active — nothing, for
    the callers that are not a sync.

    Per *answered attempt*, not per call. An attempt that dies in transport —
    dead proxy, connect timeout — is charged nothing and retried for free, which
    is decision 15's "a flaky proxy is not the User's doing". An attempt that
    came back with a status code, any status code, is charged, because Telegram
    spent the same resources on it that it spends on a 200 (decision 20). The
    two rules meet here rather than at the exit: a 404 satisfies `retryable`
    and so goes round the retry branch up to `NETWORK_FETCH_RETRIES` times, and
    charging once per call would bill eight real round trips as one.

    **Two different questions are asked about the same failure** (ticket 14).
    `retryable` decides whether to go round again, and it is the old
    `is_network` under a name that does not claim more than it knows.
    `classify_failure` decides what the failure *meant* — whether the proxy is
    dead, whether Telegram is refusing this egress, or whether it simply
    answered about a channel that is gone. Cooldown and the adaptive wait both
    read the second; only the retry branch and the quota charge read the first.
    Collapsing them is the bug this ticket fixed.
    """
    global _tor_request_counter
    effective_retries = (
        retries if retries is not None else settings.NETWORK_FETCH_RETRIES
    )
    effective_initial_delay_ms = (
        initial_delay_ms
        if initial_delay_ms is not None
        else settings.NETWORK_FETCH_INITIAL_DELAY_MS
    )
    effective_tor_rotation_threshold = (
        tor_rotation_threshold
        if tor_rotation_threshold is not None
        else settings.NETWORK_TOR_ROTATION_THRESHOLD
    )
    tried: set[str] = set()
    telemetry: dict[str, Any] = {"attempts": []}
    start_total = time.time() * 1000
    counts_towards_quota = is_telegram_web_url(url)
    # The same predicate gates pacing, and that is not a coincidence worth
    # collapsing: an egress paces itself against the service whose pushback it
    # is reading. The Bot API and the media CDNs travel the same proxies and
    # answer to different limits, so making a publish wait thirty seconds
    # because the web view is throttled would punish the wrong request — and
    # taking a *signal* from one would file another service's 429 against this
    # one's pace.
    paced = counts_towards_quota

    for i in range(effective_retries):
        attempt_start = time.time() * 1000
        proxy_url: str | None = None
        waited_ms = 0
        fetch_started = attempt_start

        # Resolved **before** the acquire, which fixes two things at once. The
        # wait is then served outside the lane permit (see `_wait_for_pace`),
        # and the key is right even when the acquire itself fails — it used to
        # be assigned inside the `async with` body, so a `ProxyLaneUnavailable`
        # was folded against the `"direct"` egress and reported as
        # `"proxyUrl": "direct"` in the sync log of a proxied deployment.
        pace_key = (
            await _resolve_pace_key(proxies, tried, proxy_concurrency)
            if paced
            else None
        )
        if pace_key is not None:
            waited_ms = await _wait_for_pace(pace_key)

        try:
            # **No fork on whether proxies are configured** (ADR-012). The pool
            # synthesises a direct Lane when there are none, so this path is
            # the only one and every request out of this process leaves through
            # an acquired Lane. What the branch that used to be here did was
            # build a fresh `httpx.AsyncClient` per attempt, outside any width
            # at all: a proxy-less deployment had no connection reuse and no
            # limit on how many requests it put through its single address,
            # which is the deployment most likely to be rate limited.
            async with _proxy_acquire(
                proxies,
                tried,
                proxy_concurrency=proxy_concurrency,
            ) as lane:
                proxy_url = lane.url
                # The lane that was actually taken, which `peek_lane_url`
                # only predicted. Telemetry and the outcome signals answer
                # for the egress that served the request, never the one the
                # wait was timed against.
                if paced:
                    pace_key = proxy_url
                pool_client = lane.client
                is_local_tor = proxy_url != DIRECT_EGRESS_KEY and (
                    "127.0.0.1" in proxy_url or "localhost" in proxy_url
                )
                if is_local_tor and tor_auto_rotate:
                    async with _tor_counter_lock:
                        _tor_request_counter += 1
                        due = _tor_request_counter >= effective_tor_rotation_threshold
                    if due:
                        await rotate_tor_identity(tor_control_port)
                fetch_started = time.time() * 1000
                data = await _fetch_once(
                    url,
                    client=pool_client,
                    method=method,
                    json_body=json_body,
                    binary=binary,
                )

            _bad_proxies.pop(proxy_url, None)

            # `latency` is the **request**, timed from just before it goes out.
            #
            # Not from the top of the attempt, which is what it used to be and
            # is now wrong in two ways: it would include the deliberate pace
            # sleep, and — the one that bites on a healthy deployment — the
            # time spent queued for the lane permit. `hold()`'s own docstring
            # notes a page fetch routinely waits behind ~20 thumbnails at the
            # default of one slot, so ordinary contention would read as a
            # latency spike, trip `_is_drifting`, and throttle a proxy Telegram
            # never pushed back on. The pace feeds on this number; it must
            # measure only what Telegram did.
            latency_ms = max(0, int(time.time() * 1000 - fetch_started))
            if pace_key is not None:
                _record_pace_success(pace_key, latency_ms)

            telemetry["attempts"].append(
                {
                    "attempt": i + 1,
                    "proxyUrl": proxy_url or DIRECT_EGRESS_KEY,
                    "success": True,
                    "latency": latency_ms,
                    "waitedMs": waited_ms,
                    "paceMs": proxy_pace_ms(pace_key) if pace_key else 0,
                }
            )
            telemetry["totalDuration"] = int(time.time() * 1000 - start_total)
            telemetry["success"] = True
            if counts_towards_quota:
                record_telegram_request()
            return data, telemetry

        except Exception as exc:  # noqa: BLE001
            outcome = classify_failure(exc)
            is_soft_block = outcome is FetchOutcome.SOFT_BLOCK
            # **`retryable` is not the cooldown rule any more** (ticket 14).
            #
            # It was, and that was the bug: `httpx.HTTPStatusError` subclasses
            # `httpx.HTTPError`, so a 404 from one deleted channel put its proxy
            # in cooldown — and since ticket 13 a cooldown parks the worker
            # bound to that lane, so on a single-proxy deployment one dead
            # handle stopped dispatch for ten minutes.
            #
            # The predicate itself is **unchanged on purpose**, because it also
            # decides how many attempts a status code gets, and that is ticket
            # 08's charging contract: one Request per answered attempt, eight
            # attempts at the production setting. Narrowing it here would
            # quietly re-price the quota ledger while fixing something else.
            # What changed is that cooldown now reads `outcome` instead.
            retryable = (
                isinstance(exc, (httpx.HTTPError, ConnectionError, OSError))
                or is_soft_block
            )
            is_rate_limit = (
                isinstance(exc, httpx.HTTPStatusError)
                and exc.response.status_code == 429
            )
            # A status code means Telegram answered; a soft-blocked web view is
            # a page it served. Both cost Telegram what a 200 costs it, so both
            # are charged (decision 20). A `TelegramWebViewUnavailable` is a
            # `ConnectionError` subclass, so the obvious `is_network` test files
            # it with the dead proxies — which is why this reads the soft-block
            # flag rather than the exception's base class.
            #
            # Charged here, per attempt, and not once at the exit below. An
            # `HTTPStatusError` satisfies `is_network` (it subclasses
            # `httpx.HTTPError`), so the retry branch takes 404s and 429s round
            # again — up to `NETWORK_FETCH_RETRIES`, which is **8**. A per-call
            # charge would bill one Request for eight round trips Telegram
            # actually served, and would do it worst for the accounts under the
            # most rate-limit pressure, which are the ones generating the most
            # load. See `docs/quota-ledger-plan.md`.
            if counts_towards_quota and (
                isinstance(exc, httpx.HTTPStatusError) or is_soft_block
            ):
                record_telegram_request()

            # The wait reacts to what Telegram said; cooldown reacts to the
            # proxy failing to deliver. `should_arm_cooldown` reads the pace as
            # it was *before* this failure, so the ceiling rung fires on the
            # rejection after the wait maxed out rather than on the one that
            # maxed it.
            pace_before = (
                _record_pace_failure(pace_key, outcome)
                if pace_key is not None
                else ProxyPace()
            )
            # **The direct Lane is never parked** (ADR-012). Cooldown steers new
            # work away from a bad proxy and onto the healthy ones; with one
            # synthetic Lane there is nowhere to steer, so parking it stops the
            # whole deployment for ten minutes and reports every worker as
            # parked. The pace ladder below it still applies, which is the rung
            # that can slow a single-address deployment without stopping it.
            arms_cooldown = (
                proxy_url is not None
                and proxy_url != DIRECT_EGRESS_KEY
                and should_arm_cooldown(pace_before, outcome, paced=paced)
            )
            if arms_cooldown:
                assert proxy_url is not None
                now_ms = time.time() * 1000
                _prune_expired_cooldowns(now_ms)
                _bad_proxies[proxy_url] = now_ms + settings.NETWORK_PROXY_COOLDOWN_MS

            telemetry["attempts"].append(
                {
                    "attempt": i + 1,
                    "proxyUrl": proxy_url or DIRECT_EGRESS_KEY,
                    "success": False,
                    "error": str(exc),
                    "outcome": str(outcome),
                    # Same clock as the success path: from just before the
                    # request, so a failure that spent two minutes queued for a
                    # permit is not reported as a two-minute request. Falls
                    # back to the top of the attempt when the failure happened
                    # before a request was ever made, which is the honest
                    # number for a `LOCAL_CONGESTION`.
                    "latency": max(0, int(time.time() * 1000 - fetch_started)),
                    "waitedMs": waited_ms,
                    "paceMs": proxy_pace_ms(pace_key) if pace_key else 0,
                }
            )

            if (
                i < effective_retries - 1
                and not is_soft_block
                and (retryable or is_rate_limit)
            ):
                backoff = (2**i) * effective_initial_delay_ms + random.randint(0, 1000)
                if is_rate_limit:
                    backoff = max(backoff, 10000)
                await asyncio.sleep(backoff / 1000)
                continue

            telemetry["totalDuration"] = int(time.time() * 1000 - start_total)
            telemetry["success"] = False
            cast(Any, exc).telemetry = telemetry
            raise

    raise RuntimeError("fetch_with_retry exhausted retries")


async def test_proxy(proxy_url: str) -> dict[str, Any]:
    start = time.time() * 1000
    try:
        async with _build_diagnostic_client(proxy_url) as client:
            response = await client.get("https://api.ipify.org?format=json")
            response.raise_for_status()
            data = response.json()
            return {
                "success": True,
                "ip": data.get("ip"),
                "latency": int(time.time() * 1000 - start),
                "proxyUrl": proxy_url,
            }
    except Exception as exc:  # noqa: BLE001
        return {"success": False, "error": str(exc), "proxyUrl": proxy_url}


async def get_tor_ip() -> str:
    proxy = settings.TOR_SOCKS_PROXY
    async with _build_diagnostic_client(proxy) as client:
        response = await client.get("https://api.ipify.org?format=json")
        response.raise_for_status()
        data = response.json()
        ip = data.get("ip")
        if not isinstance(ip, str):
            raise ValueError("Unexpected response from ipify")
        return ip


async def is_port_in_use(port: int) -> bool:
    import socket

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        return sock.connect_ex(("127.0.0.1", port)) == 0


async def get_tor_status() -> dict[str, Any]:
    socks = await is_port_in_use(9050)
    control = await is_port_in_use(settings.TOR_CONTROL_PORT)
    return {
        "running": socks and control,
        "socksInUse": socks,
        "controlInUse": control,
        "autoSpawned": False,
    }


def parse_telegram_entities(text: str) -> tuple[str, list[dict[str, Any]]]:
    regex = re.compile(
        r"(\*\*(.*?)\*\*)|(\*(.*?)\*)|(_(.*?)_)|"
        r"(\[([a-zA-Z0-9_]+)\s+#(\d+)\])|(\[(.*?)\]\((.*?)\))"
    )
    plain = ""
    entities: list[dict[str, Any]] = []
    last_index = 0

    for match in regex.finditer(text):
        plain += text[last_index : match.start()]
        offset = len(plain)

        if match.group(1):
            inner = match.group(2) or ""
            plain += inner
            entities.append({"type": "bold", "offset": offset, "length": len(inner)})
        elif match.group(3):
            inner = match.group(4) or ""
            plain += inner
            entities.append({"type": "italic", "offset": offset, "length": len(inner)})
        elif match.group(5):
            inner = match.group(6) or ""
            plain += inner
            entities.append({"type": "italic", "offset": offset, "length": len(inner)})
        elif match.group(7):
            channel = match.group(8) or ""
            post_id = match.group(9) or ""
            inner = match.group(7)
            plain += inner
            entities.append(
                {
                    "type": "text_link",
                    "offset": offset,
                    "length": len(inner),
                    "url": telegram_channel_post_url(channel, int(post_id)),
                }
            )
        elif match.group(10):
            inner = match.group(11) or ""
            url = match.group(12) or ""
            plain += inner
            entities.append(
                {
                    "type": "text_link",
                    "offset": offset,
                    "length": len(inner),
                    "url": url,
                }
            )

        last_index = match.end()

    plain += text[last_index:]
    return plain, entities
