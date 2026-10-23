"""Every Request a sync makes is recorded, and the Operator reads the totals (RQS-01).

Seam 1 of `.scratch/request-stats/spec.md`: Telegram is faked at
`network._fetch_once`, the seam the quota ledger tests use, and everything above
it is real. A test posts a sync, the stand-in worker drains it through the real
Lane, the buffers are flushed, the rollup runs, and the answer is read from the
Breakdown endpoint over HTTP.

The cause, the error code and the chain id are not in any total, and the
endpoint that lists one Channel's Requests is RQS-10. Until it lands,
`_recorded` reads those three from the per-Request rows; RQS-10 should move
those assertions onto its endpoint.

The mutation that turns each test red is named on it.
"""

from __future__ import annotations

import asyncio
import threading
import time
import types
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.core.request_recording import page_for_fetch
from app.models_tg import RequestRecordRow
from app.services import network, request_stats
from app.services.request_stats import (
    flush_recorded_requests,
    roll_up_request_totals,
)
from app.services.scraper_jobs import clear_jobs_for_tests
from app.services.telegram_web import TelegramWebViewUnavailable

API = settings.API_V1_STR
CHANNEL = "rqschannel"

Response = str | tuple[bytes, str] | BaseException


def _page_html(
    channel: str,
    post_ids: list[int],
    *,
    text: str = "post",
    views: str | None = None,
    header: str = "",
) -> str:
    """A web view page holding these Posts, newest last as Telegram serves them."""
    counter = f'<span class="tgme_widget_message_views">{views}</span>' if views else ""
    messages = "".join(
        f'<div class="tgme_widget_message" data-post="{channel}/{pid}">'
        f'<div class="tgme_widget_message_text">{text} {pid}</div>'
        f"{counter}"
        f'<time datetime="{datetime.now(UTC).isoformat()}"></time>'
        f'<a class="tgme_widget_message_date" href="https://t.me/{channel}/{pid}"></a>'
        "</div>"
        for pid in sorted(post_ids)
    )
    return f"<html><body>{header}{messages}</body></html>"


def _subscribers(count: int) -> str:
    """The Channel header's subscriber counter, as the web view draws it."""
    return (
        '<div class="tgme_channel_info"><div class="tgme_channel_info_counter">'
        f'<span class="counter_value">{count}</span>'
        '<span class="counter_type">subscribers</span></div></div>'
    )


