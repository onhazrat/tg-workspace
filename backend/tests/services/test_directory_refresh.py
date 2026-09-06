"""A Directory entry goes stale and comes due again (ticket 03, IDEA-011 D16).

Ticket 01 made the probe table a map and ticket 02 gave it a snapshot; both
cached a conclusive answer **indefinitely**, which is right for followability
and wrong for a map. This is the window that reopens one, the verdicts that are
exempt from it, and the second writer — sync — that keeps a followed Channel
current for nothing.

Driven through the two seams the spec names: the **probe write path**
(`record_probe_result`) for what a fetch stores, and now
`record_sync_metadata` for what a sync page stores. Both are observed by what
an entry holds afterwards and what the queue hands out next, never by a column
layout.

## The distinction the whole ticket rests on

`retry_after` means *this fetch failed, back off*. `refresh_due_at` means *this
answer is old*. Same type, opposite cause, and the module already documents a
starvation bug from the one time they were conflated — so they are asserted to
move independently in both directions rather than merely to exist.

## Watched to fail

Per `CLAUDE.md`, each assertion was mutation-tested:

* reuse `retry_after` for due-ness → the independence tests fail in both
  directions
* let a dead verdict become due (drop the `is_refreshable` guard) → the bot,
  group, user and unavailable cases all fail
* read the window from `config.py` instead of the settings row → widening it
  changes nothing and that test fails
* give a scheduled refresh `RECHECK_PRIORITY` → the drain-order test fails,
  because a week-old entry then outranks a handle nobody has ever looked at
* have `record_sync_metadata` call `replace_samples` → the snapshot test fails
* let `record_sync_metadata` write an `unavailable` verdict → the
  deep-page test fails
"""

from __future__ import annotations

from datetime import timedelta
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import save_settings_section
from app.models_tg import DirectoryEntry, utc_now
from app.services.channel_directory import (
    DEFAULT_PROBE_PRIORITY,
    REFRESH_PRIORITY,
    dequeue_handles,
    enqueue_handles,
    record_probe_result,
    record_sync_metadata,
    refresh_due_count,
    refresh_entries,
    requeue_probes,
    resolve_refresh_window,
)
from app.services.channel_directory_samples import replace_samples, samples_for
from app.services.settings_registry import DIRECTORY_KEY

HANDLE = "stale_news"


def _page(**extra: Any) -> dict[str, Any]:
    """A conclusive `get_channel_info` payload for a live channel."""
    return {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": "Stale News",
        "subscribers": "12.3K",
        "latestId": 42,
        **extra,
    }


def _meta(**extra: Any) -> dict[str, Any]:
    """A `channelMeta` dict, as `_parse_channel_meta` builds one.

    Deliberately carries **no `samples` key**: sync parses the page for Posts it
    stores in the corpus and never for a snapshot, which is the whole reason
    ticket 02 made an absent key mean "we did not look".
    """
    return {
        "channelName": HANDLE,
        "displayName": "Stale News",
        "photoUrl": "https://cdn.example/avatar.jpg",
        "bio": "",
        "subscribers": "13.0K",
        "photos": "1.2K",
        "videos": "340",
        "files": "12",
        "links": "5.6K",
        "latestId": 4242,
        "telegramChatId": 1234567890123,
        "isUnavailableOnWebView": False,
        "isTelegramPage": True,
        "kind": "channel",
        **extra,
    }


def _entry(session: Session, handle: str = HANDLE) -> DirectoryEntry:
    row = session.get(DirectoryEntry, handle)
    assert row is not None
    return row


def _set_window(session: Session, days: int) -> None:
    save_settings_section(session, DIRECTORY_KEY, {"directoryRefreshDays": days})
    session.commit()


# --------------------------------------------------------------------------- #
# A live entry comes due; a dead one never does                                 #
# --------------------------------------------------------------------------- #


def test_a_live_entry_becomes_due_after_the_window() -> None:
    """The point of the ticket: a conclusive answer stops being permanent."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        row = _entry(session)

        assert row.status == "ok"
        assert row.refresh_due_at is not None
        # A week out, which is the shipped default.
        due_in = row.refresh_due_at - utc_now()
        assert timedelta(days=6, hours=23) < due_in <= timedelta(days=7)


def test_the_default_window_is_a_week() -> None:
    """The number the ticket names, read from one place."""
    assert settings.DIRECTORY_REFRESH_DAYS_DEFAULT == 7
    with Session(engine) as session:
        assert resolve_refresh_window(session) == timedelta(days=7)


def test_a_due_entry_is_handed_back_by_the_queue() -> None:
    """Due-ness is what reopens the queue, not a second table."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        assert dequeue_handles(session, limit=10) == []

        later = utc_now() + timedelta(days=8)
        assert dequeue_handles(session, limit=10, now=later) == [HANDLE]


