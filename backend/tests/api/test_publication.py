"""SUMTAB-09: a Summary's Publication, planned and sent by the server.

`POST /data/summaries/{id}/publication/plan` returns the Parts the server would
send and the generated default metadata; `POST .../publication` plans the same
way and sends exactly those Parts. Driven through the API with the outbound
Telegram call faked at `app.services.publish.fetch_with_retry`, so what is
asserted is what the panel previews and what Telegram would receive.
"""

from __future__ import annotations

import asyncio
import uuid
from typing import Any, cast

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import text as sql
from sqlmodel import Session, col, select

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.models_tg import PublishLog, Summary
from app.services import publish as publish_service
from app.services.publications import resume_publication

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
    assert log.full_request == {"parts": planned, "partsSent": 3}


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
    assert log.full_request == {"parts": [paragraph] * 3, "partsSent": 1}


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


# --------------------------------------------------------------------------
# Send metadata is off for every Summary, existing ones included
# --------------------------------------------------------------------------


def test_the_migration_turns_send_metadata_off_for_existing_summaries() -> None:
    """Every browser-made Summary stored `sendMetadata: true` without anyone
    asking, so an existing flag says nothing about a choice and is cleared."""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    from app.alembic.versions import (
        e9a4c1b7d302_send_metadata_off_by_default_sumtab_09 as mig,
    )

    on = _summary(extra={"sendMetadata": True, "metadataText": "kept"})
    off = _summary(extra={"sendMetadata": False})

    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            mig.upgrade()

    with Session(engine) as session:
        on_row, off_row = session.get(Summary, on), session.get(Summary, off)
        assert on_row is not None and off_row is not None
        assert on_row.extra == {"metadataText": "kept"}
        assert off_row.extra == {"sendMetadata": False}


# --------------------------------------------------------------------------
# Partial Publications (SUMTAB-10)
# --------------------------------------------------------------------------


class _FlakyTelegram(_FakeTelegram):
    """Refuses the `fail_at`-th request (1-based), then takes the rest."""

    def __init__(self, fail_at: int) -> None:
        super().__init__()
        self.fail_at = fail_at
        self.calls = 0

    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, Any]:
        self.calls += 1
        if self.calls == self.fail_at:
            raise RuntimeError("Too Many Requests: retry after 30")
        return await super().__call__(url, **kwargs)


def _five_paragraphs() -> list[str]:
    # Each about 3,000 characters, so no two share a Part.
    return [f"P{i} " + " ".join(["word"] * 600) + "." for i in range(1, 6)]