def _status(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", f"https://t.me/s/{CHANNEL}")
    return httpx.HTTPStatusError(
        str(code), request=request, response=httpx.Response(code, request=request)
    )


class FakeTelegram:
    """`_fetch_once`, answering each URL from a script.

    A URL's script is a list of answers taken in order; the last one repeats.
    A URL nobody scripted answers an empty page, so a walk that pages past
    what the test cares about stops instead of failing.
    """

    def __init__(self) -> None:
        self.scripts: dict[str, list[Response]] = {}
        self.calls: list[str] = []

    def script(self, url: str, *answers: Response) -> None:
        self.scripts[url] = list(answers)

    async def __call__(self, url: str, **_kwargs: Any) -> Any:
        self.calls.append(url)
        answers = self.scripts.get(url) or [_page_html(CHANNEL, [])]
        answer = answers.pop(0) if len(answers) > 1 else answers[0]
        if isinstance(answer, BaseException):
            raise answer
        return answer


async def _no_sleep(_seconds: float) -> None:
    await _real_sleep(0)


_real_sleep = asyncio.sleep


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> FakeTelegram:
    fake = FakeTelegram()
    monkeypatch.setattr(network, "_fetch_once", fake)
    # Retries are about what gets recorded, not about waiting: a 429 alone
    # backs off ten seconds. Only `network`'s view of asyncio loses its sleep;
    # the event loop the app runs on keeps its own.
    monkeypatch.setattr(
        network,
        "asyncio",
        types.SimpleNamespace(**{**vars(asyncio), "sleep": _no_sleep}),
    )
    monkeypatch.setattr(settings, "SYNC_RETRY_BACKOFF_BASE_MS", 0)
    return fake


@pytest.fixture(autouse=True)
def _fresh(sync_worker: None) -> Iterator[None]:
    clear_jobs_for_tests()
    flush_recorded_requests()
    yield
    clear_jobs_for_tests()


def _follow(client: TestClient, headers: dict[str, str], channel: str) -> None:
    r = client.put(
        f"{API}/data/channels/{channel}",
        json={"name": channel, "displayName": channel},
        headers=headers,
    )
    assert r.status_code == 200, r.text


def _sync(
    client: TestClient,
    headers: dict[str, str],
    channel: str = CHANNEL,
    *,
    mode: str = "individual",
) -> dict[str, Any]:
    r = client.post(
        f"{API}/jobs/sync",
        json={"channelIds": [channel], "source": "Test", "syncMode": mode},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    job_id = r.json()["jobId"]
    deadline = time.time() + 20
    while time.time() < deadline:
        job = client.get(f"{API}/jobs/sync/{job_id}", headers=headers).json()
        if job["status"] in ("completed", "failed", "cancelled"):
            return dict(job)
        time.sleep(0.05)
    raise AssertionError(f"sync {job_id} never finished")


def _today() -> tuple[str, str]:
    start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.isoformat(), (start + timedelta(days=1)).isoformat()


def _breakdown(
    client: TestClient,
    headers: dict[str, str],
    *,
    start: str | None = None,
    end: str | None = None,
    charged: str = "all",
) -> dict[str, Any]:
    flush_recorded_requests()
    roll_up_request_totals()
    day_start, day_end = _today()
    r = client.get(
        f"{API}/requests/breakdown",
        params={
            "start": start or day_start,
            "end": end or day_end,
            "charged": charged,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def _row(rows: list[dict[str, Any]], **match: Any) -> dict[str, Any]:
    found = [r for r in rows if all(r.get(k) == v for k, v in match.items())]
    assert len(found) == 1, f"{match} matched {found} in {rows}"
    return found[0]


def _recorded(**where: Any) -> list[RequestRecordRow]:
    flush_recorded_requests()
    with Session(engine) as session:
        query = select(RequestRecordRow)
        for name, value in where.items():
            query = query.where(col(getattr(RequestRecordRow, name)) == value)
        return list(session.exec(query.order_by(col(RequestRecordRow.at))).all())


def _first_page(channel: str = CHANNEL) -> str:
    return f"https://t.me/s/{channel}"


def _older_page(before: int, channel: str = CHANNEL) -> str:
    return f"https://t.me/s/{channel}?before={before}"


# --------------------------------------------------------------------------
# Recording basics
# --------------------------------------------------------------------------


def test_a_sync_page_that_brought_new_posts_is_one_useful_request(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop the record call from `fetch_with_retry`'s success path."""
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101]))

    job = _sync(client, superuser_token_headers)
    assert job["status"] == "completed", job

    answer = _breakdown(client, superuser_token_headers)
    single = _row(answer["byKind"], kind="single")
    assert single["useful"] == 1
    assert single["newPosts"] == 2
    channel = _row(answer["byChannel"], channel=CHANNEL, kind="single")
    assert channel["useful"] == 1
    assert channel["requests"] == single["requests"]


def test_a_page_that_brought_nothing_new_is_idle_and_counts_its_repeats(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: judge every answered page Useful.

    The second sync meets the two Posts the first one stored: the page
    answered and wrote nothing, which is the Channel synced more often than it
    posts.
    """
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101]))
    _sync(client, superuser_token_headers)
    before = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")

    _sync(client, superuser_token_headers)
    after = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")

    assert after["useful"] == before["useful"]
    assert after["idle"] == before["idle"] + 1
    assert after["repeatedPosts"] == before["repeatedPosts"] + 2
    assert after["newPosts"] == before["newPosts"]


def test_a_syncs_pictures_are_its_kind_and_uncharged(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: record a picture into the open Posts page.

    The avatar is fetched from Telegram's CDN while the Posts page is open. It
    is the sync's work, so it carries the sync's kind and Channel, but it is a
    page of its own (media), never charged, and never joins the page's chain.
    """
    avatar = "https://cdn4.telesco.pe/file/rqs-avatar.jpg"
    page = _page_html(CHANNEL, [100]).replace(
        "<body>",
        f'<body><div class="tgme_page_photo_image"><img src="{avatar}"></div>',
    )
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), page)
    telegram.script(avatar, (b"\xff\xd8\xff", "image/jpeg"))

    _sync(client, superuser_token_headers)

    assert avatar in telegram.calls
    pictures = _recorded(page_type="media")
    assert len(pictures) == 1
    picture = pictures[0]
    assert (picture.kind, picture.channel, picture.charged) == (
        "single",
        CHANNEL,
        False,
    )
    posts = _recorded(page_type="posts")
    assert picture.chain_id not in {p.chain_id for p in posts}

    single = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")
    charged = _row(
        _breakdown(client, superuser_token_headers, charged="charged")["byKind"],
        kind="single",
    )
    uncharged = _row(
        _breakdown(client, superuser_token_headers, charged="uncharged")["byKind"],
        kind="single",
    )
    assert charged["requests"] == len(posts)
    assert uncharged["requests"] == 1
    assert single["requests"] == len(posts) + 1
    assert single["charged"] == len(posts)


def test_each_request_names_its_account_budget_and_lane(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: record the sync's Account as nobody."""
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))

    _sync(client, superuser_token_headers, mode="bulk")

    me = client.get(f"{API}/users/me", headers=superuser_token_headers).json()
    records = _recorded(page_type="posts")
    assert records
    for record in records:
        assert record.kind == "bulk"
        assert record.account_id == uuid.UUID(me["id"])
        assert record.budget == "manual_bulk"
        assert record.lane == "direct"
        assert record.best_effort is False