def test_an_unavailable_verdict_never_becomes_due() -> None:
    """Private or deleted. Telegram's answer will not change on a timer."""
    with Session(engine) as session:
        record_probe_result(
            session, HANDLE, _page(isUnavailableOnWebView=True, kind="channel")
        )
        assert _entry(session).refresh_due_at is None

        far = utc_now() + timedelta(days=400)
        assert dequeue_handles(session, limit=10, now=far) == []


def test_a_bot_a_group_and_a_user_account_never_become_due() -> None:
    """The three dead kinds. A bot does not become a channel."""
    with Session(engine) as session:
        for handle, kind in (
            ("some_bot", "bot"),
            ("a_group", "group"),
            ("a_guy", "user"),
        ):
            record_probe_result(session, handle, _page(kind=kind))
            row = session.get(DirectoryEntry, handle)
            assert row is not None
            assert row.refresh_due_at is None, kind

        far = utc_now() + timedelta(days=400)
        assert dequeue_handles(session, limit=10, now=far) == []


def test_a_dead_verdict_costs_no_further_requests_however_long_it_sits() -> None:
    """User story 12, stated as the count the Operator cares about."""
    with Session(engine) as session:
        record_probe_result(session, "helper_bot", _page(kind="bot"))
        record_probe_result(session, "live_one", _page())

        far = utc_now() + timedelta(days=90)
        assert dequeue_handles(session, limit=10, now=far) == ["live_one"]
        assert refresh_due_count(session, now=far) == 1


# --------------------------------------------------------------------------- #
# The window is the Operator's lever                                           #
# --------------------------------------------------------------------------- #


def test_widening_the_window_pushes_the_next_refresh_out() -> None:
    """User story 11: the lever short of turning the feature off."""
    with Session(engine) as session:
        _set_window(session, 30)
        record_probe_result(session, HANDLE, _page())

        due_in = _entry(session).refresh_due_at - utc_now()  # type: ignore[operator]
        assert timedelta(days=29) < due_in <= timedelta(days=30)

        # And the queue honours it: a fortnight in, nothing is due.
        assert (
            dequeue_handles(session, limit=10, now=utc_now() + timedelta(days=14)) == []
        )


def test_widening_the_window_reduces_steady_state_request_volume() -> None:
    """The reason the lever exists, counted rather than asserted structurally."""
    with Session(engine) as session:
        for handle in ("one", "two", "three"):
            record_probe_result(session, handle, _page())

        a_fortnight = utc_now() + timedelta(days=14)
        assert refresh_due_count(session, now=a_fortnight) == 3

        _set_window(session, 60)
        for handle in ("one", "two", "three"):
            record_probe_result(session, handle, _page())
        assert refresh_due_count(session, now=a_fortnight) == 0


def test_a_window_of_zero_turns_refreshing_off() -> None:
    """Same convention as every other window in this deployment: 0 = never."""
    with Session(engine) as session:
        _set_window(session, 0)
        assert resolve_refresh_window(session) is None

        record_probe_result(session, HANDLE, _page())
        assert _entry(session).refresh_due_at is None
        assert (
            dequeue_handles(session, limit=10, now=utc_now() + timedelta(days=400))
            == []
        )


# --------------------------------------------------------------------------- #
# Due-ness and retry backoff move independently                                #
# --------------------------------------------------------------------------- #


def test_a_failed_fetch_moves_the_backoff_and_not_the_refresh() -> None:
    """`retry_after` means "this fetch failed". It is not a freshness clock."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, None, error="boom")
        row = _entry(session)

        assert row.retry_after is not None
        assert row.refresh_due_at is None


def test_a_conclusive_answer_moves_the_refresh_and_clears_the_backoff() -> None:
    """The other direction. A resolved handle has nothing to back off from."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, None, error="boom")
        assert _entry(session).retry_after is not None

        record_probe_result(session, HANDLE, _page())
        row = _entry(session)
        assert row.retry_after is None
        assert row.refresh_due_at is not None
        assert row.attempts == 0


