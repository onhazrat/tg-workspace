"""An Operator disables a Request kind, and nothing of it leaves (RKD-01, ADR-040).

Seam 1 of `.scratch/request-kinds/spec.md`: Telegram is faked at
`network._fetch_once`, the seam the quota ledger and request-recording tests
use, and everything above it is real. A switch is flipped through
`PUT /settings/{settingId}`, work is started through the routes, the scheduler
tick, the probe sweep or a hand-drained lane, and the answer is read from the
API and the lanes.

The mutation that turns each test red is named on it.
"""

from __future__ import annotations

import asyncio
import json
import time
import types
import uuid
from collections.abc import Callable, Iterator
from datetime import UTC, datetime
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app import crud
from app.core import request_meter
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import ROLE_ADMIN
from app.core.request_recording import (
    RequestKind,
    RequestKindDisabled,
    attributed,
)
from app.jobs import auto_summary, discover_probe, sync_queue
from app.jobs.auto_sync import run_auto_sync
from app.jobs.discover_probe import run_discover_probe_sweep
from app.jobs.scheduler import DISCOVER_PROBE_JOB_ID, trigger_job
from app.models_rbac import UserRole
from app.models_tg import (
    BotCredential,
    Channel,
    ChatDestination,
    DirectoryEntry,
    Post,
    PublishLog,
    RequestRecordRow,
    Summary,
    SyncJob,
)
from app.services import network, pgmq, publish
from app.services.bulk_follow import run_follow_job_by_id
from app.services.channel_directory import enqueue_handles
from app.services.request_stats import flush_recorded_requests
from app.services.scraper_jobs import clear_jobs_for_tests, create_job
from app.services.sync_lanes import (
    AUTO_SYNC_NORMAL_LANE,
    DISCOVER_PROBE_LANE,
    DRAIN_ORDER,
    MANUAL_SINGLE_NORMAL_LANE,
)
from app.services.sync_orchestrator import run_sync_job
from tests.utils.user import authentication_token_from_email

API = settings.API_V1_STR
CHANNEL = "rkdchannel"
PAGE_URL = f"https://t.me/s/{CHANNEL}"

#: Every kind but `other`, read off the enum so a new kind joins every test.
SWITCHABLE = [kind for kind in RequestKind if kind is not RequestKind.OTHER]


def _setting(kind: RequestKind) -> str:
    return f"{API}/settings/jobs.deployment.{kind.value}RequestsEnabled"


def _switch(
    client: TestClient, headers: dict[str, str], kind: RequestKind, *, on: bool
) -> httpx.Response:
    return client.put(_setting(kind), json={"value": on}, headers=headers)


def _disable(client: TestClient, headers: dict[str, str], kind: RequestKind) -> None:
    r = _switch(client, headers, kind, on=False)
    assert r.status_code == 200, r.text


def _enable(client: TestClient, headers: dict[str, str], kind: RequestKind) -> None:
    r = _switch(client, headers, kind, on=True)
    assert r.status_code == 200, r.text


def _page(channel: str, post_ids: list[int]) -> str:
    """A web view page naming the Channel and holding these Posts."""
    header = (
        '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title">'
        f"<span>{channel}</span></div>"
        '<div class="tgme_channel_info_counter"><span class="counter_value">100'
        '</span><span class="counter_type">subscribers</span></div></div>'
    )
    messages = "".join(
        f'<div class="tgme_widget_message" data-post="{channel}/{pid}">'
        f'<div class="tgme_widget_message_text">post {pid}</div>'
        f'<time datetime="{datetime.now(UTC).isoformat()}"></time>'
        f'<a class="tgme_widget_message_date" href="https://t.me/{channel}/{pid}"></a>'
        "</div>"
        for pid in sorted(post_ids)
    )
    return f"<html><body>{header}{messages}</body></html>"


class FakeTelegram:
    """`_fetch_once`, answering from a script, and recording every call.

    A URL nobody scripted answers a Channel page with no Posts. `on_call` runs
    once, the first time its URL is fetched, before the answer: a switch
    flipped there is flipped while that work is in flight.
    """

    def __init__(self) -> None:
        self.calls: list[str] = []
        self.pages: dict[str, str] = {}
        self.on_call: dict[str, Callable[[], None]] = {}

    async def __call__(self, url: str, **_kwargs: Any) -> Any:
        self.calls.append(url)
        hook = self.on_call.pop(url, None)
        if hook is not None:
            await asyncio.to_thread(hook)
        return self.pages.get(url) or _page(url.rstrip("/").split("/")[-1], [])