@pytest.mark.parametrize(
    ("proxy_url", "lane"),
    [
        ("socks5://user:secret@10.0.0.7:1080", "10.0.0.7:1080"),
        ("http://proxy.example:3128", "proxy.example:3128"),
        ("direct", "direct"),
        (None, "direct"),
    ],
)
def test_a_lane_is_named_without_its_credentials(
    proxy_url: str | None, lane: str
) -> None:
    """Mutation: keep the userinfo in the label."""
    from app.core.request_recording import lane_label

    assert lane_label(proxy_url) == lane


def test_a_sync_past_its_budget_is_recorded_best_effort(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop the best-effort block around `_process_message`.

    An allowance of zero sends every sync to the best-effort lane (ticket 23),
    so every Request of it ran past the Budget.
    """
    monkeypatch.setattr(settings, "QUOTA_DEFAULT_MANUAL_SINGLE_REQUESTS", 0)
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))

    _sync(client, superuser_token_headers)

    records = _recorded(page_type="posts")
    assert records
    assert all(record.best_effort for record in records)


def test_an_attempt_refused_by_a_full_lane_is_not_a_request(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: record an attempt before it is handed to the client.

    The first attempt finds the Lane full and never leaves; the retry gets
    through. One Request, attempt 1.
    """
    from app.services import proxy_pool

    real_hold = proxy_pool.ProxyPoolManager.hold
    refused: list[str] = []

    def hold_once_full(self: Any, lane: Any) -> Any:
        if not refused:
            refused.append(lane.url)
            raise proxy_pool.ProxyPoolExhausted("full")
        return real_hold(self, lane)

    monkeypatch.setattr(proxy_pool.ProxyPoolManager, "hold", hold_once_full)
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))

    _sync(client, superuser_token_headers)

    assert refused
    first = [r for r in _recorded(page_type="posts") if r.new_posts]
    assert [(r.attempt, r.outcome) for r in first] == [(1, "useful")]
    assert telegram.calls.count(_first_page()) == 1


# --------------------------------------------------------------------------
# Outcomes
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("failure", "cause", "code", "charged"),
    [
        (_status(429), "turnedAway", "429", True),
        (_status(404), "answeredError", "404", True),
        (TelegramWebViewUnavailable(), "softBlock", "TelegramWebViewUnavailable", True),
        (httpx.ConnectError("refused"), "transportFault", "ConnectError", False),
    ],
)
def test_a_failed_attempt_is_wasted_with_its_cause_and_a_retry_that_answers_is_not(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
    failure: BaseException,
    cause: str,
    code: str,
    charged: bool,
) -> None:
    """Mutation: file every failure as a transport fault.

    A soft block is not retried, so the page ends there. The others fail once
    and the retry brings the page, which is Useful: every attempt is judged by
    its own answer, and "retry" is not a cause.
    """
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 3)
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), failure, _page_html(CHANNEL, [100]))

    _sync(client, superuser_token_headers)

    page = [r for r in _recorded(page_type="posts") if r.chain_id == _first_chain()]
    assert (page[0].outcome, page[0].cause, page[0].error_code) == (
        "wasted",
        cause,
        code,
    )
    assert page[0].charged is charged
    if cause != "softBlock":
        assert [(r.attempt, r.outcome, r.cause) for r in page[1:]] == [
            (2, "useful", None)
        ]
    wasted = _row(
        _breakdown(client, superuser_token_headers)["byChannel"],
        channel=CHANNEL,
        kind="single",
    )["wasted"]
    assert wasted == 1