def test_a_due_entry_inside_a_retry_backoff_is_still_due() -> None:
    """The starvation shape the module documents, asserted from the queue.

    A row carrying a stale `retry_after` from failures *before* it resolved must
    not have its refresh held behind that clock — the two are separate columns
    precisely so a slow queue cannot be mistaken for a failed fetch.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        row = _entry(session)
        # A backoff far in the future, as a failing handle would carry.
        row.retry_after = utc_now() + timedelta(days=365)
        session.add(row)
        session.commit()

        later = utc_now() + timedelta(days=8)
        assert dequeue_handles(session, limit=10, now=later) == [HANDLE]


# --------------------------------------------------------------------------- #
# Refresh on demand                                                            #
# --------------------------------------------------------------------------- #


def test_an_on_demand_refresh_jumps_the_queue() -> None:
    """User story 13: not reading week-old data while deciding to follow."""
    with Session(engine) as session:
        enqueue_handles(session, [f"pending_{i}" for i in range(5)])
        record_probe_result(session, HANDLE, _page())

        assert refresh_entries(session, [HANDLE]) == [HANDLE]
        assert dequeue_handles(session, limit=3)[0] == HANDLE


def test_an_on_demand_refresh_keeps_the_answer_it_is_refreshing() -> None:
    """The difference from a recheck, and the reason both exist.

    A recheck says the verdict is *wrong* and discards it. A refresh says it is
    *old*, so the entry goes on answering with what it has until the fresh fetch
    lands — otherwise opening a Candidate would blank the very metadata the
    Operator opened it to read.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(telegramChatId=999))
        replace_samples(
            session, HANDLE, [{"id": 1, "text": "hi"}], captured_at=utc_now()
        )
        session.commit()

        refresh_entries(session, [HANDLE])
        row = _entry(session)

        assert row.status == "ok"
        assert row.display_name == "Stale News"
        assert row.subscribers == "12.3K"
        assert row.telegram_chat_id == 999
        assert [s.post_id for s in samples_for(session, HANDLE)] == [1]


def test_a_recheck_still_discards_the_verdict_and_the_due_time_with_it() -> None:
    """A row with no answer has nothing to refresh; it is pending instead."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        assert _entry(session).refresh_due_at is not None

        requeue_probes(session, [HANDLE])
        row = _entry(session)
        assert row.status == "unknown"
        assert row.refresh_due_at is None
        assert dequeue_handles(session, limit=10) == [HANDLE]


def test_a_refresh_of_a_dead_entry_is_still_honoured() -> None:
    """The escape hatch stays reachable: never *automatically* due is not never.

    A channel that went private and came back is exactly the case the Operator
    is looking at when they press refresh, so an explicit request overrides the
    dead-verdict exemption the scheduler honours.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(isUnavailableOnWebView=True))
        assert _entry(session).refresh_due_at is None

        refresh_entries(session, [HANDLE])
        assert dequeue_handles(session, limit=10) == [HANDLE]


# --------------------------------------------------------------------------- #
# Drain order                                                                  #
# --------------------------------------------------------------------------- #


def test_a_scheduled_refresh_drains_behind_a_handle_nobody_has_looked_at() -> None:
    """An answer we hold is worth less than one we have never had.

    A refreshed row keeps the rank of whatever report first enqueued it, which
    for a rechecked handle is the front of the queue — so a conclusive probe
    resets the rank to the refresh sentinel rather than leaving a week-old entry
    outranking every unprobed handle forever.
    """
    with Session(engine) as session:
        # Rechecked once, so its stored rank is the front of the queue.
        requeue_probes(session, [HANDLE])
        record_probe_result(session, HANDLE, _page())
        assert _entry(session).priority == REFRESH_PRIORITY
        assert REFRESH_PRIORITY > DEFAULT_PROBE_PRIORITY

        enqueue_handles(session, ["fresh_blood"])
        later = utc_now() + timedelta(days=8)
        assert dequeue_handles(session, limit=10, now=later) == ["fresh_blood", HANDLE]


# --------------------------------------------------------------------------- #
# A followed Channel stays current for free                                    #
# --------------------------------------------------------------------------- #


def test_sync_metadata_updates_the_entry() -> None:
    """User story 26: freshness on a followed Channel costs no extra request."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        session.commit()

        later = utc_now() + timedelta(days=8)
        record_sync_metadata(session, HANDLE, _meta(), now=later)
        session.commit()

        row = _entry(session)
        assert row.status == "ok"
        assert row.subscribers == "13.0K"
        assert row.photos == "1.2K"
        assert row.telegram_chat_id == 1234567890123
        assert row.latest_id == 4242
        assert row.checked_at == later


def test_a_synced_channel_never_comes_due_for_a_probe() -> None:
    """The duplicate fetch this removes: sync covers a followed Channel already."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())

        later = utc_now() + timedelta(days=8)
        record_sync_metadata(session, HANDLE, _meta(), now=later)
        session.commit()

        assert dequeue_handles(session, limit=10, now=later) == []


