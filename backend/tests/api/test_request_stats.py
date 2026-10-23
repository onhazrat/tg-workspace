"""Every Request to Telegram is recorded; the Operator reads the totals.

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
import logging
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

from app import main as api_main
from app.core.config import Settings, settings
from app.core.db import engine
from app.core.request_recording import RequestKind, attributed, page_for_fetch
from app.jobs import request_stats as request_stats_jobs
from app.jobs import retention
from app.jobs.discover_probe import run_discover_probe_sweep
from app.jobs.retention import run_retention_cleanup
from app.jobs.sync_queue import enqueue_sync_job
from app.models_tg import DirectoryEntry, RequestRecordRow, utc_now
from app.services import network, request_stats
from app.services.bulk_follow import run_follow_job_by_id
from app.services.channel_directory import enqueue_handles
from app.services.pgmq import queue_length
from app.services.quota import Budget, charge_requests, usage_rows
from app.services.request_stats import (
    flush_recorded_requests,
    roll_up_request_totals,
)
from app.services.scraper_jobs import clear_jobs_for_tests, create_job, get_job
from app.services.sync_lanes import DISCOVER_PROBE_LANE
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
def _fresh(sync_worker: None, request: pytest.FixtureRequest) -> Iterator[None]:
    clear_jobs_for_tests()
    flush_recorded_requests()
    yield
    clear_jobs_for_tests()
    # The guard on Other (RQS-14): every test here drives a known path, a sync,
    # a probe, a handle check, a follow or a Bot API call, and none of them may
    # record a Request nobody declared. Only a test asking for `expects_other`
    # makes one on purpose.
    if "expects_other" not in request.fixturenames:
        undeclared = [(r.page_type, r.channel) for r in _recorded(kind="other")]
        assert undeclared == [], "a known path recorded kind other"


@pytest.fixture
def expects_other() -> None:
    """This test records a Request with no work behind it. See `_fresh`."""


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
# Probes (RQS-12)
# --------------------------------------------------------------------------

HANDLE = "rqsprobed"


def _probe(client: TestClient, handle: str = HANDLE) -> None:
    """Queue `handle`, run the probe job, and wait for the worker to drain it."""
    with Session(engine) as session:
        enqueue_handles(session, [handle])
        # A re-probe: the entry holds an answer, so its refresh falls due now.
        entry = session.get(DirectoryEntry, handle)
        if entry is not None and entry.status != "unknown":
            entry.refresh_due_at = utc_now()
            session.add(entry)
            session.commit()
    client.portal.call(run_discover_probe_sweep)
    deadline = time.time() + 20
    while time.time() < deadline:
        with Session(engine) as session:
            if queue_length(session, DISCOVER_PROBE_LANE) == 0:
                return
        time.sleep(0.05)
    raise AssertionError(f"the probe of @{handle} never drained")


def _probe_page(
    post_ids: list[int], *, title: str = "Probed", subscribers: int = 100
) -> str:
    header = (
        '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title">'
        f"<span>{title}</span></div></div>"
    ) + _subscribers(subscribers)
    return _page_html(HANDLE, post_ids, header=header)


def _probes(client: TestClient, headers: dict[str, str]) -> dict[str, Any]:
    answer = _breakdown(client, headers)
    return _row(answer["byChannel"], channel=None, kind="probe")


def test_a_probe_that_adds_sample_posts_is_useful_and_records_them(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: report the verdict writer as never adding a sample Post.

    A probe is the Directory's work, charged to nobody: no Account, Uncharged,
    the handle it probed, a metadata page. Its totals carry no Channel and show
    as the one Directory probes row.
    """
    telegram.script(_first_page(HANDLE), _probe_page([7, 8, 9]))

    _probe(client)

    [record] = _recorded(kind="probe")
    assert (record.account_id, record.charged, record.channel, record.page_type) == (
        None,
        False,
        HANDLE,
        "metadata",
    )
    probes = _probes(client, superuser_token_headers)
    assert (probes["useful"], probes["newPosts"], probes["charged"]) == (1, 3, 0)
    by_kind = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="probe")
    assert by_kind["requests"] == probes["requests"] == 1
    # Ten minutes hold no whole hour, so this range reads the Requests themselves.
    now = datetime.now(UTC).replace(second=0, microsecond=0)
    cut = _breakdown(
        client,
        superuser_token_headers,
        start=(now - timedelta(minutes=5)).isoformat(),
        end=(now + timedelta(minutes=5)).isoformat(),
    )
    assert _row(cut["byChannel"], channel=None, kind="probe")["useful"] == 1