@pytest.fixture
def partial(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> tuple[str, _FlakyTelegram]:
    """A Summary of five Parts whose Publication stopped at Part 3."""
    flaky = _FlakyTelegram(fail_at=3)
    monkeypatch.setattr(publish_service, "fetch_with_retry", flaky)
    summary_id = _summary("\n\n".join(_five_paragraphs()))
    r = _send(client, superuser_token_headers, summary_id, target)
    assert r.status_code == 200, r.text
    assert r.json()["partsSent"] == 2
    return summary_id, flaky


def test_a_failure_at_part_3_of_5_is_recorded_as_partial(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
) -> None:
    summary_id, flaky = partial

    assert [t.split(" ", 1)[0] for t in flaky.texts] == ["P1", "P2"]
    [log] = _logs(summary_id)
    assert log.status == "failed"
    assert log.error == "Too Many Requests: retry after 30"
    assert log.full_request == {"parts": _five_paragraphs(), "partsSent": 2}
    plan = _plan(client, superuser_token_headers, summary_id)
    assert plan["partial"] == {"id": log.id, "partsSent": 2, "partsTotal": 5}


def test_a_summary_with_no_partial_publication_offers_none(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    telegram: _FakeTelegram,
) -> None:
    summary_id = _summary("Body.")
    assert _plan(client, superuser_token_headers, summary_id)["partial"] is None

    _send(client, superuser_token_headers, summary_id, target)

    assert _plan(client, superuser_token_headers, summary_id)["partial"] is None


def test_resuming_sends_exactly_the_remaining_stored_parts_and_updates_the_row(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
) -> None:
    summary_id, flaky = partial
    paragraphs = _five_paragraphs()
    [log] = _logs(summary_id)
    # Edited since: a resume sends what was planned, never re-planned text.
    with Session(engine) as session:
        row = session.get(Summary, summary_id)
        assert row is not None
        row.text = "Rewritten."
        session.add(row)
        session.commit()

    r = _send(client, superuser_token_headers, summary_id, {"publicationId": log.id})

    assert r.status_code == 200, r.text
    assert r.json() == {
        "status": "success",
        "error": None,
        "partsSent": 5,
        "partsTotal": 5,
    }
    assert flaky.texts == paragraphs
    assert {b["chat_id"] for b in flaky.bodies} == {"-100777"}
    [after] = _logs(summary_id)
    assert after.id == log.id
    assert after.status == "success"
    assert after.error is None
    assert after.full_request == {"parts": paragraphs, "partsSent": 5}
    assert _plan(client, superuser_token_headers, summary_id)["partial"] is None


def test_a_resume_that_fails_again_keeps_counting_from_where_it_stopped(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
) -> None:
    summary_id, flaky = partial
    flaky.fail_at = flaky.calls + 2  # Part 4 is refused this time.
    [log] = _logs(summary_id)

    r = _send(client, superuser_token_headers, summary_id, {"publicationId": log.id})

    assert r.json()["status"] == "failed"
    assert r.json()["partsSent"] == 3
    plan = _plan(client, superuser_token_headers, summary_id)
    assert plan["partial"] == {"id": log.id, "partsSent": 3, "partsTotal": 5}


def test_a_finished_publication_is_not_resumed(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    telegram: _FakeTelegram,
) -> None:
    summary_id = _summary("Body.")
    _send(client, superuser_token_headers, summary_id, target)
    [log] = _logs(summary_id)

    r = _send(client, superuser_token_headers, summary_id, {"publicationId": log.id})

    assert r.status_code == 409, r.text
    assert len(telegram.bodies) == 1


def test_someone_elses_publication_answers_as_absent_before_any_decrypt(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    normal_user_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
    decrypts: list[str],
) -> None:
    theirs, flaky = partial
    [log] = _logs(theirs)
    sent_before = len(flaky.bodies)
    mine = _summary(owner=_normal_user_id())

    through_theirs = _send(
        client, normal_user_token_headers, theirs, {"publicationId": log.id}
    )
    through_mine = _send(
        client, normal_user_token_headers, mine, {"publicationId": log.id}
    )
    absent = _send(client, normal_user_token_headers, mine, {"publicationId": "nope"})

    assert through_theirs.status_code == 404
    assert through_theirs.json()["detail"] == "Summary not found"
    for r in (through_mine, absent):
        assert r.status_code == 404, r.text
        assert r.json()["detail"] == "Publication not found"
    assert len(flaky.bodies) == sent_before
    assert decrypts == []
    [after] = _logs(theirs)
    assert after.full_request == log.full_request


def test_a_publication_someone_else_filed_against_my_summary_is_not_resumed(
    client: TestClient,
    normal_user_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
    decrypts: list[str],
) -> None:
    """The log door takes any `summary_id`, so the row's owner is checked too."""
    theirs, flaky = partial
    [log] = _logs(theirs)
    mine = _summary(owner=_normal_user_id())
    with Session(engine) as session:
        row = session.get(PublishLog, log.id)
        assert row is not None
        row.summary_id = mine
        session.add(row)
        session.commit()
    sent_before = len(flaky.bodies)

    r = _send(client, normal_user_token_headers, mine, {"publicationId": log.id})

    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Publication not found"
    assert len(flaky.bodies) == sent_before
    assert decrypts == []


def test_two_resumes_at_once_send_each_remaining_part_once(
    partial: tuple[str, _FlakyTelegram],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A double-click, or two tabs: the row is claimed before anything goes
    out, so the second resume is refused rather than sending Parts 3-5 again.

    The second session read the row before the first claimed it, which is the
    race a check-then-send loses and a conditional claim does not.
    """
    summary_id, flaky = partial
    [log] = _logs(summary_id)

    async def yielding(url: str, **kwargs: Any) -> tuple[Any, Any]:
        await asyncio.sleep(0)  # Telegram takes a while; the other one runs.
        return await flaky(url, **kwargs)

    monkeypatch.setattr(publish_service, "fetch_with_retry", yielding)

    async def both() -> list[Any]:
        with Session(engine) as first, Session(engine) as second:
            stale = second.get(PublishLog, log.id)
            assert stale is not None
            return await asyncio.gather(
                *(
                    resume_publication(
                        s,
                        cast(Summary, s.get(Summary, summary_id)),
                        user_id=_superuser_id(),
                        publication_id=log.id,
                    )
                    for s in (first, second)
                ),
                return_exceptions=True,
            )

    outcomes = asyncio.run(both())

    assert [t.split(" ", 1)[0] for t in flaky.texts] == ["P1", "P2", "P3", "P4", "P5"]
    done, refused = outcomes
    assert getattr(done, "status", None) == "success", outcomes
    assert isinstance(refused, HTTPException) and refused.status_code == 409
    [after] = _logs(summary_id)
    assert after.status == "success"
    assert after.full_request == {"parts": _five_paragraphs(), "partsSent": 5}


def test_a_publication_is_resumed_only_through_its_own_summary(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    partial: tuple[str, _FlakyTelegram],
) -> None:
    summary_id, _ = partial
    [log] = _logs(summary_id)

    r = _send(client, superuser_token_headers, _summary(), {"publicationId": log.id})

    assert r.status_code == 404, r.text
    assert r.json()["detail"] == "Publication not found"


def test_a_new_publication_still_names_its_bot_and_destination(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    r = _send(client, superuser_token_headers, _summary(), {"botId": "pub-bot"})

    assert r.status_code == 422, r.text


# --------------------------------------------------------------------------
# No transaction held across the send (CLAUDE.md, "Cost and performance")
# --------------------------------------------------------------------------


def _open_transactions() -> int:
    """Backends of this database sitting `idle in transaction`, bar this one."""
    with engine.connect() as connection:
        return int(
            connection.execute(
                sql(
                    "SELECT count(*) FROM pg_stat_activity"
                    " WHERE datname = current_database()"
                    " AND state LIKE 'idle in transaction%'"
                    " AND pid <> pg_backend_pid()"
                )
            ).scalar_one()
        )


class _WatchingTelegram(_FlakyTelegram):
    """Notes, at every request, how many transactions were left open."""

    def __init__(self, fail_at: int = 0) -> None:
        super().__init__(fail_at)
        self.open_during_send: list[int] = []

    async def __call__(self, url: str, **kwargs: Any) -> tuple[Any, Any]:
        self.open_during_send.append(_open_transactions())
        return await super().__call__(url, **kwargs)


def test_no_transaction_is_open_while_a_part_goes_out(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    target: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A send waits on Telegram for seconds, retries included; a transaction
    held across it pins the xmin horizon, so it is closed first, for the new
    Publication and the resume alike."""
    watching = _WatchingTelegram(fail_at=2)
    monkeypatch.setattr(publish_service, "fetch_with_retry", watching)
    summary_id = _summary("\n\n".join(_five_paragraphs()[:3]))
    # Whatever an earlier test's fixtures left open, which is not this send's.
    before = _open_transactions()

    _send(client, superuser_token_headers, summary_id, target)
    [log] = _logs(summary_id)
    resumed = _send(
        client, superuser_token_headers, summary_id, {"publicationId": log.id}
    )

    assert resumed.json()["status"] == "success", resumed.text
    assert watching.open_during_send == [before] * 4