def test_sync_creates_an_entry_for_a_channel_the_directory_has_never_seen() -> None:
    """A follow that predates the Directory still lands on the map."""
    with Session(engine) as session:
        record_sync_metadata(session, "brand_new", _meta(channelName="brand_new"))
        session.commit()

        row = session.get(DirectoryEntry, "brand_new")
        assert row is not None
        assert row.status == "ok"
        assert row.subscribers == "13.0K"


def test_the_metadata_only_update_does_not_clear_the_samples() -> None:
    """Ticket 02's absent-key rule, at the moment it becomes load-bearing.

    Sync fetches this metadata and never parses Posts. An empty list here would
    blank every followed Channel's snapshot on every sync, which is the failure
    the two rules were separated to prevent.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page(samples=[{"id": 7, "text": "hi"}]))
        assert [s.post_id for s in samples_for(session, HANDLE)] == [7]

        record_sync_metadata(session, HANDLE, _meta())
        session.commit()

        assert [s.post_id for s in samples_for(session, HANDLE)] == [7]


def test_a_deep_page_never_writes_an_unavailable_verdict() -> None:
    """A page walked backwards past the first post looks unavailable and is not.

    `isUnavailableOnWebView` is `latestId == 0 and a page action`, both of which
    a deep pagination window can satisfy on a perfectly healthy Channel. Sync
    reaching this function at all *is* the evidence the handle is scrapeable, so
    the one verdict this path may write is `ok`.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        record_sync_metadata(
            session, HANDLE, _meta(isUnavailableOnWebView=True, latestId=0)
        )
        session.commit()

        assert _entry(session).status == "ok"


def test_a_page_that_is_not_telegram_writes_nothing() -> None:
    """The verdict rule this module has enforced since it was a probe cache."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        before = _entry(session).subscribers

        record_sync_metadata(session, HANDLE, _meta(isTelegramPage=False))
        session.commit()

        assert _entry(session).subscribers == before


def test_sync_leaves_the_transaction_to_its_caller() -> None:
    """`_apply_scrape_page` writes posts, gaps and this in one unit.

    Committing here would land a Directory update from a page whose Posts then
    failed to persist — and would commit the caller's half-written page with it.
    """
    with Session(engine) as session:
        record_sync_metadata(session, "uncommitted", _meta(channelName="uncommitted"))
        session.rollback()

        assert session.get(DirectoryEntry, "uncommitted") is None


# --------------------------------------------------------------------------- #
# A refresh that fails                                                          #
# --------------------------------------------------------------------------- #


def test_a_failed_refresh_keeps_the_answer_it_could_not_replace() -> None:
    """One timeout must not blank a Directory entry in every report.

    Before ticket 03 this branch was only ever reached by a handle with no
    verdict, so demoting the row cost nothing. Refreshing re-fetches every live
    entry on a window, which puts a proxy timeout between a good answer and the
    reports that join it — the same "a wrong answer is permanent" failure the
    verdict rule exists to prevent, arriving from the other side.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())

        record_probe_result(session, HANDLE, None, error="proxy timeout")
        row = _entry(session)

        assert row.status == "ok"
        assert row.display_name == "Stale News"
        assert row.subscribers == "12.3K"
        assert row.attempts == 1
        assert row.last_error == "proxy timeout"


def test_a_failed_refresh_backs_off_instead_of_retrying_every_tick() -> None:
    """The hot loop the two clocks would otherwise open.

    A row that keeps its verdict is invisible to the pending leg of the dequeue,
    so the refresh leg is the only way it comes back — and that leg consults no
    backoff. Without moving the due time with it, a handle failing behind a dead
    proxy would be fetched on every sweep for ever.
    """
    with Session(engine) as session:
        record_probe_result(session, HANDLE, _page())
        later = utc_now() + timedelta(days=8)
        assert dequeue_handles(session, limit=10, now=later) == [HANDLE]

        record_probe_result(session, HANDLE, None, error="proxy timeout")
        assert dequeue_handles(session, limit=10, now=utc_now()) == []

        row = _entry(session)
        assert row.retry_after is not None
        assert row.refresh_due_at == row.retry_after
        assert dequeue_handles(
            session, limit=10, now=row.retry_after + timedelta(minutes=1)
        ) == [HANDLE]


def test_a_failed_first_probe_still_has_no_answer_to_keep() -> None:
    """The original behaviour, unchanged for a handle nobody has resolved."""
    with Session(engine) as session:
        record_probe_result(session, HANDLE, None, error="boom")
        row = _entry(session)

        assert row.status == "unknown"
        assert row.refresh_due_at is None
        assert dequeue_handles(session, limit=10) == []