@pytest.mark.parametrize(
    ("again", "useful", "new_posts"),
    [
        (_probe_page([7, 8]), False, 0),
        (_probe_page([7, 8], title="Renamed"), True, 0),
        (_probe_page([7, 8], subscribers=250), True, 0),
        (_probe_page([7, 8, 9]), True, 1),
    ],
    ids=["same verdict", "title changed", "subscribers changed", "a new sample"],
)
def test_a_re_probe_is_useful_only_when_it_changed_the_entry(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    again: str,
    useful: bool,
    new_posts: int,
) -> None:
    """Mutations: the verdict writer reporting no change; reporting a change
    for any probe; counting every sample as new.

    The second probe meets the entry the first one wrote. Only what it changed
    about the entry, or sample Posts the entry did not hold, make it Useful.
    """
    telegram.script(_first_page(HANDLE), _probe_page([7, 8]))
    _probe(client)
    before = _probes(client, superuser_token_headers)

    telegram.script(_first_page(HANDLE), again)
    _probe(client)
    after = _probes(client, superuser_token_headers)

    assert after["requests"] == before["requests"] + 1
    assert (after["useful"], after["idle"]) == (
        before["useful"] + useful,
        before["idle"] + (not useful),
    )
    assert after["newPosts"] == before["newPosts"] + new_posts


