"""Mode A scheduler scoping tests."""

from __future__ import annotations

import asyncio
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from sqlmodel import Session

from app.core.db import engine
from app.jobs.auto_sync import run_auto_sync
from app.jobs.settings import save_settings_section
from app.models_tg import Channel
from app.services.network_settings import get_network_setting_row
from app.services.operator import get_operator_user_id
from app.services.scraper_jobs import clear_jobs_for_tests
from tests.utils.setting_groups import add_test_channel, freeze_channels_except


def _freeze_channels_except(session: Session, keep_ids: set[str]) -> None:
    freeze_channels_except(session, keep_ids)


@patch("app.jobs.auto_sync.run_sync_job", new_callable=AsyncMock)
@patch("app.jobs.auto_sync.create_job", new_callable=AsyncMock)
def test_auto_sync_scopes_to_operator_channels(
    mock_create: AsyncMock,
    mock_run: AsyncMock,
) -> None:
    clear_jobs_for_tests()
    now = int(time.time() * 1000)
    other_user = uuid.uuid4()

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        assert operator_id is not None

        net_row = get_network_setting_row(session)
        if net_row:
            net_row.user_id = operator_id
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

        stale_from_prior = session.get(Channel, "stale-ch")
        if stale_from_prior:
            stale_from_prior.user_id = other_user
            session.add(stale_from_prior)

        for ch_id, name, uid in (
            ("op-ch", "op-channel", operator_id),
            ("other-ch", "other-channel", other_user),
        ):
            existing = session.get(Channel, ch_id)
            if existing:
                existing.name = name
                existing.last_updated = now - 120 * 60 * 1000
                existing.user_id = uid
                existing.next_regular_sync_at = now - 1_000
                session.add(existing)
            else:
                add_test_channel(
                    session,
                    ch_id,
                    name=name,
                    user_id=uid,
                    last_updated=now - 120 * 60 * 1000,
                    next_regular_sync_at=now - 1_000,
                )
        _freeze_channels_except(session, {"op-ch", "other-ch"})
        session.commit()

    mock_job = MagicMock()
    mock_job.job_id = "job-scope"
    mock_job.status = "completed"
    mock_job.channels = {"op-channel": MagicMock(status="success")}
    mock_create.return_value = mock_job

    result = asyncio.run(run_auto_sync())
    assert mock_create.await_args is not None, f"create_job not called: {result}"

    called_entries = (
        mock_create.await_args.kwargs.get("channel_entries")
        or mock_create.await_args.args[0]
    )
    names = [name for _id, name in called_entries]
    assert "op-channel" in names
    assert "other-channel" not in names
