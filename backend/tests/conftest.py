"""Pytest configuration — always uses the isolated test database (app_test)."""

from __future__ import annotations

import os
from collections.abc import Generator
from pathlib import Path

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
from tests.utils.tg_cleanup import cleanup_channel_keys, truncate_all_tg_tables
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

if config_module.settings.POSTGRES_DB != _test_db:
    msg = (
        f"Refusing to run pytest against POSTGRES_DB={config_module.settings.POSTGRES_DB!r}; "
        f"expected test database {_test_db!r}. Set TEST_POSTGRES_DB or POSTGRES_DB_TEST."
    )
    raise RuntimeError(msg)


@pytest.fixture(scope="session", autouse=True)
def _assert_test_database() -> Generator[None, None, None]:
    """Fail fast if pytest is pointed at the dev database."""
    yield


@pytest.fixture(scope="session", autouse=True)
def _apply_alembic_migrations() -> Generator[None, None, None]:
    """Ensure test database schema matches latest Alembic revision."""
    from alembic import command
    from alembic.config import Config

    alembic_cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
    yield


@pytest.fixture(scope="session", autouse=True)
def db() -> Generator[Session | None, None, None]:
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
def _clean_tg_tables_after_test() -> Generator[None, None, None]:
    """Truncate TG tables after each test so suites cannot pollute each other."""
    yield
    truncate_all_tg_tables()


@pytest.fixture
def tg_test_channel() -> Generator:
    """Create a channel for the current test and delete it (and dependents) afterward."""
    created: list[str] = []

    def _create(
        channel_id: str,
        *,
        name: str | None = None,
        user_id=None,
        is_frozen: bool = False,
        **kwargs,
    ) -> str:
        ch_name = name or channel_id
        with Session(engine) as session:
            group = session.get(
                ChannelSettingGroup, f"default-{user_id if user_id else 'global'}"
            )
            if group is None:
                from app.services.channel_setting_groups import ensure_default_group

                group = ensure_default_group(session, user_id=user_id)
                session.commit()
            existing = session.get(Channel, channel_id)
            if existing:
                existing.name = ch_name
                existing.user_id = user_id
                if existing.setting_group_id != group.id and not kwargs.get(
                    "is_frozen", False
                ):
                    existing.setting_group_id = group.id
                for key, value in kwargs.items():
                    if key in Channel.model_fields and key != "setting_group_id":
                        setattr(existing, key, value)
                session.add(existing)
            else:
                channel_kwargs = {
                    k: v
                    for k, v in kwargs.items()
                    if k in Channel.model_fields and k != "setting_group_id"
                }
                if kwargs.get("is_frozen"):
                    from app.services.channel_setting_groups import (
                        get_or_create_restricted_group,
                    )

                    restricted = get_or_create_restricted_group(
                        session, user_id=user_id
                    )
                    group_id = restricted.id
                else:
                    group_id = group.id
                session.add(
                    Channel(
                        id=channel_id,
                        name=ch_name,
                        user_id=user_id,
                        setting_group_id=group_id,
                        **channel_kwargs,
                    )
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
def client() -> Generator[TestClient, None, None]:
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