def test_a_probe_of_a_handle_that_does_not_exist_is_wasted_as_a_missing_handle(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: leave the probe's soft block filed as a soft block.

    Telegram sends `t.me/s/<handle>` for a handle nobody holds to a page with
    no message feed, which the fetch raises on. For a probe that is the answer
    "no such handle": one Request, Wasted, and its cause says so. A sync's soft
    block keeps its own cause (`test_a_failed_attempt_is_wasted_...`).
    """
    telegram.script(_first_page(HANDLE), TelegramWebViewUnavailable())

    _probe(client)

    [record] = _recorded(kind="probe")
    assert (record.outcome, record.cause, record.channel) == (
        "wasted",
        "missingHandle",
        HANDLE,
    )
    probes = _probes(client, superuser_token_headers)
    assert (probes["requests"], probes["wasted"]) == (1, 1)


# --------------------------------------------------------------------------
# Handle checks, follows, Bot API calls and Other (RQS-14)
# --------------------------------------------------------------------------


def _check_handle(client: TestClient, headers: dict[str, str], handle: str) -> int:
    r = client.post(
        f"{API}/telegram/channel-info", json={"channelName": handle}, headers=headers
    )
    return r.status_code


@pytest.mark.parametrize(
    ("answer", "outcome", "cause"),
    [
        (_page_html(HANDLE, [5]), "idle", None),
        (TelegramWebViewUnavailable(), "wasted", "missingHandle"),
    ],
    ids=["answered", "no such handle"],
)
def test_a_handle_check_is_its_own_uncharged_aggregate_row(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    answer: Response,
    outcome: str,
    cause: str | None,
) -> None:
    """Mutations: leave the route unattributed; drop handle checks from
    AGGREGATE_KINDS; leave its soft block filed as a soft block.

    The API process checks a handle for whoever asked, writes nothing, and
    charges nobody: Idle when Telegram answered, Wasted as a missing handle
    when it has no page for it. Its totals are the one Handle checks row.
    """
    telegram.script(_first_page(HANDLE), answer)

    _check_handle(client, superuser_token_headers, HANDLE)

    [record] = _recorded(kind="handle")
    assert (record.charged, record.channel, record.page_type) == (
        False,
        HANDLE,
        "metadata",
    )
    assert (record.outcome, record.cause) == (outcome, cause)
    checks = _row(
        _breakdown(client, superuser_token_headers)["byChannel"],
        channel=None,
        kind="handle",
    )
    assert (checks["requests"], checks[outcome], checks["charged"]) == (1, 1, 0)


FOLLOWED = "rqsfollowed"


def _wait_for(client: TestClient, headers: dict[str, str], url: str) -> dict[str, Any]:
    deadline = time.time() + 20
    while time.time() < deadline:
        job = client.get(url, headers=headers).json()
        if job["status"] in ("completed", "failed", "cancelled"):
            return dict(job)
        time.sleep(0.05)
    raise AssertionError(f"{url} never finished")


def _bulk_follow(
    client: TestClient,
    headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    channel: str,
) -> None:
    """Bulk-follow one handle in this process and wait for the sync it chains."""

    async def run_here(follow_job_id: str) -> None:
        task = asyncio.create_task(run_follow_job_by_id(follow_job_id))
        _follow_tasks.add(task)
        task.add_done_callback(_follow_tasks.discard)

    monkeypatch.setattr("app.api.routes.data.channels.request_follow_job_run", run_here)
    r = client.post(
        f"{API}/data/channels/bulk-follow",
        json={"channels": [{"name": channel}]},
        headers=headers,
    )
    assert r.status_code == 200, r.text
    follow = _wait_for(
        client, headers, f"{API}/data/channels/bulk-follow/{r.json()['followJobId']}"
    )
    assert follow["added"] == 1, follow
    _wait_for(client, headers, f"{API}/jobs/sync/{follow['syncJobId']}")


def test_a_bulk_follow_is_charged_as_the_ledger_charges_it(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutations: leave the follow unattributed; drop its Budget; never judge
    the follow page.

    A bulk follow checks each handle before it adds it, charged to manual bulk
    as the ledger charges the batch. A check that added the Channel wrote
    something, so it is Useful. The sync it chains is a bulk sync of its own.
    """

    telegram.script(_first_page(FOLLOWED), _page_html(FOLLOWED, [3]))

    _bulk_follow(client, superuser_token_headers, monkeypatch, FOLLOWED)

    [record] = _recorded(kind="follow")
    assert (record.budget, record.channel, record.charged, record.account_id) == (
        "manual_bulk",
        FOLLOWED,
        True,
        _recorded(kind="bulk")[0].account_id,
    )
    answer = _breakdown(client, superuser_token_headers)
    follows = _row(answer["byChannel"], channel=FOLLOWED, kind="follow")
    assert (follows["requests"], follows["useful"], follows["charged"]) == (1, 1, 1)


_follow_tasks: set[asyncio.Task[None]] = set()


def test_an_auto_follow_inside_a_sync_is_that_syncs_work(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: attribute the auto-follow's check as a follow of its own.

    A synced Post forwarded from another Channel makes the sync follow that
    Channel, after checking its handle. The check is part of syncing this
    Channel, so it carries the sync's kind, Account and Channel.
    """
    group = client.post(
        f"{API}/data/setting-groups",
        json={"name": "RQS auto follow", "autoFollowForwarded": True},
        headers=superuser_token_headers,
    )
    assert group.status_code == 200, group.text
    _follow(client, superuser_token_headers, CHANNEL)
    r = client.patch(
        f"{API}/data/channels/bulk-setting-group",
        json={"channelIds": [CHANNEL], "settingGroupId": group.json()["id"]},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    forward = (
        '<a class="tgme_widget_message_forwarded_from_name" '
        f'href="https://t.me/{FOLLOWED}/9">Followed</a>'
    )
    telegram.script(
        _first_page(),
        _page_html(CHANNEL, [100]).replace(
            '<div class="tgme_widget_message_text">',
            forward + '<div class="tgme_widget_message_text">',
        ),
    )
    telegram.script(_first_page(FOLLOWED), _page_html(FOLLOWED, [3]))

    _sync(client, superuser_token_headers)

    assert _first_page(FOLLOWED) in telegram.calls
    checks = _recorded(page_type="metadata")
    assert [(r.kind, r.channel, r.budget) for r in checks] == [
        ("single", CHANNEL, "manual_single")
    ]


BOT_TOKEN = "4242:RQSBOT"


def test_bot_api_calls_are_their_own_uncharged_kind(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutations: leave publishing, bot info or a bot file unattributed.

    Publishing a Summary, asking about a bot and fetching a bot's file all
    reach Telegram through the Bot API. None of them is charged to a Budget.
    """
    r = client.put(
        f"{API}/data/bot-credentials/rqs-bot",
        json={"name": "RQS Bot", "token": BOT_TOKEN},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    bot = f"https://api.telegram.org/bot{BOT_TOKEN}"
    telegram.script(f"{bot}/sendMessage", '{"ok": true, "result": {"message_id": 1}}')
    telegram.script(f"{bot}/getMe", '{"ok": true, "result": {"id": 1}}')
    telegram.script(
        f"https://api.telegram.org/file/bot{BOT_TOKEN}/photos/a.jpg",
        (b"\xff\xd8\xff", "image/jpeg"),
    )

    answers = [
        client.post(
            f"{API}/telegram/publish",
            json={"credentialId": "rqs-bot", "chatId": "-100123", "text": "hello"},
            headers=superuser_token_headers,
        ),
        client.post(
            f"{API}/telegram/bot-info",
            json={"credentialId": "rqs-bot", "method": "getMe"},
            headers=superuser_token_headers,
        ),
        client.get(
            f"{API}/telegram/bot-file/rqs-bot",
            params={"path": "photos/a.jpg"},
            headers=superuser_token_headers,
        ),
    ]

    assert [a.status_code for a in answers] == [200, 200, 200]
    assert len(_recorded(kind="botApi")) == 3
    calls = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="botApi")
    assert (calls["requests"], calls["charged"]) == (3, 0)


def test_a_request_nobody_declared_is_other(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    expects_other: None,
) -> None:
    """Mutation: default the attribution to a declared kind.

    Nothing disappears silently: a fetch no work declared itself around is
    still a Request, and its kind says nobody owned it.
    """
    telegram.script(_first_page(HANDLE), _page_html(HANDLE, [1]))

    client.portal.call(lambda: network.fetch_with_retry(_first_page(HANDLE), retries=1))

    other = _row(_breakdown(client, superuser_token_headers)["byKind"], kind="other")
    assert (other["requests"], other["charged"]) == (1, 0)


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


def test_the_api_writes_its_buffered_requests_when_it_shuts_down(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: drop `stop_request_flusher` from the API's lifespan.

    A handle check is the API process's own Request, so the API holds a
    buffer like the worker's, and a deploy must not lose what it holds. The
    lifespan runs here on a loop of its own, its other startup work stubbed
    out, so the module's client and its flusher are untouched.
    """
    for name in (
        "run_startup_checks",
        "init_db",
        "start_progress_subscriber",
        "start_job_status_subscriber",
        "stop_progress_subscriber",
        "stop_job_status_subscriber",
    ):
        monkeypatch.setattr(api_main, name, lambda *_args: None)
    monkeypatch.setattr(request_stats_jobs, "_flusher", None)

    async def serve_one_check() -> None:
        async with api_main.lifespan(api_main.app):
            with attributed(kind=RequestKind.HANDLE, channel=HANDLE):
                page_for_fetch(media=False).record(
                    at=datetime.now(UTC),
                    latency_ms=1,
                    lane="direct",
                    web_view=True,
                    cause=None,
                    error_code=None,
                    answered=True,
                )

    asyncio.run(serve_one_check())

    with Session(engine) as session:
        written = session.exec(select(RequestRecordRow)).all()
    assert [(r.kind, r.channel) for r in written] == [("handle", HANDLE)]


def test_a_flush_returns_once_every_request_before_it_is_written(
    monkeypatch: pytest.MonkeyPatch, expects_other: None
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
# Keeping (RQS-02)
# --------------------------------------------------------------------------


def _requests_by_tier(
    client: TestClient, headers: dict[str, str], now: datetime
) -> tuple[int, int, int]:
    """Today, this hour and a few minutes around `now`: daily, hourly, per-Request."""
    hour = now.replace(minute=0, second=0, microsecond=0)

    def requests(**span: str) -> int:
        rows = _breakdown(client, headers, **span)["byKind"]
        return sum(int(row["requests"]) for row in rows)

    return (
        requests(),
        requests(start=hour.isoformat(), end=(hour + timedelta(hours=1)).isoformat()),
        requests(
            start=(now - timedelta(minutes=1)).isoformat(),
            end=(now + timedelta(minutes=2)).isoformat(),
        ),
    )


def test_retention_keeps_requests_a_week_hourly_totals_a_month_and_days_forever(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutations: prune Requests or hourly totals one batch per run, or by the
    other tier's span, or prune the daily totals too.

    Two syncs make two Requests and two hourly rows (one Useful, one Idle), and
    the batch is cut to one row, so a prune that stops after one batch leaves
    a row behind. The clock moves forward to either side of each span on the
    default settings, 7 and 30 days.
    """
    monkeypatch.setattr(request_stats, "REQUEST_DELETE_BATCH", 1)
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101]))
    _sync(client, superuser_token_headers)
    _sync(client, superuser_token_headers)

    now = datetime.now(UTC)
    if now.minute in (0, 59) or now.hour in (0, 23):
        pytest.skip("too close to an hour or day edge to cut a range around now")
    n = len(_recorded())
    assert n >= 2
    assert _requests_by_tier(client, superuser_token_headers, now) == (n, n, n)

    real_now = utc_now()
    expected = {6: (n, n, n), 8: (n, n, 0), 29: (n, n, 0), 31: (n, 0, 0)}
    for days, left in expected.items():
        monkeypatch.setattr(
            retention, "utc_now", lambda days=days: real_now + timedelta(days=days)
        )
        with Session(engine) as session:
            run_retention_cleanup(session)
        assert _requests_by_tier(client, superuser_token_headers, now) == left, days


