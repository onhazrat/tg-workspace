"""SUMTAB-09: a Summary's Publication, planned and sent by the server.

`POST /data/summaries/{id}/publication/plan` returns the Parts the server would
send and the generated default metadata; `POST .../publication` plans the same
way and sends exactly those Parts. Driven through the API with the outbound
Telegram call faked at `app.services.publish.fetch_with_retry`, so what is
asserted is what the panel previews and what Telegram would receive.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models_tg import Summary
from app.services import publish as publish_service

DATA = f"{settings.API_V1_STR}/data"

#: 2026-10-07 05:57 to 08:57 UTC, which is 9:27 to 12:27 in Tehran.
SCOPE = {
    "start": 1_791_352_620_000,
    "end": 1_791_363_420_000,
    "channels": ["news_ir", "tech"],
}


class _FakeTelegram:
    def __init__(self) -> None:
        self.bodies: list[dict[str, Any]] = []

    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, Any]:
        self.bodies.append(kwargs["json_body"])
        return {"ok": True, "result": {"message_id": len(self.bodies)}}, {}

    @property
    def texts(self) -> list[str]:
        return [b["text"] for b in self.bodies]


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> _FakeTelegram:
    fake = _FakeTelegram()
    monkeypatch.setattr(publish_service, "fetch_with_retry", fake)
    return fake


def _superuser_id() -> uuid.UUID:
    with Session(engine) as session:
        user = crud.get_user_by_email(session=session, email=settings.FIRST_SUPERUSER)
        assert user is not None
        return user.id


def _summary(
    text: str = "body",
    *,
    owner: uuid.UUID | None = None,
    extra: dict[str, Any] | None = None,
) -> str:
    row_id = f"pub-{uuid.uuid4()}"
    with Session(engine) as session:
        session.add(
            Summary(
                id=row_id,
                user_id=owner or _superuser_id(),
                text=text,
                scope=SCOPE,
                language="en",
                model="test-model",
                post_count=42,
                timestamp=0,
                extra=extra or {},
            )
        )
        session.commit()
    return row_id


def _plan(
    client: TestClient,
    headers: dict[str, str],
    summary_id: str,
    **options: Any,
) -> Any:
    r = client.post(
        f"{DATA}/summaries/{summary_id}/publication/plan", json=options, headers=headers
    )
    assert r.status_code == 200, r.text
    return r.json()


GENERATED = (
    "📊 *Analysis Metadata*\n"
    "🕒 *Time Range:* Oct 7, 2026, 9:27 AM – 12:27 PM (Asia/Tehran, GMT+3:30) · 3h\n"
    "📡 *Channels Used:* 2\n"
    "📋 *Channel List:* @news_ir, @tech\n"
    "🤖 *AI Model:* test-model\n"
    "📝 *Posts Analyzed:* 42"
)


def test_the_plan_names_the_window_in_the_accounts_time_zone(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The carry-over from SUMTAB-08: the default metadata the editor gets."""
    r = client.put(
        f"{DATA}/settings/publishing",
        json={"timeZone": "Asia/Tehran"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text

    plan = _plan(client, superuser_token_headers, _summary())

    assert plan["defaultMetadata"] == GENERATED
