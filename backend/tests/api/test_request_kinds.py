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
import time
import types
import uuid
from collections.abc import Iterator
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
from app.models_rbac import UserRole
from app.models_tg import RequestRecordRow
from app.services import network
from app.services.request_stats import flush_recorded_requests
from app.services.scraper_jobs import clear_jobs_for_tests
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


class FakeTelegram:
    """`_fetch_once`: an empty page for every URL, and a record of each call."""

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def __call__(self, url: str, **_kwargs: Any) -> Any:
        self.calls.append(url)
        return "<html><body></body></html>"


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
    return fake


@pytest.fixture(autouse=True)
def _switches_back_on(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> Iterator[None]:
    clear_jobs_for_tests()
    flush_recorded_requests()
    yield
    clear_jobs_for_tests()
    for kind in SWITCHABLE:
        client.put(
            _setting(kind), json={"reset": True}, headers=superuser_token_headers
        )


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
