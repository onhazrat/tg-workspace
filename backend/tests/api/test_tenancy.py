"""Auto-sync plans per account, not for one operator (ticket 21).

**This file is an inversion, not a rewrite.** It used to hold
`test_auto_sync_scopes_to_operator_channels`, which asserted that `run_auto_sync`
synced `Channel.user_id == operator OR NULL` and skipped a second account's
channels. That was Mode A's rule and it was correct for as long as the
deployment had one account and `Channel.user_id` meant "whose channel is this".

Both halves of that stopped being true. `Channel.user_id` is a "who scraped this
first" stamp the seam never filters on and ticket 22 drops; who watches a channel
lives in `tg_channel_follows`. So the old test's *assertion* — that
`other-channel` is absent — is now exactly backwards: the second account's
channel must be synced, as that account, because it is followed.

Ticket 21's checkbox says these are inverted rather than deleted for a reason.
Deleting it would leave "auto-sync picks one owner" unasserted in either
direction, and the next person to read `run_auto_sync` would have nothing saying
whether the per-owner loop was designed or drifted into.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.jobs.auto_sync import run_auto_sync
from app.jobs.settings import save_settings_section
from app.models import User
from app.models_tg import Channel
from app.services.network_settings import get_network_setting_row
from app.services.scraper_jobs import clear_jobs_for_tests
from tests.utils.setting_groups import add_test_channel, freeze_channels_except
from tests.utils.user import create_random_user


@pytest.fixture
def two_accounts() -> Any:
    """Two real accounts, because one cannot tell the two designs apart.

    The mutation this fixture exists to expose: `run_auto_sync` looping over
    `[operator]` instead of `accounts_with_follows(session)` passes every
    assertion a single-account database can make. Ticket 33's wiring guard hit
    the same wall and solved it the same way.
    """
    with Session(engine) as session:
        first = create_random_user(session)
        second = create_random_user(session)
        yield session, first, second
        session.exec(delete(User).where(col(User.id).in_([first.id, second.id])))
        session.commit()


def _seed_due_channel(
    session: Session, channel_id: str, name: str, owner: uuid.UUID, now: int
) -> None:
    """A channel `owner` follows and that is due for a regular sync.

    `add_test_channel` writes the follow as well as the Channel — ticket 04's
    dual-write, which is what makes the channel reachable from
    `accounts_with_follows` at all.
    """
    add_test_channel(
        session,
        channel_id,
        name=name,
        user_id=owner,
        last_updated=now - 120 * 60 * 1000,
        next_regular_sync_at=now - 1_000,
    )


@patch("app.jobs.auto_sync.enqueue_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_plans_one_job_per_following_account(
    mock_create: AsyncMock,
    mock_enqueue: AsyncMock,
    two_accounts: Any,
) -> None:
    """Each account's followed channels are synced, as that account.

    The inversion of `test_auto_sync_scopes_to_operator_channels`. That test
    asserted `other-channel` was **absent**; here it must be present, in its own
    owner's job, because a second account following a channel is the whole point
    of the follow table.

    Both halves are asserted. Only checking that two jobs were created would
    pass a loop that created them with the wrong owners, and only checking the
    owners would pass one that put every channel in the first account's job —
    which is the Mode-A behaviour wearing a per-owner shape.
    """
    clear_jobs_for_tests()
    now = int(time.time() * 1000)
    session, first, second = two_accounts

    net_row = get_network_setting_row(session)
    if net_row:
        net_row.user_id = first.id
        session.add(net_row)

    save_settings_section(
        session,
        "sync",
        {
            "regularSyncIntervalMinutes": 60,
            "consecutiveFailures": 0,
            "autoSyncPauseUntil": None,
        },
    )

    _seed_due_channel(session, "first-ch", "first-channel", first.id, now)
    _seed_due_channel(session, "second-ch", "second-channel", second.id, now)
    freeze_channels_except(session, {"first-ch", "second-ch"})
    session.commit()

    mock_job = MagicMock()
    mock_job.job_id = "job-per-owner"
    mock_job.status = "completed"
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert mock_create.await_count == 2, (
        f"expected one job per following account, got "
        f"{mock_create.await_count}: {result}"
    )

    by_owner: dict[str, set[str]] = {}
    for call in mock_create.await_args_list:
        owner = call.kwargs["user_id"]
        entries = call.kwargs["channel_entries"]
        by_owner[owner] = {name for _id, name in entries}

    assert by_owner.get(str(first.id)) == {"first-channel"}, (
        f"the first account's job should carry only its own channel: {by_owner}"
    )
    assert by_owner.get(str(second.id)) == {"second-channel"}, (
        f"the second account's channel must be synced too, as that account — "
        f"this is the assertion the pre-ticket-21 test made backwards: {by_owner}"
    )

    enqueued_owners = {call.args[1] for call in mock_enqueue.await_args_list}
    assert enqueued_owners == {first.id, second.id}, (
        f"each job is enqueued for its own owner, so the lane consumer's "
        f"per-account interleaving has something to interleave: {enqueued_owners}"
    )


@patch("app.jobs.auto_sync.enqueue_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_an_unfollowed_channel_is_synced_for_nobody(
    mock_create: AsyncMock,
    mock_enqueue: AsyncMock,
    two_accounts: Any,
) -> None:
    """A Channel with no follow is not scheduled, however due it looks.

    The other direction, and it is what keeps the loop honest: iterating
    `select(Channel)` instead of `accounts_with_follows` would sync this row and
    have no owner to attribute the job to. It is also retention's queue (ticket
    05), so scraping it spends Requests on posts about to be collected.
    """
    clear_jobs_for_tests()
    now = int(time.time() * 1000)
    session, first, _second = two_accounts

    save_settings_section(
        session,
        "sync",
        {
            "regularSyncIntervalMinutes": 60,
            "consecutiveFailures": 0,
            "autoSyncPauseUntil": None,
        },
    )

    _seed_due_channel(session, "kept-ch", "kept-channel", first.id, now)
    # Deliberately no follow — that is the whole subject of this test. Since
    # ticket 22 the Channel carries neither an owner nor a setting group, so
    # "unfollowed" is the only thing left that could make it syncable, which is
    # exactly the property being asserted.
    session.add(
        Channel(
            id="orphan-ch",
            name="orphan-channel",
            last_updated=now - 120 * 60 * 1000,
            next_regular_sync_at=now - 1_000,
        )
    )
    freeze_channels_except(session, {"kept-ch", "orphan-ch"})
    session.commit()

    mock_job = MagicMock()
    mock_job.job_id = "job-orphan"
    mock_job.status = "completed"
    mock_create.return_value = mock_job

    asyncio.run(run_auto_sync())

    synced = {
        name
        for call in mock_create.await_args_list
        for _id, name in call.kwargs["channel_entries"]
    }
    assert "kept-channel" in synced
    assert "orphan-channel" not in synced, (
        "a Channel nobody follows was scheduled; it has no owner to attribute "
        "the job to and retention is about to collect it"
    )