async def _no_sleep(_seconds: float) -> None:
    await _real_sleep(0)


_real_sleep = asyncio.sleep


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> FakeTelegram:
    fake = FakeTelegram()
    monkeypatch.setattr(network, "_fetch_once", fake)
    monkeypatch.setattr(
        network,
        "asyncio",
        types.SimpleNamespace(**{**vars(asyncio), "sleep": _no_sleep}),
    )
    monkeypatch.setattr(settings, "SYNC_RETRY_BACKOFF_BASE_MS", 0)
    return fake


def _empty_lanes() -> None:
    with Session(engine) as session:
        for lane in DRAIN_ORDER:
            while msgs := pgmq.read(session, lane, vt_seconds=0, qty=100):
                for msg in msgs:
                    pgmq.delete(session, lane, msg.msg_id)
                session.commit()


@pytest.fixture(autouse=True)
def _switches_back_on(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> Iterator[None]:
    clear_jobs_for_tests()
    flush_recorded_requests()
    _empty_lanes()
    yield
    clear_jobs_for_tests()
    _empty_lanes()
    for kind in SWITCHABLE:
        client.put(
            _setting(kind), json={"reset": True}, headers=superuser_token_headers
        )
    for lane in DRAIN_ORDER:
        client.post(f"{API}/jobs/lanes/{lane}/resume", headers=superuser_token_headers)


def _records() -> int:
    flush_recorded_requests()
    with Session(engine) as session:
        return len(session.exec(select(RequestRecordRow)).all())


def _fetch_as(kind: RequestKind | None) -> tuple[int, BaseException | None]:
    """One fetch under `kind`'s attribution: what it charged, and what it raised."""

    async def _run() -> tuple[int, BaseException | None]:
        with request_meter.metered() as meter:
            try:
                if kind is None:
                    await network.fetch_with_retry(PAGE_URL, retries=1)
                else:
                    with attributed(kind=kind):
                        await network.fetch_with_retry(PAGE_URL, retries=1)
            except RequestKindDisabled as exc:
                return meter.telegram_requests, exc
            return meter.telegram_requests, None

    return asyncio.run(_run())


# --------------------------------------------------------------------------
# The chokepoint, and the guard
# --------------------------------------------------------------------------


@pytest.mark.parametrize("kind", SWITCHABLE, ids=lambda k: k.value)
def test_every_kind_but_other_is_switchable_and_refused_where_requests_leave(
    kind: RequestKind,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """The guard: a kind with no switch, or one the chokepoint lets out, fails.

    Mutations: drop a kind's declaration (its PUT answers 404); drop the
    `_refuse_disabled_kind` call from `fetch_with_retry`.
    """
    before = _records()
    _disable(client, superuser_token_headers, kind)

    charged, refused = _fetch_as(kind)

    assert isinstance(refused, RequestKindDisabled), refused
    assert refused.kind is kind
    assert telegram.calls == []
    assert charged == 0
    assert _records() == before

    _enable(client, superuser_token_headers, kind)
    _charged, refused = _fetch_as(kind)
    assert refused is None
    assert telegram.calls == [PAGE_URL]


def test_work_nobody_attributed_is_never_refused(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: refuse `other` in `_refuse_disabled_kind`."""
    for kind in SWITCHABLE:
        _disable(client, superuser_token_headers, kind)

    _charged, refused = _fetch_as(None)

    assert refused is None
    assert telegram.calls == [PAGE_URL]


def test_a_refusal_reads_the_one_message_naming_the_kind(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: build the message from the kind's value rather than its label."""
    _disable(client, superuser_token_headers, RequestKind.BOT_API)

    _charged, refused = _fetch_as(RequestKind.BOT_API)

    assert str(refused) == "Bot API is disabled on this deployment"


# --------------------------------------------------------------------------
# Policy: who may switch, the defaults, a change at runtime
# --------------------------------------------------------------------------


def test_an_account_without_jobs_manage_cannot_see_or_change_a_switch(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: declare the switches `visible="everyone"`."""
    r = _switch(client, normal_user_token_headers, RequestKind.PROBE, on=False)
    assert r.status_code == 404, r.text

    registry = client.get(
        f"{API}/settings/registry", headers=normal_user_token_headers
    ).json()
    assert not [row for row in registry["rows"] if "RequestsEnabled" in row["id"]]

    _charged, refused = _fetch_as(RequestKind.PROBE)
    assert refused is None


def test_an_admin_holding_jobs_manage_but_not_settings_manage_may_switch(
    client: TestClient, db: Session
) -> None:
    """Mutation: gate the switches on `settings:manage`, the default."""
    email = f"rkd-admin-{uuid.uuid4().hex[:8]}@example.com"
    headers = authentication_token_from_email(client=client, email=email, db=db)
    user = crud.get_user_by_email(session=db, email=email)
    assert user is not None
    db.add(UserRole(user_id=user.id, role_id=ROLE_ADMIN))
    db.commit()

    r = _switch(client, headers, RequestKind.HANDLE, on=False)
    assert r.status_code == 200, r.text
    assert r.json()["value"] is False


def test_the_env_default_applies_to_an_empty_store(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: default every switch to on, ignoring `.env`."""
    monkeypatch.setattr(settings, "JOBS_PROBE_REQUESTS_ENABLED_DEFAULT", False)

    _charged, refused = _fetch_as(RequestKind.PROBE)
    assert isinstance(refused, RequestKindDisabled)

    registry = client.get(
        f"{API}/settings/registry", headers=superuser_token_headers
    ).json()
    probe = next(
        r for r in registry["rows"] if r["id"] == "jobs.deployment.probeRequestsEnabled"
    )
    assert probe["value"] is False
    assert probe["defaultSource"] == "env"


def test_a_switch_takes_effect_without_a_restart(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: read the switches once and never again (drop `forget`)."""
    _charged, refused = _fetch_as(RequestKind.SINGLE)
    assert refused is None

    _disable(client, superuser_token_headers, RequestKind.SINGLE)
    _charged, refused = _fetch_as(RequestKind.SINGLE)
    assert isinstance(refused, RequestKindDisabled)


def test_the_runtime_config_carries_each_switch_and_since_when(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Mutation: never stamp `disabledAt`; or drop `requestKinds` from the payload."""
    before = int(time.time() * 1000)
    _disable(client, superuser_token_headers, RequestKind.PROBE)

    config = client.get(
        f"{API}/jobs/runtime-config", headers=superuser_token_headers
    ).json()
    by_kind = {s["kind"]: s for s in config["requestKinds"]}

    assert set(by_kind) == {k.value for k in SWITCHABLE}
    assert by_kind["probe"]["enabled"] is False
    assert by_kind["probe"]["disabledSince"] >= before
    assert (
        by_kind["probe"]["refusal"] == "Directory probe is disabled on this deployment"
    )
    assert by_kind["auto"] == {
        "kind": "auto",
        "label": "Auto sync",
        "enabled": True,
        "disabledSince": None,
        "refusal": "Auto sync is disabled on this deployment",
    }

    _enable(client, superuser_token_headers, RequestKind.PROBE)
    config = client.get(
        f"{API}/jobs/runtime-config", headers=superuser_token_headers
    ).json()
    probe = next(s for s in config["requestKinds"] if s["kind"] == "probe")
    assert probe["enabled"] is True
    assert probe["disabledSince"] is None


# --------------------------------------------------------------------------
# Entry points: each refuses with the one message, before it starts anything
# --------------------------------------------------------------------------

REFUSED = 409


def _follow(client: TestClient, headers: dict[str, str], channel: str) -> None:
    r = client.put(
        f"{API}/data/channels/{channel}",
        json={"name": channel, "displayName": channel},
        headers=headers,
    )
    assert r.status_code == 200, r.text


def _start_sync(
    client: TestClient, headers: dict[str, str], mode: str = "individual"
) -> httpx.Response:
    return client.post(
        f"{API}/jobs/sync",
        json={"channelIds": [CHANNEL], "source": "Test", "syncMode": mode},
        headers=headers,
    )


def _sync_jobs() -> int:
    with Session(engine) as session:
        return len(session.exec(select(SyncJob)).all())


def _queued(lane: str) -> int:
    with Session(engine) as session:
        return pgmq.queue_length(session, lane)


def _assert_refused(r: httpx.Response, label: str) -> None:
    assert r.status_code == REFUSED, r.text
    assert r.json()["detail"] == f"{label} is disabled on this deployment"


@pytest.mark.parametrize(
    ("mode", "kind", "label"),
    [
        ("individual", RequestKind.SINGLE, "Manual single"),
        ("sync_all", RequestKind.BULK, "Manual bulk"),
        ("bulk", RequestKind.BULK, "Manual bulk"),
    ],
)
def test_starting_a_sync_of_a_disabled_kind_is_refused_and_files_no_job(
    mode: str,
    kind: RequestKind,
    label: str,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop the `assert_kind_enabled` call from `POST /jobs/sync`."""
    _follow(client, superuser_token_headers, CHANNEL)
    _disable(client, superuser_token_headers, kind)

    _assert_refused(_start_sync(client, superuser_token_headers, mode), label)
    assert _sync_jobs() == 0


def test_reset_and_sync_is_refused_before_it_clears_anything(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: check the kind after the reset instead of before it."""
    _follow(client, superuser_token_headers, CHANNEL)
    _disable(client, superuser_token_headers, RequestKind.BULK)
    with Session(engine) as session:
        session.add(Post(channel_name=CHANNEL, post_id=1, text="kept"))
        session.commit()

    r = client.post(
        f"{API}/data/channels/bulk-reset-sync",
        json={"confirm": True},
        headers=superuser_token_headers,
    )

    _assert_refused(r, "Manual bulk")
    with Session(engine) as session:
        kept = session.exec(select(Post).where(Post.channel_name == CHANNEL)).all()
    assert [post.text for post in kept] == ["kept"]
    assert _sync_jobs() == 0


def test_a_bulk_follow_is_refused_before_its_first_handle_check(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop the `follow` dependency from the bulk-follow route."""
    _disable(client, superuser_token_headers, RequestKind.FOLLOW)

    r = client.post(
        f"{API}/data/channels/bulk-follow",
        json={"channels": [{"name": CHANNEL}]},
        headers=superuser_token_headers,
    )

    _assert_refused(r, "Follow")
    assert telegram.calls == []


@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/telegram/scrape", {"url": CHANNEL}),
        ("/telegram/channel-info", {"channelName": CHANNEL}),
        (
            "/telegram/resolve-start-time",
            {"channelName": CHANNEL, "targetTimeMs": 1_767_225_600_000},
        ),
    ],
)
def test_the_handle_check_routes_refuse_while_handle_checks_are_off(
    path: str,
    body: dict[str, Any],
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop `HANDLE_CHECK` from one of the three routes."""
    _disable(client, superuser_token_headers, RequestKind.HANDLE)

    r = client.post(f"{API}{path}", json=body, headers=superuser_token_headers)

    _assert_refused(r, "Handle check")
    assert telegram.calls == []


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        (
            "post",
            "/telegram/publish",
            {"credentialId": "b", "chatId": "c", "text": "t"},
        ),
        ("post", "/telegram/bot-info", {"credentialId": "b", "method": "getMe"}),
        ("get", "/telegram/bot-file/b?path=photos/x.jpg", None),
        (
            "post",
            "/data/summaries/s/publication",
            {"botId": "b", "destinationId": "d"},
        ),
    ],
)
def test_the_bot_api_routes_refuse_while_the_bot_api_is_off(
    method: str,
    path: str,
    body: dict[str, Any] | None,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop `BOT_API` from one of the routes."""
    _disable(client, superuser_token_headers, RequestKind.BOT_API)

    r = client.request(
        method, f"{API}{path}", json=body, headers=superuser_token_headers
    )

    _assert_refused(r, "Bot API")
    assert telegram.calls == []


def test_the_auto_sync_tick_files_no_job_while_auto_sync_is_off(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop the kind check from `run_auto_sync`."""
    _follow(client, superuser_token_headers, CHANNEL)
    # A new follow's deadline is an interval away, so make it due by schedule
    # rather than lean on the partial-history pass, which CI did not take.
    with Session(engine) as session:
        channel = session.get(Channel, CHANNEL)
        assert channel is not None
        channel.next_regular_sync_at = int(time.time() * 1000) - 1_000
        session.add(channel)
        session.commit()
    _disable(client, superuser_token_headers, RequestKind.AUTO)

    result = client.portal.call(run_auto_sync)

    assert result["skipped"] is True
    assert _sync_jobs() == 0
    assert _queued(AUTO_SYNC_NORMAL_LANE) == 0

    # The same tick with the kind on does file one, so the check is the reason.
    _enable(client, superuser_token_headers, RequestKind.AUTO)
    assert client.portal.call(run_auto_sync).get("skipped") is not True
    assert _sync_jobs() == 1


def _queue_handle(handle: str) -> None:
    with Session(engine) as session:
        enqueue_handles(session, [handle])


@pytest.mark.parametrize("triggered", [False, True], ids=["scheduled", "triggered"])
def test_the_probe_sweep_enqueues_nothing_while_probes_are_off(
    triggered: bool,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop the kind check from `run_discover_probe_sweep`."""
    _queue_handle("rkdprobed")
    _disable(client, superuser_token_headers, RequestKind.PROBE)

    if triggered:
        # What the worker runs when `POST /jobs/discover_probe/trigger` rings.
        client.portal.call(trigger_job, DISCOVER_PROBE_JOB_ID)
    else:
        client.portal.call(run_discover_probe_sweep)

    assert _queued(DISCOVER_PROBE_LANE) == 0

    _enable(client, superuser_token_headers, RequestKind.PROBE)
    client.portal.call(run_discover_probe_sweep)
    assert _queued(DISCOVER_PROBE_LANE) == 1


# --------------------------------------------------------------------------
# Holding queued work
# --------------------------------------------------------------------------


def _drain(client: TestClient) -> None:
    client.portal.call(sync_queue.drain_sync_lanes)


def _job(client: TestClient, headers: dict[str, str], job_id: str) -> dict[str, Any]:
    r = client.get(f"{API}/jobs/sync/{job_id}", headers=headers)
    assert r.status_code == 200, r.text
    return dict(r.json())


def _read_count(lane: str) -> int:
    with Session(engine) as session:
        return sum(m.read_ct for m in pgmq.queued_messages(session, lane))


def _queue_a_single_sync(client: TestClient, headers: dict[str, str]) -> str:
    """A sync on its lane, with no worker to take it until a test drains."""
    _follow(client, headers, CHANNEL)
    r = _start_sync(client, headers)
    assert r.status_code == 200, r.text
    assert _queued(MANUAL_SINGLE_NORMAL_LANE) == 1
    return str(r.json()["jobId"])


def test_work_queued_before_a_disable_waits_and_runs_once_enabled(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop `held_lanes` from the consumer's held set.

    The chokepoint alone would still send nothing, but the message would be
    read, refused and sent back on every drain instead of waiting.
    """
    job_id = _queue_a_single_sync(client, superuser_token_headers)
    _disable(client, superuser_token_headers, RequestKind.SINGLE)
    read_before = _read_count(MANUAL_SINGLE_NORMAL_LANE)

    _drain(client)

    assert telegram.calls == []
    assert _queued(MANUAL_SINGLE_NORMAL_LANE) == 1
    assert _read_count(MANUAL_SINGLE_NORMAL_LANE) == read_before
    assert _job(client, superuser_token_headers, job_id)["status"] == "pending"

    _enable(client, superuser_token_headers, RequestKind.SINGLE)
    _drain(client)

    assert _job(client, superuser_token_headers, job_id)["status"] == "completed"
    assert _queued(MANUAL_SINGLE_NORMAL_LANE) == 0


def test_a_paused_lane_and_a_disabled_kind_hold_independently(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: make resuming a lane, or enabling a kind, release both holds."""
    h = superuser_token_headers
    job_id = _queue_a_single_sync(client, h)
    lane = MANUAL_SINGLE_NORMAL_LANE

    client.post(f"{API}/jobs/lanes/{lane}/pause", headers=h)
    _disable(client, h, RequestKind.SINGLE)
    client.post(f"{API}/jobs/lanes/{lane}/resume", headers=h)
    _drain(client)
    assert telegram.calls == [], "resuming the lane released a disabled kind"

    client.post(f"{API}/jobs/lanes/{lane}/pause", headers=h)
    _enable(client, h, RequestKind.SINGLE)
    _drain(client)
    assert telegram.calls == [], "enabling the kind released a paused lane"

    client.post(f"{API}/jobs/lanes/{lane}/resume", headers=h)
    _drain(client)
    assert _job(client, h, job_id)["status"] == "completed"


def _channel() -> Channel:
    with Session(engine) as session:
        channel = session.exec(select(Channel).where(Channel.name == CHANNEL)).one()
        session.expunge(channel)
        return channel


def test_a_sync_refused_mid_walk_goes_back_on_its_lane_unfailed(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutations: treat the refusal as a scrape error (drop the re-raise in
    `_scrape_page_with_retry`, or the hold in `_sync_claimed_channel`); archive
    the message instead of `_requeue`; or let `sync_run` count it as failed.
    """
    h = superuser_token_headers
    job_id = _queue_a_single_sync(client, h)
    before = _channel()
    # The first page answers, and the switch goes off while it is in flight:
    # the next page of the same walk is the one refused.
    telegram.pages[PAGE_URL] = _page(CHANNEL, [100, 101])
    telegram.on_call[PAGE_URL] = lambda: _disable(client, h, RequestKind.SINGLE)

    _drain(client)

    assert telegram.calls == [PAGE_URL]
    assert _queued(MANUAL_SINGLE_NORMAL_LANE) == 1
    job = _job(client, h, job_id)
    assert job["status"] not in ("completed", "failed", "cancelled")
    assert job["channels"][0]["status"] == "pending"
    after = _channel()
    assert after.sync_claimed_by is None
    assert after.next_regular_sync_at == before.next_regular_sync_at
    assert after.next_dynamic_sync_at == before.next_dynamic_sync_at
    assert after.last_updated == before.last_updated
    with Session(engine) as session:
        stored = session.exec(select(Post).where(Post.channel_name == CHANNEL)).all()
    assert len(stored) == 2, "the page that answered was kept"
    flush_recorded_requests()
    with Session(engine) as session:
        runs = session.exec(select(RequestRecordRow.sync_failed)).all()
    assert True not in runs, "the held walk was counted as a failed sync"

    _enable(client, h, RequestKind.SINGLE)
    _drain(client)

    job = _job(client, h, job_id)
    assert job["status"] == "completed", job
    assert job["channels"][0]["status"] == "success"


def test_a_probe_refused_mid_way_goes_back_on_the_probe_lane(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: let `probe_one_handle` swallow the refusal as a failed probe."""
    h = superuser_token_headers
    _queue_handle("rkdprobed")
    client.portal.call(run_discover_probe_sweep)
    assert _queued(DISCOVER_PROBE_LANE) == 1
    # The switch goes off after the probe is dispatched, just before it fetches.
    real = discover_probe._load_network

    def _then_disable() -> Any:
        _disable(client, h, RequestKind.PROBE)
        return real()

    monkeypatch.setattr(discover_probe, "_load_network", _then_disable)

    _drain(client)

    assert telegram.calls == []
    assert _queued(DISCOVER_PROBE_LANE) == 1
    with Session(engine) as session:
        entry = session.get(DirectoryEntry, "rkdprobed")
        assert entry is not None
        assert entry.status == "unknown"

    monkeypatch.setattr(discover_probe, "_load_network", real)
    _enable(client, h, RequestKind.PROBE)
    _drain(client)
    assert _queued(DISCOVER_PROBE_LANE) == 0
    assert telegram.calls != []


# --------------------------------------------------------------------------
# A held job says why it waits
# --------------------------------------------------------------------------


def _first_event(client: TestClient, headers: dict[str, str], job_id: str) -> Any:
    with client.stream(
        "GET", f"{API}/jobs/sync/{job_id}/events", headers=headers
    ) as stream:
        for line in stream.iter_lines():
            if line.startswith("data: "):
                return json.loads(line.removeprefix("data: "))
    raise AssertionError("the stream sent nothing")


def test_a_held_job_reports_why_it_waits_and_clears_on_enable(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: drop `waitingReason` from `_progress`."""
    h = superuser_token_headers
    job_id = _queue_a_single_sync(client, h)
    _disable(client, h, RequestKind.SINGLE)

    reason = "Manual single is disabled on this deployment"
    assert _job(client, h, job_id)["waitingReason"] == reason
    assert _first_event(client, h, job_id)["waitingReason"] == reason

    _enable(client, h, RequestKind.SINGLE)
    assert _job(client, h, job_id)["waitingReason"] is None
    assert _first_event(client, h, job_id)["waitingReason"] is None
    _drain(client)
    assert _job(client, h, job_id)["status"] == "completed"


# --------------------------------------------------------------------------
# Independence
# --------------------------------------------------------------------------


def test_a_bulk_follow_with_bulk_off_follows_and_skips_the_first_sync(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: let the follow chain its sync whatever `bulk` says."""
    h = superuser_token_headers
    _disable(client, h, RequestKind.BULK)

    r = client.post(
        f"{API}/data/channels/bulk-follow",
        json={"channels": [{"name": CHANNEL}]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    follow_job_id = r.json()["followJobId"]
    client.portal.call(run_follow_job_by_id, follow_job_id)

    follow = client.get(
        f"{API}/data/channels/bulk-follow/{follow_job_id}", headers=h
    ).json()
    assert follow["added"] == 1, follow
    assert follow["syncJobId"] is None
    assert follow["syncSkipped"] == "Manual bulk is disabled on this deployment"
    assert _sync_jobs() == 0


def test_an_auto_publish_with_the_bot_api_off_files_a_failed_log(
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """Mutation: let `send_parts` count the refused Part as sent."""
    h = superuser_token_headers
    me = uuid.UUID(client.get(f"{API}/users/me", headers=h).json()["id"])
    monkeypatch.setattr(publish, "decrypt_token", lambda _token: "token")
    with Session(engine) as session:
        session.add(
            BotCredential(id="rkd-bot", user_id=me, name="bot", token_encrypted="x")
        )
        session.add(
            ChatDestination(id="rkd-dest", user_id=me, name="dest", chat_id="c")
        )
        summary = Summary(
            id=f"summary-{uuid.uuid4()}",
            user_id=me,
            text="body",
            channels=[CHANNEL],
            start_date=1_767_225_600_000,
            end_date=1_767_312_000_000,
            language="en",
            model="test-model",
            post_count=1,
            timestamp=0,
            extra={
                "autoPublish": True,
                "publishBotId": "rkd-bot",
                "publishChatId": "rkd-dest",
            },
        )
        session.add(summary)
        session.commit()
        summary_id = summary.id
    _disable(client, h, RequestKind.BOT_API)

    client.portal.call(
        lambda: auto_summary.after_scheduled_attempt(
            summary_id, outcome="succeeded", kind=None
        )
    )

    assert telegram.calls == []
    with Session(engine) as session:
        assert session.get(Summary, summary_id) is not None
        logs = session.exec(
            select(PublishLog).where(PublishLog.summary_id == summary_id)
        ).all()
        found = [(log.status, log.error) for log in logs]
    assert found == [("failed", "Bot API is disabled on this deployment")]


def test_a_sync_run_outside_the_lanes_skips_a_disabled_kind(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """`auto_summary` syncs through `run_sync_job`, which has no lane to hold on.

    Mutation: drop the `RequestKindDisabled` handler from `run_sync_job`.
    """
    h = superuser_token_headers
    _follow(client, h, CHANNEL)
    me = client.get(f"{API}/users/me", headers=h).json()["id"]
    _disable(client, h, RequestKind.AUTO)

    async def _run() -> str:
        job = await create_job(
            channel_entries=[(_channel().id, CHANNEL)], source="Test", user_id=me
        )
        await run_sync_job(job, uuid.UUID(me))
        return job.job_id

    job = _job(client, h, client.portal.call(_run))

    assert telegram.calls == []
    assert job["status"] == "completed"
    assert job["channels"][0]["status"] == "skipped"
    assert job["channels"][0]["error"] == "Auto sync is disabled on this deployment"
