from __future__ import annotations

import asyncio
import uuid
from typing import Any

import httpx
import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.auto_sync import CHECK_SOURCE
from app.models_tg import Channel, ChannelSettingGroup, Post, SyncLog
from app.services import sync_orchestrator
from app.services.channel_setting_groups import RESTRICTED_GROUP_NAME
from app.services.follows import get_follow, get_operator_user_id
from app.services.scraper_jobs import ChannelSyncState, SyncJobState
from app.services.sync_orchestrator import (
    SyncScrapeError,
    _apply_scrape_page,
    _ChannelSyncCtx,
    _finalize_channel_error,
    _finalize_channel_scrape_error,
    _finalize_channel_success,
    _scrape_page_with_retry,
    _sync_claimed_channel,
)
from app.services.sync_schedule import (
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)
from app.services.telegram_web import (
    TelegramWebViewUnavailable,
    telegram_web_view_channel_url,
)
from tests.utils.setting_groups import upsert_sync_test_channel


def _ctx(channel_id: str, channel_name: str) -> _ChannelSyncCtx:
    return _ChannelSyncCtx(
        channel_id=channel_id,
        channel_name=channel_name,
        display_name=channel_name,
        photo_url=None,
        auto_follow=False,
        proxies=[],
        proxy_concurrency=(1, {}),
        tor_auto_rotate=False,
        tor_rotation_threshold=10,
        tor_control_enabled=False,
        tor_control_port=9051,
        retrieval_pass="incremental",
        needs_backfill=False,
        min_stored_post_id=None,
        scrape_cutoff_ms=0,
        effective_start_time=0,
    )


def test_finalize_channel_success_recomputes_deadlines() -> None:
    channel_id = f"orchestrator-success-{uuid.uuid4()}"
    now_ms = 1_725_000_000_000

    with Session(engine) as session:
        # Seeded under the operator, because that is who `user_id=None`
        # resolves to below. The setting group hangs off the follow since
        # ticket 22, so the follow the orchestrator looks for has to be the
        # one this seeds — under `ANY_READER` there would be no follow for the
        # resolved account and the group lookup answers 500.
        operator_id = get_operator_user_id(session)
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=operator_id,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
                "auto_sync_interval_minutes": 60,
                "dynamic_sync_expected_posts": 15,
            },
        )
        session.add(
            Post(
                channel_name=channel_id,
                post_id=1,
                text="a",
                timestamp=now_ms - 3_600_000,
            )
        )
        session.add(
            Post(
                channel_name=channel_id,
                post_id=2,
                text="b",
                timestamp=now_ms - 1_800_000,
            )
        )
        session.commit()

    _finalize_channel_success(
        _ctx(channel_id, channel_id),
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-success", source="Manual"
        ),
        user_id=None,
        total_new_posts=2,
        final_latest_id=2,
        requests_log=[],
        responses_log=[],
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        follow = get_follow(session, user_id=operator_id, channel_id=channel_id)
        assert follow is not None
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None
        assert channel.last_updated is not None
        assert (
            channel.next_regular_sync_at
            == compute_next_regular_sync_at_from_last_updated(
                channel.last_updated,
                group.auto_sync_interval_minutes,
                channel.last_updated,
            )
        )
        assert channel.next_dynamic_sync_at is not None
        assert channel.next_dynamic_sync_at > channel.last_updated
        implied_hours = (
            channel.next_dynamic_sync_at - channel.last_updated
        ) / 3_600_000
        implied_velocity = group.dynamic_sync_expected_posts / implied_hours
        assert (
            compute_next_dynamic_sync_at_from_last_updated(
                channel.last_updated,
                group.dynamic_sync_expected_posts,
                implied_velocity,
                channel.last_updated,
            )
            == channel.next_dynamic_sync_at
        )


def test_scheduler_failure_backoff_updates_due_schedule_only() -> None:
    channel_id = f"orchestrator-fail-{uuid.uuid4()}"
    with Session(engine) as session:
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=None,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
            },
            channel_fields={
                "next_regular_sync_at": 100,
                "next_dynamic_sync_at": 200,
            },
        )

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-fail", source=CHECK_SOURCE
        ),
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason="regular",
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert channel.next_regular_sync_at is not None
        assert channel.next_regular_sync_at > 100
        assert channel.next_dynamic_sync_at == 200