def _useful_and_idle(client: TestClient, headers: dict[str, str]) -> tuple[int, int]:
    single = _row(_breakdown(client, headers)["byKind"], kind="single")
    return single["useful"], single["idle"]


@pytest.mark.parametrize(
    ("again", "useful"),
    [
        (_page_html(CHANNEL, [100, 101], views="20"), True),
        (_page_html(CHANNEL, [100, 101], views="10"), False),
    ],
    ids=["views moved", "views held"],
)
def test_a_page_that_moved_a_stored_posts_counters_is_useful(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    again: str,
    useful: bool,
) -> None:
    """Mutation: report the counter refresh as never moving anything.

    The second sync meets the two Posts it stored and brings nothing new, but
    their View count moved from 10 to 20, and that is a write.
    """
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101], views="10"))
    _sync(client, superuser_token_headers)
    before = _useful_and_idle(client, superuser_token_headers)

    telegram.script(_first_page(), again)
    _sync(client, superuser_token_headers)
    after = _useful_and_idle(client, superuser_token_headers)

    assert after == (before[0] + useful, before[1] + (not useful))


@pytest.mark.parametrize(
    ("text", "useful"),
    [("edited", True), ("post", False)],
    ids=["text changed", "text held"],
)
def test_a_first_pass_page_that_edited_a_stored_post_is_useful(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    text: str,
    useful: bool,
) -> None:
    """Mutation: report the initial-pass upsert as never changing a text.

    A first sync stores Post 100 from its first page and meets it again, its
    words edited, on the next page. Nothing on that page is new.
    """
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101]))
    telegram.script(_older_page(100), _page_html(CHANNEL, [100], text=text))

    _sync(client, superuser_token_headers)

    single = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")
    assert (single["newPosts"], single["repeatedPosts"]) == (2, 1)
    # The first page brought two new Posts; the second is judged by the edit.
    assert single["useful"] == 1 + useful


@pytest.mark.parametrize(
    ("subscribers", "useful"),
    [(250, True), (100, False)],
    ids=["metadata changed", "metadata held"],
)
def test_a_page_that_changed_the_channels_metadata_is_useful(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    subscribers: int,
    useful: bool,
) -> None:
    """Mutation: report the metadata refresh as never changing anything."""
    _follow(client, superuser_token_headers, CHANNEL)
    page = _page_html(CHANNEL, [100, 101], header=_subscribers(100))
    telegram.script(_first_page(), page)
    _sync(client, superuser_token_headers)
    before = _useful_and_idle(client, superuser_token_headers)

    telegram.script(
        _first_page(), _page_html(CHANNEL, [100, 101], header=_subscribers(subscribers))
    )
    _sync(client, superuser_token_headers)
    after = _useful_and_idle(client, superuser_token_headers)

    assert after == (before[0] + useful, before[1] + (not useful))


def _first_chain() -> uuid.UUID:
    return _recorded(page_type="posts", attempt=1)[0].chain_id


