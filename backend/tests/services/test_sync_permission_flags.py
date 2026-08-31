"""Tests for sync permission flags and operation gates."""

from __future__ import annotations

import time
import uuid
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel
from app.services.channel_setting_groups import (
    channel_allows_reset,
    channel_allows_sync_operation,
    ensure_builtin_groups,
    is_restricted_group,
    move_channel_from_restricted_to_default,
)
from app.services.follows import (
    get_follow,
    get_operator_user_id,
    sync_follow_settings,
)
from app.services.scraper_jobs import clear_jobs_for_tests
from tests.utils.tenancy import ANY_READER

PREFIX = f"{settings.API_V1_STR}/jobs"
DATA = f"{settings.API_V1_STR}/data"


def _wait_for_job(client: TestClient, job_id: str, headers: dict[str, str]) -> dict:
    deadline = time.time() + 10
    data: dict = {}
    while time.time() < deadline:
        status_r = client.get(f"{PREFIX}/sync/{job_id}", headers=headers)
        data = status_r.json()
        if data["status"] in ("completed", "failed", "cancelled"):
            break
        time.sleep(0.1)
    return data


def _operator_id() -> uuid.UUID:
    """The bootstrap superuser `_auth` signs in as."""
    with Session(engine) as session:
        found = get_operator_user_id(session)
    assert found is not None
    return found


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_builtin_group_sync_permission_defaults() -> None:
    user_id = ANY_READER
    with Session(engine) as session:
        _, _, _, frozen, restricted = ensure_builtin_groups(session, user_id=user_id)
        session.commit()

        assert restricted.include_in_sync_all is False
        assert restricted.include_in_bulk_sync is True
        assert restricted.allow_individual_sync is True
        assert restricted.reset_sync_enabled is False

        assert frozen.include_in_sync_all is False
        assert frozen.include_in_bulk_sync is False
        assert frozen.allow_individual_sync is True
        assert frozen.reset_sync_enabled is True


def test_channel_allows_sync_operation_matrix() -> None:
    user_id = ANY_READER
    with Session(engine) as session:
        _, _, _, frozen, restricted = ensure_builtin_groups(session, user_id=user_id)
        session.commit()

        assert channel_allows_sync_operation(restricted, "sync_all") is False
        assert channel_allows_sync_operation(restricted, "bulk") is True
        assert channel_allows_sync_operation(restricted, "individual") is True
        assert channel_allows_sync_operation(restricted, "recheck_restricted") is True

        assert channel_allows_sync_operation(frozen, "sync_all") is False
        assert channel_allows_sync_operation(frozen, "bulk") is False
        assert channel_allows_sync_operation(frozen, "individual") is True


def test_channel_allows_reset_requires_bulk_flag_for_bulk() -> None:
    user_id = ANY_READER
    with Session(engine) as session:
        _, _, _, frozen, restricted = ensure_builtin_groups(session, user_id=user_id)
        session.commit()

        assert channel_allows_reset(restricted, bulk=False) is False
        assert channel_allows_reset(restricted, bulk=True) is False
        assert channel_allows_reset(frozen, bulk=False) is True
        assert channel_allows_reset(frozen, bulk=True) is False


def test_move_channel_from_restricted_to_default() -> None:
    user_id = ANY_READER
    with Session(engine) as session:
        default_group, _, _, _, restricted = ensure_builtin_groups(
            session, user_id=user_id
        )
        session.commit()

        # The group is on the follow since ticket 22, so being "in the
        # Restricted group" is a fact about this account's follow rather than
        # about the shared Channel.
        channel = Channel(id="restricted-move", name="restricted-move")
        session.add(channel)
        session.flush()
        sync_follow_settings(
            session,
            channel,
            user_id=user_id,
            values={"setting_group_id": restricted.id},
        )
        session.commit()

        assert is_restricted_group(restricted) is True
        moved = move_channel_from_restricted_to_default(
            session, channel, user_id=user_id
        )
        session.commit()
        assert moved is not None
        assert moved.id == default_group.id
        follow = get_follow(session, user_id=user_id, channel_id=channel.id)
        assert follow is not None
        assert follow.setting_group_id == default_group.id


def test_sync_all_excludes_restricted_and_frozen(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    # The *authenticated* account, not a random uuid. `POST /jobs/sync` now
    # resolves its candidates from `tg_channel_follows` (ticket 21) rather than
    # from `Channel.user_id == operator OR NULL`, so a channel nobody follows is
    # correctly not syncable and the route answers 400. Seeding under a stranger
    # was invisible while the operator filter also matched unowned rows.
    user_id = _operator_id()

    with Session(engine) as session:
        default_group, _, _, frozen, restricted = ensure_builtin_groups(
            session, user_id=user_id
        )
        session.commit()
        for cid, group_id in (
            ("sync-all-default", default_group.id),
            ("sync-all-restricted", restricted.id),
            ("sync-all-frozen", frozen.id),
        ):
            channel = Channel(id=cid, name=cid)
            session.add(channel)
            session.flush()
            sync_follow_settings(
                session,
                channel,
                user_id=user_id,
                values={"setting_group_id": group_id},
            )
        session.commit()

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value={
            "channelName": "sync-all-default",
            "posts": [],
            "latestId": 0,
            "nextBeforeId": None,
        },
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"syncMode": "sync_all", "source": "Test"},
            headers=headers,
        )
        assert r.status_code == 200
        job_id = r.json()["jobId"]
        status = _wait_for_job(client, job_id, headers)
        names = {ch["channelName"] for ch in status["channels"]}
        assert names == {"sync-all-default"}

    clear_jobs_for_tests()


def test_recheck_restricted_targets_unavailable_channels(client: TestClient) -> None:
    clear_jobs_for_tests()
    headers = _auth(client)
    # The *authenticated* account, not a random uuid. `POST /jobs/sync` now
    # resolves its candidates from `tg_channel_follows` (ticket 21) rather than
    # from `Channel.user_id == operator OR NULL`, so a channel nobody follows is
    # correctly not syncable and the route answers 400. Seeding under a stranger
    # was invisible while the operator filter also matched unowned rows.
    user_id = _operator_id()

    with Session(engine) as session:
        default_group, _, _, _, restricted = ensure_builtin_groups(
            session, user_id=user_id
        )
        session.commit()
        for cid, group_id in (
            ("recheck-restricted", restricted.id),
            ("recheck-default", default_group.id),
        ):
            channel = Channel(id=cid, name=cid)
            session.add(channel)
            session.flush()
            sync_follow_settings(
                session,
                channel,
                user_id=user_id,
                values={"setting_group_id": group_id},
            )
        session.commit()

    with patch(
        "app.services.sync_orchestrator.scrape_channel_page",
        new_callable=AsyncMock,
        return_value={
            "channelName": "recheck-restricted",
            "posts": [],
            "latestId": 0,
            "nextBeforeId": None,
        },
    ):
        r = client.post(
            f"{PREFIX}/sync",
            json={"syncMode": "recheck_restricted", "source": "Test"},
            headers=headers,
        )
        assert r.status_code == 200
        job_id = r.json()["jobId"]
        status = _wait_for_job(client, job_id, headers)
        names = {ch["channelName"] for ch in status["channels"]}
        assert names == {"recheck-restricted"}

    clear_jobs_for_tests()