def test_startup_refuses_an_hourly_span_shorter_than_the_record_span() -> None:
    """Mutation: drop the check, or refuse equal spans as well."""
    with pytest.raises(ValueError) as refused:
        Settings(PROJECT_NAME="test", REQUEST_RECORD_DAYS=10, REQUEST_HOURLY_DAYS=9)  # type: ignore[call-arg]
    assert "REQUEST_RECORD_DAYS" in str(refused.value)
    assert "REQUEST_HOURLY_DAYS" in str(refused.value)

    Settings(PROJECT_NAME="test", REQUEST_RECORD_DAYS=10, REQUEST_HOURLY_DAYS=10)  # type: ignore[call-arg]


# --------------------------------------------------------------------------
# The ledger (RQS-15)
# --------------------------------------------------------------------------


class _Warnings(logging.Handler):
    """The warnings the ledger check logs, caught by a handler of our own."""

    def __init__(self) -> None:
        super().__init__(logging.WARNING)
        self.records: list[logging.LogRecord] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.records.append(record)


@pytest.fixture
def ledger_warnings(monkeypatch: pytest.MonkeyPatch) -> Iterator[_Warnings]:
    """Run the daily check as if today were tomorrow, so it checks today."""
    tomorrow = datetime.now(UTC).date() + timedelta(days=1)
    monkeypatch.setattr(request_stats_jobs, "today_utc", lambda: tomorrow)
    handler = _Warnings()
    log = logging.getLogger(request_stats.__name__)
    log.addHandler(handler)
    yield handler
    log.removeHandler(handler)


