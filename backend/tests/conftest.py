"""Pytest configuration — always uses the isolated test database (app_test)."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path
from typing import Any

import pytest
from dotenv import load_dotenv

_REPO_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(_REPO_ROOT / ".env")

_test_db = os.environ.get("TEST_POSTGRES_DB") or os.environ.get(
    "POSTGRES_DB_TEST", "app_test"
)
os.environ["POSTGRES_DB"] = _test_db

# Rebind settings + engine before any route handlers import the dev database.
from sqlmodel import Session, create_engine, delete

from app.core import config as config_module
from app.core.config import Settings

config_module.settings = Settings()

import app.core.db as db_module

db_module.engine = create_engine(str(config_module.settings.SQLALCHEMY_DATABASE_URI))

from fastapi.testclient import TestClient

from app.core.config import settings
from app.core.db import engine, init_db
from app.main import app
from app.models import Item, User
from app.models_tg import Channel, ChannelSettingGroup
from app.services.follows import FOLLOW_OWNED_FIELDS, sync_follow_settings

# Re-exported so tests can request it by name. Ticket 21's guards need the
# pre-NOT-NULL schema, and the fixture has to depend on `db` to release the
# session-scoped transaction holding locks on those tables.
from tests.utils.legacy_owner_schema import (  # noqa: F401
    legacy_channel_group_column,
    legacy_channel_per_user_columns,
    legacy_owner_schema,
)

# Autouse: gives `ANY_READER` a real "user" row. Ticket 21's foreign key stops
# a fabricated owner uuid from being merely meaningless and starts rejecting it.
from tests.utils.tenancy import ANY_READER, any_reader_account  # noqa: F401
from tests.utils.tg_cleanup import (
    cleanup_channel_keys,
    purge_all_sync_lanes,
    truncate_all_tg_tables,
)
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

if config_module.settings.POSTGRES_DB != _test_db:
    msg = (
        f"Refusing to run pytest against POSTGRES_DB={config_module.settings.POSTGRES_DB!r}; "
        f"expected test database {_test_db!r}. Set TEST_POSTGRES_DB or POSTGRES_DB_TEST."
    )
    raise RuntimeError(msg)


@pytest.fixture(scope="session", autouse=True)
def _assert_test_database() -> Generator[None]:
    """Fail fast if pytest is pointed at the dev database."""
    yield


@pytest.fixture(scope="session", autouse=True)
def _apply_alembic_migrations() -> Generator[None]:
    """Ensure test database schema matches latest Alembic revision."""
    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
    yield


@pytest.fixture(scope="session", autouse=True)
def _isolate_image_caches(tmp_path_factory: pytest.TempPathFactory) -> Generator[None]:
    """Point the on-disk image caches at a scratch dir for the whole suite.

    `run_retention_cleanup` deletes from both of them — thumbs over the size cap,
    avatars no channel references. Tests that exercise it would otherwise sweep
    the developer's real `data/` caches, which is a slow, silent, and confusing
    way to lose a warm cache.
    """
    root = tmp_path_factory.mktemp("image-caches")
    config_module.settings.CHANNEL_PHOTO_DIR = str(root / "channel-photos")
    config_module.settings.POST_THUMB_DIR = str(root / "post-thumbs")
    yield


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session | None]:
    try:
        with Session(engine) as session:
            init_db(session)
            yield session
            statement = delete(Item)
            session.execute(statement)
            statement = delete(User)
            session.execute(statement)
            session.commit()
    except Exception:
        yield None


@pytest.fixture(autouse=True)
def _clean_tg_tables_after_test() -> Generator[None]:
    """Truncate TG tables after each test so suites cannot pollute each other.

    The sync lanes are purged too. PGMQ's tables live in the `pgmq` schema, so
    the truncate never touched them — which made queued messages the one piece
    of state that outlived a test, in the direction hardest to diagnose. See
    `purge_all_sync_lanes`.
    """
    yield
    truncate_all_tg_tables()
    purge_all_sync_lanes()


@pytest.fixture
def tg_test_channel() -> Generator:
    """Create a channel for the current test and delete it (and dependents) afterward.

    An omitted `user_id` means `ANY_READER`, not "nobody" — the same rule
    `tests/utils/setting_groups.py::add_test_channel` follows, and for the same
    reason. This fixture reaches `ensure_default_group`, and ticket 21 made
    `tg_channel_setting_groups.user_id` `NOT NULL` with a key to `"user"(id)`,
    so an unowned seed now fails at the group before it reaches the Channel.
    Fixing one of the two helpers and leaving the other is the half-fix this
    repo names; they are the same helper twice over.
    """
    created: list[str] = []

    def _create(
        channel_id: str,
        *,
        name: str | None = None,
        user_id=None,
        is_frozen: bool = False,
        **kwargs,
    ) -> str:
        if user_id is None:
            user_id = ANY_READER
        ch_name = name or channel_id
        with Session(engine) as session:
            group = session.get(ChannelSettingGroup, f"default-{user_id}")
            if group is None:
                from app.services.channel_setting_groups import ensure_default_group

                group = ensure_default_group(session, user_id=user_id)
                session.commit()
            # Ticket 22 split what this fixture writes in two. The Channel is
            # the shared corpus row and carries no owner and no per-User field;
            # the group, the tags and the start time go on the caller's follow,
            # which is where every read now looks for them. A fixture that wrote
            # only the Channel would seed a row the scheduler skips and the
            # channel list renders with empty tags.
            follow_values: dict[str, Any] = {
                k: v for k, v in kwargs.items() if k in FOLLOW_OWNED_FIELDS
            }
            channel_kwargs = {
                k: v
                for k, v in kwargs.items()
                if k in Channel.model_fields and k not in FOLLOW_OWNED_FIELDS
            }
            if kwargs.get("is_frozen"):
                from app.services.channel_setting_groups import (
                    get_or_create_restricted_group,
                )

                restricted = get_or_create_restricted_group(session, user_id=user_id)
                follow_values["setting_group_id"] = restricted.id
            else:
                follow_values.setdefault("setting_group_id", group.id)

            existing = session.get(Channel, channel_id)
            if existing:
                existing.name = ch_name
                for key, value in channel_kwargs.items():
                    setattr(existing, key, value)
                session.add(existing)
                channel = existing
            else:
                channel = Channel(id=channel_id, name=ch_name, **channel_kwargs)
                session.add(channel)
            session.flush()
            sync_follow_settings(
                session, channel, user_id=user_id, values=follow_values
            )
            session.commit()
        created.append(channel_id)
        if ch_name != channel_id:
            created.append(ch_name)
        return channel_id

    yield _create

    with Session(engine) as session:
        cleanup_channel_keys(session, created)


@pytest.fixture(scope="module")
def client() -> Generator[TestClient]:
    with TestClient(app) as c:
        yield c


@pytest.fixture
def sync_worker(client: TestClient) -> Generator[None]:
    """Stand in for the worker process (ticket 10).

    After ticket 10 the API process enqueues and rings; it never drains a lane
    itself, and `tests/deployment/test_worker_count.py` asserts that. So a test
    that posts to `/jobs/sync` and waits for the sync to happen needs something
    to be the worker, or it waits forever — which is exactly what the SSE test
    did when the split landed.

    The consumer is started **inside the app's own event loop**, through the
    TestClient's portal, rather than in a thread of the test's own. The job
    objects carry `asyncio.Event`s and `asyncio.Condition`s created in that
    loop, and driving them from a second loop does not raise — it just never
    wakes anything, which is a hang with no traceback.

    Reached only through the queue and the `NOTIFY`, so this fixture exercises
    the real path rather than short-circuiting it.
    """
    from app.core import pg_notify
    from app.jobs import sync_queue

    async def _start() -> None:
        sync_queue.start_lane_consumer()
        # Wait for the `LISTEN` to actually be established, not just for the
        # task to exist. A ring published into that gap is simply lost —
        # `NOTIFY` has no replay — and in production the worker's
        # `SYNC_QUEUE_POLL_INTERVAL_SECONDS` sweep is what covers it. There is
        # no sweep here, so without this the *first* test in a module enqueues
        # into silence and then times out, while every later test passes
        # because the connection is up by then. That is exactly what happened.
        assert await pg_notify.listener(
            sync_queue.SYNC_LANE_WAKE_CHANNEL
        ).wait_until_listening(), "the stand-in worker never started listening"

    async def _stop() -> None:
        sync_queue.stop_lane_consumer()

    client.portal.call(_start)
    try:
        yield
    finally:
        client.portal.call(_stop)


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
