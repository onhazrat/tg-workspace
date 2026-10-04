"""Two requests creating the same built-in group must both succeed.

A fresh account has no setting groups. Opening the Channels tab fires
`GET /data/setting-groups`, which creates all five built-ins, and the first
`PUT /data/channels/{id}` creates the default one too. Both used to read the
row with `session.get`, find nothing, and INSERT it. The second INSERT waited
on the first's primary-key lock and, once that committed, raised
`UniqueViolation`, which the route answered as a 500. It passed on retry
because by then the row existed, which is how it surfaced as a Playwright flake
on the first test of a shard (`tg-ui-primitives.spec.ts`, `seedTestChannel`)
that `--fail-on-flaky-tests` turns red.

The test reproduces the interleaving rather than hoping for it: the first
transaction holds its flushed built-ins open until the second has blocked on
the row lock, then commits.
"""

from __future__ import annotations

import threading
import time
import uuid

from sqlalchemy import text
from sqlmodel import Session

from app.core.db import engine
from app.models_tg import ChannelSettingGroup
from app.services.channel_setting_groups import (
    default_group_id_for_user,
    ensure_builtin_groups,
)
from app.services.channels import upsert_channel
from app.services.follows import get_follow
from tests.utils.user import create_random_user


def _wait_until_a_backend_waits_on_a_lock(timeout_s: float = 10.0) -> bool:
    deadline = time.monotonic() + timeout_s
    with engine.connect() as conn:
        while time.monotonic() < deadline:
            waiting = conn.execute(
                text(
                    "SELECT count(*) FROM pg_stat_activity "
                    "WHERE datname = current_database() "
                    "AND wait_event_type = 'Lock'"
                )
            ).scalar_one()
            conn.commit()
            if waiting:
                return True
            time.sleep(0.05)
    return False


def test_first_channel_put_survives_a_concurrent_setting_group_list(
    db: Session,
) -> None:
    user_id = create_random_user(db).id
    channel_id = f"seedrace{uuid.uuid4().hex[:8]}"
    outcome: dict[str, BaseException | None] = {}

    def put_channel() -> None:
        try:
            with Session(engine) as put_session:
                upsert_channel(
                    put_session,
                    channel_id,
                    {"id": channel_id, "name": channel_id},
                    user_id=user_id,
                )
            outcome["error"] = None
        except BaseException as exc:  # noqa: BLE001 - reported below
            outcome["error"] = exc

    with Session(engine) as list_session:
        # `list_setting_groups` up to its commit: the built-ins are flushed and
        # their row locks held.
        ensure_builtin_groups(list_session, user_id=user_id)
        worker = threading.Thread(target=put_channel)
        worker.start()
        assert _wait_until_a_backend_waits_on_a_lock(), (
            "the PUT never blocked on the uncommitted default group"
        )
        list_session.commit()

    worker.join(timeout=30)
    assert not worker.is_alive()
    assert outcome["error"] is None, f"PUT raised {outcome['error']!r}"

    with Session(engine) as check:
        assert check.get(ChannelSettingGroup, default_group_id_for_user(user_id))
        follow = get_follow(check, user_id=user_id, channel_id=channel_id)
        assert follow is not None
        assert follow.setting_group_id == default_group_id_for_user(user_id)