def _ledger_total() -> int:
    with Session(engine) as session:
        return sum(row.requests for row in usage_rows(session))


def _charged_total(client: TestClient, headers: dict[str, str]) -> int:
    rows = _breakdown(client, headers, charged="charged")["byKind"]
    return sum(int(row["requests"]) for row in rows)


def _settled(client: TestClient, headers: dict[str, str]) -> int:
    """The day's charged Requests, once the ledger has caught up with them.

    A sync reads finished before its `finally` charges the ledger, so the two
    are compared only once their totals agree, or after five seconds.
    """
    deadline = time.time() + 5
    while (charged := _charged_total(client, headers)) != _ledger_total():
        if time.time() > deadline:
            break
        time.sleep(0.05)
    return charged


def _ownerless_sync(client: TestClient, headers: dict[str, str], channel: str) -> None:
    """A legacy sync whose message names no owner: the ledger bills the Operator.

    The job row has an owner, as every job row does since ticket 21; the
    message does not, which is the shape a legacy message still has.
    """
    me = client.get(f"{API}/users/me", headers=headers).json()

    async def enqueue() -> str:
        job = await create_job(
            channel_entries=[(channel, channel)],
            source="Test",
            user_id=me["id"],
            sync_mode="individual",
        )
        await enqueue_sync_job(job, None)
        return job.job_id

    job_id = client.portal.call(enqueue)
    deadline = time.time() + 20
    while (job := get_job(job_id)) is None or job.status not in (
        "completed",
        "failed",
        "cancelled",
    ):
        assert time.time() < deadline, f"sync {job_id} never finished"
        time.sleep(0.05)