def test_a_chain_ties_a_pages_attempts_across_both_retry_layers(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: start a chain per `fetch_with_retry` call.

    `fetch_with_retry` gives up after two transport faults, the sync's outer
    retry asks again, and the third attempt brings the page: one page, one
    chain, attempts 1 to 3. The next page is a chain of its own.
    """
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 2)
    monkeypatch.setattr(settings, "SYNC_MAX_RETRIES", 1)
    fault = httpx.ConnectError("refused")
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), fault, fault, _page_html(CHANNEL, [100, 101]))

    _sync(client, superuser_token_headers)

    first_chain = _first_chain()
    page = [r for r in _recorded(page_type="posts") if r.chain_id == first_chain]
    assert [(r.attempt, r.outcome) for r in page] == [
        (1, "wasted"),
        (2, "wasted"),
        (3, "useful"),
    ]
    assert page[0].id == first_chain
    others = [r for r in _recorded(page_type="posts") if r.chain_id != first_chain]
    assert all(r.attempt == 1 for r in others)


# --------------------------------------------------------------------------
# Totals
# --------------------------------------------------------------------------


def test_every_tier_answers_the_same_totals(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: count only the answered Requests in the hourly rollup.

    The same Requests read three ways: today whole (daily totals), this hour
    whole (hourly totals), and a minute either side of now (the Requests
    themselves). All three must agree, a Wasted attempt included.
    """
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 3)
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(
        _first_page(), httpx.ConnectError("refused"), _page_html(CHANNEL, [100, 101])
    )
    _sync(client, superuser_token_headers)

    now = datetime.now(UTC)
    if now.minute in (0, 59) or now.hour in (0, 23):
        pytest.skip("too close to an hour or day edge to cut a range around now")
    hour = now.replace(minute=0, second=0, microsecond=0)
    daily = _breakdown(client, superuser_token_headers)
    hourly = _breakdown(
        client,
        superuser_token_headers,
        start=hour.isoformat(),
        end=(hour + timedelta(hours=1)).isoformat(),
    )
    minutes = _breakdown(
        client,
        superuser_token_headers,
        start=(now - timedelta(minutes=1)).isoformat(),
        end=(now + timedelta(minutes=2)).isoformat(),
    )
    assert daily["byKind"]
    assert daily["byKind"] == hourly["byKind"] == minutes["byKind"]
    assert daily["byChannel"] == hourly["byChannel"] == minutes["byChannel"]


def test_rolling_up_twice_changes_nothing(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: skip the delete before re-inserting an hour's totals."""
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))
    _sync(client, superuser_token_headers)

    once = _breakdown(client, superuser_token_headers)
    roll_up_request_totals()
    roll_up_request_totals()
    assert _breakdown(client, superuser_token_headers) == once


def test_a_request_in_an_hour_already_rolled_up_is_counted(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: roll up only the hours after the last one rolled up.

    The second sync lands in the hour the first rollup already wrote, which is
    the shape of every rollup but the first in an hour: that hour has to be
    rebuilt, not skipped.
    """
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))
    _sync(client, superuser_token_headers)
    first = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")

    _sync(client, superuser_token_headers)
    second = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="single")

    assert second["requests"] > first["requests"]
    assert second["requests"] == len(_recorded())


def test_a_flush_returns_once_every_request_before_it_is_written(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drain the buffer outside the flush lock.

    The worker flushes beside the ledger after the job already reads
    completed, so a reader's flush can find the buffer empty while that flush
    is still writing what it took. The reader's flush must wait for it: this
    raced `test_a_syncs_pictures_are_its_kind_and_uncharged` (RQS-11).
    """
    writing = threading.Event()
    real_asdict = request_stats.asdict

    def slow_asdict(record: Any) -> dict[str, Any]:
        writing.set()
        time.sleep(0.3)
        return real_asdict(record)

    monkeypatch.setattr(request_stats, "asdict", slow_asdict)
    page_for_fetch(media=True).record(
        at=datetime.now(UTC),
        latency_ms=1,
        lane="direct",
        web_view=False,
        cause=None,
        error_code=None,
        answered=True,
    )
    worker = threading.Thread(target=flush_recorded_requests)
    worker.start()
    assert writing.wait(5)

    flush_recorded_requests()
    with Session(engine) as session:
        written = session.exec(select(RequestRecordRow)).all()
    worker.join()
    assert len(written) == 1


# --------------------------------------------------------------------------
# The API
# --------------------------------------------------------------------------


def test_a_range_is_cut_to_the_minute(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: widen a cut range to its whole hours."""
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))
    _sync(client, superuser_token_headers)

    now = datetime.now(UTC)
    if now.minute < 3:
        pytest.skip("too close to the hour to cut minutes out of it")
    hour = now.replace(minute=0, second=0, microsecond=0)
    answer = _breakdown(
        client,
        superuser_token_headers,
        start=hour.isoformat(),
        end=(now - timedelta(minutes=2)).isoformat(),
    )
    assert answer["byKind"] == []
    assert answer["byChannel"] == []


def test_the_breakdown_is_the_operators_alone(
    client: TestClient, normal_user_token_headers: dict[str, str]
) -> None:
    """Mutation: drop the `QUOTA_READ_ANY` dependency from the route."""
    start, end = _today()
    r = client.get(
        f"{API}/requests/breakdown",
        params={"start": start, "end": end},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403
