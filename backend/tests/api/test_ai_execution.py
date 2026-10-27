"""AI HTTP operations release real preparation reads before Provider work."""

import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from sqlmodel import Session, select

from app.ai import registry
from app.ai.models import ChatRequest, EmbeddingResult, ModelInfo, TagRequest
from app.ai.providers.gemini import GeminiProvider
from app.api.deps import get_db
from app.core.config import settings
from app.core.db import engine
from app.core.secrets import encrypt_token
from app.main import app
from app.models import User
from app.models_tg import AICredential
from app.services import ai_execution
from app.services.ai_keys import AI_KEY_REJECTED_DETAIL
from tests.utils.user import authentication_token_from_email
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR
SECRET = "aex-account-secret"


@pytest.fixture
def account(client: TestClient) -> dict[str, str]:
    headers = get_superuser_token_headers(client)
    with Session(engine) as session:
        user = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).one()
        session.add(
            AICredential(
                id="aex-key",
                user_id=user.id,
                label="AEX",
                provider="gemini",
                key_encrypted=encrypt_token(SECRET),
                last_validated=123,
            )
        )
        session.commit()
    registry.forget_cached_models("aex-key|")
    return headers


@pytest.fixture
def preparation() -> Iterator[tuple[Session, list[str]]]:
    with Session(engine) as session:
        events: list[str] = []
        event.listen(session, "after_begin", lambda *_: events.append("begin"))
        event.listen(session, "after_transaction_end", lambda *_: events.append("end"))

        def request_session() -> Iterator[Session]:
            yield session

        app.dependency_overrides[get_db] = request_session
        try:
            yield session, events
        finally:
            app.dependency_overrides.pop(get_db, None)


def _body(
    client: TestClient, headers: dict[str, str], operation: str
) -> dict[str, Any]:
    if operation in {"chat/stream", "tag/stream"}:
        family, field = (
            ("chat-sessions", "chatId")
            if operation == "chat/stream"
            else ("tag-runs", "tagRunId")
        )
        artifact_id = str(uuid.uuid4())
        response = client.post(
            f"{PREFIX}/data/{family}",
            headers=headers,
            json={
                "id": artifact_id,
                "scope": {
                    "channels": [],
                    "window": {"mode": "fixed", "start": 0, "end": 60000},
                },
            },
        )
        assert response.status_code == 200, response.text
        return {
            field: artifact_id,
            **({"message": "question"} if field == "chatId" else {}),
        }
    return {
        "models": {"aiKeyId": "aex-key"},
        "embeddings": {"texts": ["hello"]},
        "translate": {
            "posts": [{"id": "one", "text": "hello"}],
            "targetLanguage": "Persian",
        },
    }[operation]