def test_a_days_charged_requests_equal_the_ledger(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
    ledger_warnings: _Warnings,
) -> None:
    """Mutations: check the recorded Account as it is, so an ownerless sync is
    nobody's; leave out the charged filter; compare per Account only; check
    today instead of yesterday.

    A click, a bulk sync, a bulk follow and a sync with no owner, each with a
    picture the ledger never charges. The Requests API's charged total is the
    ledger's, and the daily check finds every Account and Budget equal.
    """
    avatar = "https://cdn4.telesco.pe/file/rqs-ledger-avatar.jpg"
    telegram.script(
        _first_page(),
        _page_html(CHANNEL, [100, 101]).replace(
            "<body>",
            f'<body><div class="tgme_page_photo_image"><img src="{avatar}"></div>',
        ),
    )
    telegram.script(avatar, (b"\xff\xd8\xff", "image/jpeg"))
    telegram.script(_first_page(FOLLOWED), _page_html(FOLLOWED, [3]))
    _follow(client, superuser_token_headers, CHANNEL)

    _sync(client, superuser_token_headers)
    _sync(client, superuser_token_headers, mode="bulk")
    _bulk_follow(client, superuser_token_headers, monkeypatch, FOLLOWED)
    _ownerless_sync(client, superuser_token_headers, CHANNEL)

    assert [r.account_id for r in _recorded(kind="single", page_type="posts")][
        -1
    ] is None
    assert _recorded(charged=False), "no uncharged Request to leave out"
    charged = _settled(client, superuser_token_headers)
    assert charged == _ledger_total()
    with Session(engine) as session:
        budgets = {row.budget for row in usage_rows(session)}
    assert budgets == {"manual_single", "manual_bulk"}

    asyncio.run(request_stats_jobs.run_request_ledger_check())
    assert ledger_warnings.records == []


def test_the_ledger_check_reports_a_mismatch(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    ledger_warnings: _Warnings,
) -> None:
    """Mutations: never log; log without the metric; check today instead of
    yesterday.

    One sync, settled, then one Request charged that nothing recorded: the
    check names the Account and Budget, and the metric counts the difference.
    """
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))
    _follow(client, superuser_token_headers, CHANNEL)
    _sync(client, superuser_token_headers)
    charged = _settled(client, superuser_token_headers)
    assert charged > 0
    me = client.get(f"{API}/users/me", headers=superuser_token_headers).json()
    with Session(engine) as session:
        charge_requests(session, uuid.UUID(me["id"]), Budget.MANUAL_SINGLE, 2)

    asyncio.run(request_stats_jobs.run_request_ledger_check())

    [warning] = ledger_warnings.records
    message = warning.getMessage()
    assert me["id"] in message
    assert "manual_single" in message
    assert f"recorded {charged}, ledger {charged + 2}" in message
    assert (getattr(warning, "metric", None), getattr(warning, "value", None)) == (
        "request_ledger_mismatch",
        2,
    )


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


