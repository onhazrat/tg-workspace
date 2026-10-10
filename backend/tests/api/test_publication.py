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
from sqlmodel import Session, col, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models_tg import PublishLog, Summary
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


def test_a_plan_is_the_summary_alone_unless_metadata_is_asked_for(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    plan = _plan(client, superuser_token_headers, _summary("**Rates** rose."))

    assert plan["parts"] == [
        {
            "kind": "summary",
            "text": "**Rates** rose.",
            "length": len("Rates rose."),
            "cutInside": False,
        }
    ]
    assert plan["limit"] == 4096


def test_the_metadata_is_its_own_part_and_the_saved_text_wins(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    summary_id = _summary("Body.", extra={"metadataText": "My own words"})

    plan = _plan(client, superuser_token_headers, summary_id, includeMetadata=True)

    assert [(p["kind"], p["text"]) for p in plan["parts"]] == [
        ("metadata", "My own words"),
        ("summary", "Body."),
    ]


def test_the_metadata_rides_in_the_first_part_when_it_fits(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    # 4,080 characters: fits a Part alone, not beside the metadata.
    paragraph = " ".join(["word"] * 816) + "."
    summary_id = _summary(
        f"Short.\n\n{paragraph}", extra={"metadataText": "My own words"}
    )

    plan = _plan(
        client,
        superuser_token_headers,
        summary_id,
        includeMetadata=True,
        metadataInFirstPart=True,
    )

    assert [(p["kind"], p["text"]) for p in plan["parts"]] == [
        ("both", "My own words\n\nShort."),
        ("summary", paragraph),
    ]


# --------------------------------------------------------------------------
# Sending
# --------------------------------------------------------------------------


@pytest.fixture
def target(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> dict[str, str]:
    """A bot and a destination of the superuser's; both rows are `tg_*`."""
    r = client.put(
        f"{DATA}/bot-credentials/pub-bot",
        json={"name": "Pub Bot", "token": "999:PUBTOKEN"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    r = client.put(
        f"{DATA}/chat-destinations/pub-dest",
        json={"name": "News Desk", "chatId": "-100777"},
        headers=superuser_token_headers,
    )
    assert r.status_code == 200, r.text
    return {"botId": "pub-bot", "destinationId": "pub-dest"}


def _send(
    client: TestClient,
    headers: dict[str, str],
    summary_id: str,
    body: dict[str, Any],
) -> Any:
    return client.post(
        f"{DATA}/summaries/{summary_id}/publication", json=body, headers=headers
    )


def _logs(summary_id: str) -> list[PublishLog]:
    with Session(engine) as session:
        return list(
            session.exec(
                select(PublishLog).where(col(PublishLog.summary_id) == summary_id)
            )
        )


def test_a_send_delivers_the_planned_parts_in_order_and_logs_once(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    telegram: _FakeTelegram,
) -> None:
    paragraph = " ".join(["word"] * 600) + "."
    summary_id = _summary(
        f"{paragraph}\n\n{paragraph}", extra={"metadataText": "*Meta:* here"}
    )
    options = {"includeMetadata": True}
    planned = [
        p["text"]
        for p in _plan(client, superuser_token_headers, summary_id, **options)["parts"]
    ]

    r = _send(client, superuser_token_headers, summary_id, {**target, **options})

    assert r.status_code == 200, r.text
    assert r.json() == {
        "status": "success",
        "error": None,
        "partsSent": 3,
        "partsTotal": 3,
    }
    assert telegram.texts == ["Meta: here", paragraph, paragraph]
    assert {b["chat_id"] for b in telegram.bodies} == {"-100777"}
    [log] = _logs(summary_id)
    assert log.status == "success"
    assert log.chat_name == "News Desk"
    assert log.bot_name == "Pub Bot"
    assert log.full_request == {"parts": planned}


def test_a_part_telegram_refuses_stops_the_send_and_is_logged_failed(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sent: list[str] = []

    async def refuse_second(url: str, **kwargs: Any) -> tuple[Any, Any]:
        if sent:
            raise RuntimeError("Bad Request: chat not found")
        sent.append(kwargs["json_body"]["text"])
        return {"ok": True}, {}

    monkeypatch.setattr(publish_service, "fetch_with_retry", refuse_second)
    paragraph = " ".join(["word"] * 600) + "."
    summary_id = _summary("\n\n".join([paragraph] * 3))

    r = _send(client, superuser_token_headers, summary_id, target)

    assert r.status_code == 200, r.text
    assert r.json() == {
        "status": "failed",
        "error": "Bad Request: chat not found",
        "partsSent": 1,
        "partsTotal": 3,
    }
    [log] = _logs(summary_id)
    assert log.status == "failed"
    assert log.error == "Bad Request: chat not found"
    assert log.full_request == {"parts": [paragraph] * 3}


# --------------------------------------------------------------------------
# Refusals: someone else's Summary, bot or destination answers as absent
# --------------------------------------------------------------------------


@pytest.fixture
def decrypts(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    calls: list[str] = []
    monkeypatch.setattr(publish_service, "decrypt_token", calls.append)
    return calls


def _normal_user_id() -> uuid.UUID:
    with Session(engine) as session:
        user = crud.get_user_by_email(session=session, email=settings.EMAIL_TEST_USER)
        assert user is not None
        return user.id


def test_someone_elses_summary_is_not_found_for_plan_or_send(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    target: dict[str, str],
    telegram: _FakeTelegram,
) -> None:
    theirs = _summary()

    plan = client.post(
        f"{DATA}/summaries/{theirs}/publication/plan",
        json={},
        headers=normal_user_token_headers,
    )
    send = _send(client, normal_user_token_headers, theirs, target)

    for r in (plan, send):
        assert r.status_code == 404, r.text
        assert r.json()["detail"] == "Summary not found"
    assert telegram.bodies == []
    assert _logs(theirs) == []


def test_someone_elses_bot_is_refused_as_absent_before_any_decrypt(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    target: dict[str, str],
    decrypts: list[str],
) -> None:
    mine = _summary(owner=_normal_user_id())
    r = client.put(
        f"{DATA}/chat-destinations/normal-dest",
        json={"name": "Mine", "chatId": "-1"},
        headers=normal_user_token_headers,
    )
    assert r.status_code == 200, r.text

    r = _send(
        client,
        normal_user_token_headers,
        mine,
        {"botId": target["botId"], "destinationId": "normal-dest"},
    )

    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Bot credential not found"
    assert decrypts == []
    assert _logs(mine) == []


def test_someone_elses_destination_is_refused_as_absent_before_any_decrypt(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    target: dict[str, str],
    decrypts: list[str],
) -> None:
    mine = _summary(owner=_normal_user_id())

    r = _send(client, normal_user_token_headers, mine, target)

    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Chat destination not found"
    assert decrypts == []
    assert _logs(mine) == []