@pytest.mark.parametrize(
    "operation", ["models", "chat/stream", "tag/stream", "embeddings", "translate"]
)
@pytest.mark.parametrize("model", [None, "chosen-model"])
def test_preparation_ends_before_provider_work(
    client: TestClient,
    account: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    request: pytest.FixtureRequest,
    operation: str,
    model: str | None,
) -> None:
    body = _body(client, account, operation)
    if operation != "models" and model:
        body["model"] = model
    session, events = request.getfixturevalue("preparation")
    observed: list[tuple[list[str], bool]] = []
    models_used: list[str] = []
    keys: list[str] = []
    original = registry.get_provider

    def provider(**kwargs: Any) -> Any:
        keys.append(kwargs["api_key"])
        return original(**kwargs)

    def observe(model: str | None = None) -> None:
        observed.append((events.copy(), session.in_transaction()))
        if model:
            models_used.append(model)

    async def models(_self: Any) -> list[ModelInfo]:
        observe()
        return [ModelInfo(id="offered", label="Offered", provider="gemini")]

    async def stream(_self: Any, _prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        observe(kwargs["model"])
        yield "one"
        observe()
        yield "two"

    async def embed(_self: Any, texts: list[str], *, model: str) -> EmbeddingResult:
        observe(model)
        assert texts == ["hello"]
        return EmbeddingResult(
            vectors=[[0.5]], model=model, provider="gemini", dimensions=1
        )

    async def translate(
        _self: Any, posts: list[dict[str, str]], **kwargs: Any
    ) -> list[dict[str, str]]:
        observe(kwargs["model"])
        assert posts == [{"id": "one", "text": "hello"}]
        assert kwargs["target_language"] == "Persian"
        return [{"one": "translated"}]

    monkeypatch.setattr(settings, "GEMINI_API_KEY", "operator-key")
    monkeypatch.setattr(registry, "get_provider", provider)
    monkeypatch.setattr(ai_execution, "get_provider", provider)
    monkeypatch.setattr(GeminiProvider, "list_models", models)
    monkeypatch.setattr(GeminiProvider, "stream", stream)
    monkeypatch.setattr(GeminiProvider, "embed", embed)
    monkeypatch.setattr(GeminiProvider, "translate_batch", translate)
    response = client.post(f"{PREFIX}/ai/{operation}", headers=account, json=body)
    assert observed and all(value == (["begin", "end"], False) for value in observed)
    assert response.status_code == 200, response.text
    assert keys == [
        "operator-key" if operation in {"embeddings", "translate"} else SECRET
    ]
    if operation == "models":
        assert response.json()["default"] == "offered"
        # A cache hit still releases authentication, and never builds a Provider.
        events.clear()
        cached = client.post(f"{PREFIX}/ai/models", headers=account, json=body)
        assert cached.json() == response.json()
        assert keys == [SECRET]
        assert events == ["begin", "end"]
    else:
        default = (
            settings.EMBEDDING_MODEL
            if operation == "embeddings"
            else settings.DEFAULT_AI_MODEL
        )
        assert models_used == [model or default]
        if operation.endswith("stream"):
            assert response.text.splitlines()[::2] == [
                'data: {"missingPosts": 0}',
                'data: {"text": "one"}',
                'data: {"text": "two"}',
                "data: [DONE]",
            ]
        elif operation == "embeddings":
            assert response.json()["vectors"] == [[0.5]]
        else:
            assert response.json() == {"translations": [{"one": "translated"}]}


@pytest.mark.parametrize("operation", ["chat/stream", "tag/stream"])
@pytest.mark.parametrize("foreign", [False, True])
def test_artifact_refusal_precedes_stream_headers_and_releases_preparation(
    client: TestClient,
    account: dict[str, str],
    request: pytest.FixtureRequest,
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    foreign: bool,
) -> None:
    body = _body(client, account, operation)
    headers = account
    if foreign:
        with Session(engine) as session:
            headers = authentication_token_from_email(
                client=client, email="aex-other@example.com", db=session
            )
    else:
        body["chatId" if operation == "chat/stream" else "tagRunId"] = "absent"
    session, events = request.getfixturevalue("preparation")
    monkeypatch.setattr(
        ai_execution,
        "get_provider",
        lambda **_: pytest.fail("Provider constructed on refusal"),
    )
    response = client.post(f"{PREFIX}/ai/{operation}", headers=headers, json=body)
    assert response.status_code == 404
    assert response.headers["content-type"] == "application/json"
    assert response.json()["detail"] == (
        "Chat session not found" if operation == "chat/stream" else "Tag run not found"
    )
    assert events == ["begin", "end"]
    assert not session.in_transaction()


class Rejected(Exception):
    code = 401
    message = SECRET


@pytest.mark.parametrize("operation", ["models", "chat/stream", "tag/stream"])
@pytest.mark.parametrize("write", ["success", "deleted", "failed"])
def test_rejection_survives_validation_recording(
    client: TestClient,
    account: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    operation: str,
    write: str,
) -> None:
    body = _body(client, account, operation)
    writes: list[Session] = []
    events: list[str] = []

    def failed_write(session: Session, key_id: str, *, valid: bool) -> None:
        writes.append(session)
        event.listen(session, "after_begin", lambda *_: events.append("begin"))
        event.listen(session, "after_transaction_end", lambda *_: events.append("end"))
        assert session.get(AICredential, key_id) is not None
        assert not valid
        try:
            # A real PostgreSQL error leaves the transaction aborted until cleanup.
            session.execute(text("SELECT 1 / 0"))
        except Exception as exc:
            raise RuntimeError(SECRET) from exc

    def reject() -> None:
        if write == "deleted":
            with Session(engine) as session:
                row = session.get(AICredential, "aex-key")
                assert row is not None
                session.delete(row)
                session.commit()
        raise Rejected(SECRET) from ValueError(SECRET)

    async def models(_self: Any) -> list[ModelInfo]:
        reject()
        return []

    async def stream(_self: Any, *_: Any, **__: Any) -> AsyncIterator[str]:
        yield "partial"
        reject()

    monkeypatch.setattr(GeminiProvider, "list_models", models)
    monkeypatch.setattr(GeminiProvider, "stream", stream)
    if write == "failed":
        monkeypatch.setattr(ai_execution, "record_validation", failed_write)
    response = client.post(f"{PREFIX}/ai/{operation}", headers=account, json=body)
    if operation == "models":
        assert response.status_code == 502
        assert response.json() == {"detail": AI_KEY_REJECTED_DETAIL}
    else:
        assert response.status_code == 200
        frames = [
            json.loads(f.removeprefix("data: "))
            for f in response.text.split("\n\n")
            if f
        ]
        assert frames == [
            {"missingPosts": 0},
            {"text": "partial"},
            {"error": AI_KEY_REJECTED_DETAIL},
        ]
    assert SECRET not in response.text + caplog.text
    with Session(engine) as session:
        row = session.get(AICredential, "aex-key")
        if write == "deleted":
            assert row is None
        else:
            assert row is not None
            assert row.last_validated == (123 if write == "failed" else None)
    if write == "failed":
        assert events == ["begin", "end"]
        assert writes and not writes[0].in_transaction()
        diagnostic = [
            r
            for r in caplog.records
            if "Could not record rejected AI key" in r.getMessage()
        ]
        assert len(diagnostic) == 1 and diagnostic[0].exc_info is None


@pytest.mark.parametrize("operation", ["chat/stream", "tag/stream"])
def test_suspended_stream_releases_preparation_and_propagates_cancellation(
    client: TestClient,
    account: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    body = _body(client, account, operation)
    entered = asyncio.Event()
    cancelled: list[bool] = []

    async def stream(_self: Any, *_: Any, **__: Any) -> AsyncIterator[str]:
        entered.set()
        try:
            await asyncio.Event().wait()
            yield "unreachable"
        except asyncio.CancelledError:
            cancelled.append(True)
            raise

    monkeypatch.setattr(GeminiProvider, "stream", stream)

    async def run() -> None:
        with Session(engine) as session:
            events: list[str] = []
            event.listen(session, "after_begin", lambda *_: events.append("begin"))
            event.listen(
                session, "after_transaction_end", lambda *_: events.append("end")
            )
            user = session.exec(
                select(User).where(User.email == settings.FIRST_SUPERUSER)
            ).one()
            if operation == "chat/stream":
                frames = ai_execution.chat_stream(
                    ChatRequest.model_validate(body), session, user_id=user.id
                )
            else:
                frames = ai_execution.tag_stream(
                    TagRequest.model_validate(body), session, user_id=user.id
                )
            assert events == ["begin", "end"]
            assert await anext(frames) == 'data: {"missingPosts": 0}\n\n'
            waiting = asyncio.create_task(anext(frames))
            await asyncio.wait_for(entered.wait(), timeout=2)
            assert not session.in_transaction()
            assert events == ["begin", "end"]
            waiting.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiting
            assert cancelled == [True]
            with pytest.raises(StopAsyncIteration):
                await anext(frames)

    asyncio.run(run())


@pytest.mark.parametrize("operation", ["embeddings", "translate"])
def test_operator_rejection_does_not_clear_an_account_key(
    client: TestClient,
    account: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    body = _body(client, account, operation)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "operator-key")

    async def rejected(_self: Any, *_: Any, **__: Any) -> Any:
        raise Rejected("operator rejected")

    monkeypatch.setattr(GeminiProvider, "embed", rejected)
    monkeypatch.setattr(GeminiProvider, "translate_batch", rejected)
    with pytest.raises(Rejected):
        client.post(f"{PREFIX}/ai/{operation}", headers=account, json=body)
    with Session(engine) as session:
        row = session.get(AICredential, "aex-key")
        assert row is not None and row.last_validated == 123


@pytest.mark.parametrize("operation", ["models", "chat/stream", "tag/stream"])
def test_missing_key_refusal_releases_preparation(
    client: TestClient,
    account: dict[str, str],
    request: pytest.FixtureRequest,
    operation: str,
) -> None:
    body = {**_body(client, account, operation), "aiKeyId": "absent"}
    session, events = request.getfixturevalue("preparation")
    response = client.post(f"{PREFIX}/ai/{operation}", headers=account, json=body)
    assert response.status_code == 404
    assert response.json() == {"detail": "AI key not found"}
    assert events == ["begin", "end"]
    assert not session.in_transaction()


def test_unexpected_stream_failure_keeps_a_stack_without_secrets(
    client: TestClient,
    account: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    body = _body(client, account, "chat/stream")

    async def stream(_self: Any, *_: Any, **__: Any) -> AsyncIterator[str]:
        yield "partial"
        raise RuntimeError(SECRET) from ValueError(SECRET)

    monkeypatch.setattr(GeminiProvider, "stream", stream)
    response = client.post(f"{PREFIX}/ai/chat/stream", headers=account, json=body)
    assert "failed unexpectedly" in response.text
    assert "[DONE]" not in response.text
    assert SECRET not in response.text + caplog.text
    assert "Traceback" in caplog.text