@pytest.mark.parametrize("route", ["breakdown", "trend"])
def test_the_requests_endpoints_are_the_operators_alone(
    client: TestClient, normal_user_token_headers: dict[str, str], route: str
) -> None:
    """Mutation: drop the `QUOTA_READ_ANY` dependency from either route."""
    start, end = _today()
    r = client.get(
        f"{API}/requests/{route}",
        params={"start": start, "end": end},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 403


# --------------------------------------------------------------------------
# The trend (RQS-06)
# --------------------------------------------------------------------------


def _trend(
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
        f"{API}/requests/trend",
        params={
            "start": start or day_start,
            "end": end or day_end,
            "charged": charged,
        },
        headers=headers,
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def _span(bucket: dict[str, Any]) -> timedelta:
    start = datetime.fromisoformat(bucket["start"])
    return datetime.fromisoformat(bucket["end"]) - start


def _by_kind(buckets: list[dict[str, Any]]) -> dict[str, tuple[int, int, int]]:
    """Each kind's Useful, Idle and Wasted, summed over the buckets."""
    sums: dict[str, tuple[int, int, int]] = {}
    for b in buckets:
        u, i, w = sums.get(b["kind"], (0, 0, 0))
        sums[b["kind"]] = (u + b["useful"], i + b["idle"], w + b["wasted"])
    return sums


def _breakdown_by_kind(answer: dict[str, Any]) -> dict[str, tuple[int, int, int]]:
    return {r["kind"]: (r["useful"], r["idle"], r["wasted"]) for r in answer["byKind"]}


def _refused_then_answered(
    client: TestClient,
    headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A sync whose first attempt is refused and whose retry answers: one
    Wasted, Uncharged Request, one Useful, Charged one, and the Idle older
    page the walk asks for next."""
    monkeypatch.setattr(settings, "NETWORK_FETCH_RETRIES", 3)
    _follow(client, headers, CHANNEL)
    telegram.script(
        _first_page(), httpx.ConnectError("refused"), _page_html(CHANNEL, [100, 101])
    )
    _sync(client, headers)


def test_the_last_weeks_trend_is_five_minute_buckets_of_the_requests(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutations: bucket the Requests by hour, or count a Wasted one as Idle."""
    _refused_then_answered(client, superuser_token_headers, telegram, monkeypatch)

    buckets = _trend(client, superuser_token_headers)["buckets"]
    assert buckets
    for b in buckets:
        assert _span(b) == timedelta(minutes=5), b
        assert datetime.fromisoformat(b["start"]).minute % 5 == 0, b
    useful, _idle, wasted = _by_kind(buckets)["single"]
    assert (useful, wasted) == (1, 1)
    assert _by_kind(buckets) == _breakdown_by_kind(
        _breakdown(client, superuser_token_headers)
    )


def test_the_trend_keeps_charged_or_uncharged_requests(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutation: ignore `charged` on the trend, or mark every bucket Charged."""
    _refused_then_answered(client, superuser_token_headers, telegram, monkeypatch)

    charged = _trend(client, superuser_token_headers, charged="charged")["buckets"]
    uncharged = _trend(client, superuser_token_headers, charged="uncharged")["buckets"]
    assert {b["charged"] for b in charged} == {True}
    assert {b["charged"] for b in uncharged} == {False}
    assert _by_kind(charged)["single"][::2] == (1, 0)
    assert _by_kind(uncharged)["single"] == (0, 0, 1)


def test_a_trend_cut_to_the_minute_clips_its_end_buckets(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: widen a cut range to its whole 5-minute buckets."""
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100]))
    _sync(client, superuser_token_headers)

    now = utc_now().replace(second=0, microsecond=0)
    start, end = now - timedelta(minutes=1), now + timedelta(minutes=1)
    answer = _trend(
        client, superuser_token_headers, start=start.isoformat(), end=end.isoformat()
    )
    assert _by_kind(answer["buckets"])["single"][0] == 1
    for b in answer["buckets"]:
        assert datetime.fromisoformat(b["start"]) >= start, b
        assert datetime.fromisoformat(b["end"]) <= end, b


def test_past_each_tiers_span_the_next_one_answers(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Mutations: drop the fall back to a coarser tier from the Breakdown, or
    keep 5-minute or hourly buckets on the trend past their tier's span.

    The clock moves past each span on the default settings, 7 and 30 days,
    and retention runs. The same ranges, cut to the hour and to the minute,
    still find every Request: in the hourly totals once the Requests are gone,
    and in the daily totals once those are. The trend's buckets coarsen too.
    """
    _follow(client, superuser_token_headers, CHANNEL)
    telegram.script(_first_page(), _page_html(CHANNEL, [100, 101]))
    _sync(client, superuser_token_headers)
    _sync(client, superuser_token_headers)

    now = datetime.now(UTC)
    if now.minute in (0, 59) or now.hour in (0, 23):
        pytest.skip("too close to an hour or day edge to cut a range around now")
    n = len(_recorded())
    # The rollup runs every 5 minutes, long before retention reaches a Request.
    roll_up_request_totals()
    real_now = utc_now()
    for days, grain in {8: timedelta(hours=1), 31: timedelta(days=1)}.items():
        moved = real_now + timedelta(days=days)
        monkeypatch.setattr(retention, "utc_now", lambda moved=moved: moved)
        monkeypatch.setattr(request_stats, "utc_now", lambda moved=moved: moved)
        with Session(engine) as session:
            run_retention_cleanup(session)
        assert _requests_by_tier(client, superuser_token_headers, now) == (n, n, n)
        buckets = _trend(client, superuser_token_headers)["buckets"]
        assert {_span(b) for b in buckets} == {grain}, days
        assert sum(b["useful"] + b["idle"] + b["wasted"] for b in buckets) == n