def test_manual_failure_does_not_apply_backoff() -> None:
    channel_id = f"orchestrator-manual-{uuid.uuid4()}"
    with Session(engine) as session:
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=None,
            group_fields={
                "regular_sync_enabled": True,
                "dynamic_sync_enabled": True,
            },
            channel_fields={
                "next_regular_sync_at": 111,
                "next_dynamic_sync_at": 222,
            },
        )

    _finalize_channel_error(
        _ctx(channel_id, channel_id),
        "boom",
        job=SyncJobState(
            user_id=str(uuid.uuid4()), job_id="job-manual", source="Manual sync"
        ),
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason="both",
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert channel.next_regular_sync_at == 111
        assert channel.next_dynamic_sync_at == 222


def test_apply_scrape_page_mismatch_freezes_channel_and_logs_failure() -> None:
    channel_id = f"orchestrator-mismatch-{uuid.uuid4()}"
    with Session(engine) as session:
        # Seeded under the operator: the freeze resolves its owner through
        # `resolve_follow_owner(None)` and lands on that account's follow, so
        # the follow being asserted on below has to be theirs.
        channel = upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=get_operator_user_id(session),
            channel_fields={"telegram_chat_id": -1001},
        )
        channel_name = channel.name

    result = _apply_scrape_page(
        _ctx(channel_id, channel_name),
        {
            "fullRequest": {"url": telegram_web_view_channel_url(channel_name)},
            "posts": [],
            "latestId": 0,
            "telegramChatId": -1002,
        },
        job_id="job-mismatch",
        job_source="Manual",
        user_id=None,
        session_seen_ids=set(),
        before_id=None,
    )
    assert result.stop_sync is True
    assert result.sync_failed is True
    assert result.sync_error is not None
    assert "mismatch" in result.sync_error.lower()

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        # The freeze lands on the follow since ticket 22: parking a handle is
        # one account's judgement, and on the Channel it froze the handle for
        # every follower.
        freeze_owner = get_operator_user_id(session)
        assert freeze_owner is not None
        follow = get_follow(session, user_id=freeze_owner, channel_id=channel_id)
        assert follow is not None
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None
        assert group.name == "Frozen"
        log = session.exec(
            select(SyncLog)
            .where(SyncLog.channel_name == channel_name)
            .order_by(SyncLog.timestamp.desc())
        ).first()
        assert log is not None
        assert log.status == "failed"
        assert log.error is not None
        assert "mismatch" in log.error.lower()


# --------------------------------------------------------------------------
# `_scrape_page_with_retry`: which failures are retried, and what one costs
# --------------------------------------------------------------------------


def _status_error(code: int) -> httpx.HTTPStatusError:
    request = httpx.Request("GET", "https://t.me/s/x")
    return httpx.HTTPStatusError(
        str(code), request=request, response=httpx.Response(code, request=request)
    )


class _Scrape:
    """`scrape_channel_page` answering from a script, with Tor and the backoff
    sleep recorded instead of performed."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, *outcomes: Any) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []
        self.sleeps: list[float] = []
        self.rotations: list[int] = []
        self.rotation_error: Exception | None = None
        real_sleep = asyncio.sleep

        async def page(channel_name: str, **kwargs: Any) -> dict[str, Any]:
            self.calls.append({"channel_name": channel_name, **kwargs})
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, BaseException):
                raise outcome
            return dict(outcome)

        async def rotate(port: int) -> None:
            self.rotations.append(port)
            if self.rotation_error is not None:
                raise self.rotation_error

        async def sleep(seconds: float) -> None:
            self.sleeps.append(seconds)
            await real_sleep(0)

        monkeypatch.setattr(sync_orchestrator, "scrape_channel_page", page)
        monkeypatch.setattr(sync_orchestrator, "rotate_tor_identity", rotate)
        monkeypatch.setattr(sync_orchestrator.asyncio, "sleep", sleep)
        monkeypatch.setattr(settings, "SYNC_MAX_RETRIES", 2)
        monkeypatch.setattr(settings, "SYNC_RETRY_BACKOFF_BASE_MS", 100)

    def run(self, **overrides: Any) -> dict[str, Any]:
        kwargs: dict[str, Any] = {
            "before_id": None,
            "known_latest_id": 0,
            "known_display_name": "Name",
            "known_photo_url": "https://cdn/p.jpg",
            "proxies": ["socks5://tor:9050"],
            "tor_auto_rotate": False,
            "tor_rotation_threshold": 10,
            "tor_control_enabled": True,
            "tor_control_port": 9051,
            "proxy_concurrency": (1, {}),
        } | overrides
        return asyncio.run(_scrape_page_with_retry("chan", **kwargs))


def test_a_first_page_answer_carries_the_request_that_produced_it(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A channel with nothing stored yet sends no known metadata, so the
    scraper fetches the channel page rather than trusting a stale name."""
    scrape = _Scrape(monkeypatch, {"posts": []})

    response = scrape.run()

    assert response["fullRequest"] == {
        "url": telegram_web_view_channel_url("chan"),
        "beforeId": None,
        "knownLatestId": None,
    }
    call = scrape.calls[0]
    assert call["known_latest_id"] is None
    assert call["known_display_name"] is None
    assert call["known_photo_url"] is None
    assert scrape.sleeps == []


def test_a_known_channel_passes_its_metadata_and_pages_backwards(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scrape = _Scrape(monkeypatch, {"posts": []})

    response = scrape.run(before_id=50, known_latest_id=99)

    assert response["fullRequest"] == {
        "url": telegram_web_view_channel_url("chan", before_id=50),
        "beforeId": 50,
        "knownLatestId": 99,
    }
    call = scrape.calls[0]
    assert call["known_latest_id"] == 99
    assert call["known_display_name"] == "Name"
    assert call["known_photo_url"] == "https://cdn/p.jpg"


def test_a_rate_limit_rotates_tor_and_backs_off_exponentially(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """**Mutation:** drop the `is_rate_limit and` from the rotation guard and
    the network error that follows rotates too; drop the `2**retry_count` and
    the sleeps stop doubling."""
    scrape = _Scrape(
        monkeypatch,
        _status_error(429),
        httpx.ConnectError("reset"),
        {"posts": [1]},
    )

    response = scrape.run()

    assert response["posts"] == [1]
    assert len(scrape.calls) == 3
    assert scrape.rotations == [9051]
    assert scrape.sleeps == [0.2, 0.4]


@pytest.mark.parametrize(
    "overrides",
    [
        pytest.param({"tor_control_enabled": False}, id="tor-control-off"),
        pytest.param({"proxies": []}, id="no-proxies"),
    ],
)
def test_a_rate_limit_without_tor_control_only_backs_off(
    monkeypatch: pytest.MonkeyPatch, overrides: dict[str, Any]
) -> None:
    scrape = _Scrape(monkeypatch, _status_error(429), {"posts": []})

    scrape.run(**overrides)

    assert scrape.rotations == []
    assert scrape.sleeps == [0.2]


def test_a_failed_tor_rotation_does_not_stop_the_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scrape = _Scrape(monkeypatch, _status_error(429), {"posts": []})
    scrape.rotation_error = OSError("control port closed")

    assert scrape.run()["posts"] == []
    assert len(scrape.calls) == 2


@pytest.mark.parametrize(
    ("error", "rate_limited"),
    [
        pytest.param(_status_error(429), True, id="rate-limit"),
        pytest.param(httpx.ReadTimeout("slow"), False, id="network"),
        # A 500 is still an `httpx.HTTPError`, so it rides the same ladder.
        pytest.param(_status_error(500), False, id="http-500"),
    ],
)
def test_retries_stop_at_the_configured_count(
    monkeypatch: pytest.MonkeyPatch, error: Exception, rate_limited: bool
) -> None:
    scrape = _Scrape(monkeypatch, error, error, error, {"posts": []})

    with pytest.raises(SyncScrapeError) as raised:
        scrape.run(tor_control_enabled=False)

    assert len(scrape.calls) == 1 + settings.SYNC_MAX_RETRIES
    assert raised.value.is_rate_limited is rate_limited
    assert raised.value.is_unavailable is False
    assert raised.value.full_request["url"] == telegram_web_view_channel_url("chan")


def test_an_unavailable_web_view_is_never_retried(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The soft block subclasses `ConnectionError`, so by type it *is* a
    network error. It has to be caught first, or every restricted channel costs
    two more Requests and a backoff before it is parked.

    **Mutation:** move the `is_unavailable` check below the retry branch and
    this goes red on the call count.
    """
    scrape = _Scrape(monkeypatch, TelegramWebViewUnavailable(), {"posts": []})

    with pytest.raises(SyncScrapeError) as raised:
        scrape.run()

    assert len(scrape.calls) == 1
    assert raised.value.is_unavailable is True
    assert raised.value.full_response == {"error": str(TelegramWebViewUnavailable())}


def test_a_failure_that_is_not_network_is_raised_at_once(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    scrape = _Scrape(monkeypatch, ValueError("parse"), {"posts": []})

    with pytest.raises(SyncScrapeError) as raised:
        scrape.run()

    assert len(scrape.calls) == 1
    assert raised.value.is_rate_limited is False
    assert scrape.sleeps == []


# --------------------------------------------------------------------------
# `_finalize_channel_scrape_error`
# --------------------------------------------------------------------------


def _seed_operator_channel(channel_fields: dict[str, Any] | None = None) -> str:
    channel_id = f"orchestrator-scrape-{uuid.uuid4()}"
    with Session(engine) as session:
        upsert_sync_test_channel(
            session,
            channel_id=channel_id,
            user_id=get_operator_user_id(session),
            group_fields={"regular_sync_enabled": True, "dynamic_sync_enabled": True},
            channel_fields=channel_fields,
        )
    return channel_id


def _last_log(channel_name: str) -> SyncLog | None:
    with Session(engine) as session:
        return session.exec(
            select(SyncLog)
            .where(SyncLog.channel_name == channel_name)
            .order_by(SyncLog.timestamp.desc())
        ).first()


def _channel_name(channel_id: str) -> str:
    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        return channel.name


def test_an_unavailable_channel_is_parked_in_restricted_and_logged() -> None:
    """**Mutation:** drop the `is_unavailable` branch and the follow stays in
    its old group, so the scheduler keeps paying for a page that never loads."""
    channel_id = _seed_operator_channel()

    _finalize_channel_scrape_error(
        _ctx(channel_id, channel_id),
        SyncScrapeError("gone", is_unavailable=True),
        job=SyncJobState(user_id=str(uuid.uuid4()), job_id="j", source="Manual"),
        user_id=None,
        total_new_posts=3,
        requests_log=[{"url": "u"}],
        responses_log=[],
        due_reason=None,
    )

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None
        follow = get_follow(session, user_id=operator_id, channel_id=channel_id)
        assert follow is not None
        group = session.get(ChannelSettingGroup, follow.setting_group_id)
        assert group is not None
        assert group.name == RESTRICTED_GROUP_NAME
    log = _last_log(_channel_name(channel_id))
    assert log is not None
    assert (log.status, log.error, log.posts_count) == ("failed", "gone", 3)


@pytest.mark.parametrize(
    ("source", "due_reason", "backed_off"),
    [
        pytest.param(CHECK_SOURCE, "regular", True, id="scheduler"),
        pytest.param(CHECK_SOURCE, None, False, id="scheduler-not-due"),
        pytest.param("Manual sync", "regular", False, id="manual"),
    ],
)
def test_a_scrape_error_backs_off_only_a_scheduled_due_channel(
    source: str, due_reason: str | None, backed_off: bool
) -> None:
    channel_id = _seed_operator_channel(
        {"next_regular_sync_at": 100, "next_dynamic_sync_at": 200}
    )

    _finalize_channel_scrape_error(
        _ctx(channel_id, channel_id),
        SyncScrapeError("rate limited", is_rate_limited=True),
        job=SyncJobState(user_id=str(uuid.uuid4()), job_id="j", source=source),
        user_id=None,
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason=due_reason,
    )

    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        assert channel is not None
        assert (channel.next_regular_sync_at != 100) is backed_off
        assert channel.next_dynamic_sync_at == 200
    log = _last_log(_channel_name(channel_id))
    assert log is not None
    assert (log.status, log.error) == ("failed", "rate limited")


def test_a_scrape_error_for_a_deleted_channel_writes_nothing() -> None:
    missing = f"orchestrator-gone-{uuid.uuid4()}"

    _finalize_channel_scrape_error(
        _ctx(missing, missing),
        SyncScrapeError("gone", is_unavailable=True),
        job=SyncJobState(user_id=str(uuid.uuid4()), job_id="j", source=CHECK_SOURCE),
        user_id=None,
        total_new_posts=0,
        requests_log=[],
        responses_log=[],
        due_reason="regular",
    )

    assert _last_log(missing) is None


# --------------------------------------------------------------------------
# `_sync_claimed_channel`: every way a claimed sync can end
# --------------------------------------------------------------------------


class _ClaimedRun:
    """The claimed body with the database and the network stubbed out.

    Records every status `touch_job` published and which finaliser ran with
    what. The claim, the lost-claim path and success are exercised for real by
    `test_channel_mutual_exclusion.py`; this covers the early exits and the two
    failure handlers it never reaches.
    """

    def __init__(
        self,
        monkeypatch: pytest.MonkeyPatch,
        *,
        prepared: tuple[str, Any, str | None],
        walk_error: Exception | None = None,
    ) -> None:
        self.published: list[str] = []
        self.finalised: list[tuple[str, dict[str, Any]]] = []
        self.walked = False

        async def touch(_job: SyncJobState, ch: ChannelSyncState) -> None:
            self.published.append(ch.status)

        def prepare(*_args: Any, **_kwargs: Any) -> tuple[str, Any, str | None]:
            return prepared

        async def walk(_job: Any, _ch: Any, _ctx: Any, w: Any, **_kw: Any) -> None:
            self.walked = True
            w.total_new_posts = 4
            if walk_error is not None:
                raise walk_error

        def finaliser(name: str) -> Any:
            def record(*_args: Any, **kwargs: Any) -> None:
                self.finalised.append((name, kwargs))

            return record

        monkeypatch.setattr(sync_orchestrator, "touch_job", touch)
        monkeypatch.setattr(sync_orchestrator, "_prepare_channel_sync", prepare)
        monkeypatch.setattr(sync_orchestrator, "_walk_channel_pages", walk)
        monkeypatch.setattr(
            sync_orchestrator,
            "_finalize_channel_scrape_error",
            finaliser("scrape_error"),
        )
        monkeypatch.setattr(
            sync_orchestrator, "_finalize_channel_error", finaliser("error")
        )

    def run(self, *, cancelled: bool = False) -> tuple[bool, ChannelSyncState]:
        ch_state = ChannelSyncState(
            channel_id="c", channel_name="c", metadata={"dueReason": "dynamic"}
        )

        async def go() -> bool:
            job = SyncJobState(user_id=str(uuid.uuid4()), job_id="j", source="S")
            if cancelled:
                job.cancel_event.set()
            return await _sync_claimed_channel(job, ch_state, user_id=None, holder="h")

        return asyncio.run(go()), ch_state


@pytest.mark.parametrize(
    ("prepared", "cancelled", "status", "error"),
    [
        pytest.param(("ok", None, None), True, "cancelled", None, id="cancelled"),
        pytest.param(
            ("missing", None, None), False, "failed", "Channel not found", id="missing"
        ),
        pytest.param(
            ("denied", None, "excluded from sync-all"),
            False,
            "skipped",
            "excluded from sync-all",
            id="denied-with-reason",
        ),
        pytest.param(
            ("denied", None, None),
            False,
            "skipped",
            "Sync not allowed for this channel",
            id="denied-without-reason",
        ),
    ],
)
def test_an_early_exit_is_not_a_walk(
    monkeypatch: pytest.MonkeyPatch,
    prepared: tuple[str, Any, str | None],
    cancelled: bool,
    status: str,
    error: str | None,
) -> None:
    """Returning False is what stops `_apply_coalesced_outcome` handing this
    job's reason to a rider whose own sync mode might be allowed.

    **Mutation:** return True from the denied branch and the rider inherits a
    `skipped` it never earned.
    """
    run = _ClaimedRun(monkeypatch, prepared=prepared)

    walked, ch_state = run.run(cancelled=cancelled)

    assert walked is False
    assert run.walked is False
    assert (ch_state.status, ch_state.error) == (status, error)
    assert run.published[-1] == status


@pytest.mark.parametrize(
    ("error", "finaliser"),
    [
        pytest.param(
            SyncScrapeError("429 again", is_rate_limited=True),
            "scrape_error",
            id="scrape-error",
        ),
        pytest.param(RuntimeError("bug"), "error", id="anything-else"),
    ],
)
def test_a_walk_that_raises_is_finalised_as_a_failure_with_its_due_reason(
    monkeypatch: pytest.MonkeyPatch, error: Exception, finaliser: str
) -> None:
    """Each kind of failure reaches its own finaliser, carrying the due reason
    the scheduler stamped, so the backoff lands on the schedule that fired.

    **Mutation:** swap the two `except` clauses' finalisers and both cases fail.
    """
    ctx = _ctx("c", "c")
    run = _ClaimedRun(monkeypatch, prepared=("ok", ctx, None), walk_error=error)

    walked, ch_state = run.run()

    assert walked is True
    assert [name for name, _ in run.finalised] == [finaliser]
    kwargs = run.finalised[0][1]
    assert kwargs["due_reason"] == "dynamic"
    assert kwargs["total_new_posts"] == 4
    assert (ch_state.status, ch_state.error, ch_state.posts_fetched) == (
        "failed",
        str(error),
        4,
    )
    assert run.published == ["running", "failed"]
