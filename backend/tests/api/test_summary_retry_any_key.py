"""A retry may run on any of the Account's Keys and any model that Key offers.

Driven over HTTP the way the Failed Summary page drives it: start an Attempt
naming a Key and a model, drain the generation Lane by hand, read the Summary
back. Unlike `test_summary_attempts_worker.py`, the Key is resolved for real
(only the Provider client is faked), because which Key is accepted, and when its
secret is decrypted, is what is under test here.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.core.secrets import encrypt_token
from app.jobs import summary_generation
from app.models import User, UserCreate
from app.models_tg import AICredential
from app.services import ai_keys
from tests.utils.user import user_authentication_headers
from tests.utils.utils import get_superuser_token_headers, random_lower_string

V1 = settings.API_V1_STR


class _FakeProvider:
    def __init__(self, api_key: str) -> None:
        self.api_key = api_key
        self.calls: list[dict[str, Any]] = []

    async def stream(self, prompt: str, **kwargs: Any) -> AsyncIterator[str]:
        self.calls.append({"prompt": prompt, **kwargs})
        yield f"Written with {self.api_key}."


@pytest.fixture
def built(monkeypatch: pytest.MonkeyPatch) -> list[_FakeProvider]:
    """Every Provider client the runner built, with the secret it was given."""
    made: list[_FakeProvider] = []

    def _get_provider(*, provider: str, api_key: str, base_url: str | None) -> Any:
        made.append(_FakeProvider(api_key))
        return made[-1]

    monkeypatch.setattr(summary_generation, "get_provider", _get_provider)
    monkeypatch.setattr(summary_generation, "FLUSH_SECONDS", 0.0)
    return made


@pytest.fixture
def decrypted(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """Every ciphertext `resolve_ai_key` decrypted."""
    seen: list[str] = []
    original = ai_keys.decrypt_token

    def _spy(token: str) -> str:
        seen.append(token)
        return original(token)

    monkeypatch.setattr(ai_keys, "decrypt_token", _spy)
    return seen


@pytest.fixture
def headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)


@pytest.fixture
def owner_id() -> uuid.UUID:
    with Session(engine) as session:
        user = crud.get_user_by_email(session=session, email=settings.FIRST_SUPERUSER)
        assert user is not None
        return user.id


@pytest.fixture
def stranger(client: TestClient) -> Iterator[uuid.UUID]:
    password = random_lower_string()
    with Session(engine) as session:
        user = crud.create_user(
            session=session,
            user_create=UserCreate(
                email=f"{random_lower_string()}@sfr04.test-account.com",
                password=password,
            ),
        )
        session.commit()
        user_id = user.id
    user_authentication_headers(client=client, email=user.email, password=password)
    yield user_id
    with Session(engine) as session:
        session.exec(delete(AICredential).where(col(AICredential.user_id) == user_id))
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


def _seed_key(user_id: uuid.UUID, key_id: str, secret: str) -> str:
    ciphertext = encrypt_token(secret)
    with Session(engine) as session:
        session.add(
            AICredential(
                id=key_id,
                user_id=user_id,
                label=key_id,
                provider="gemini",
                key_encrypted=ciphertext,
            )
        )
        session.commit()
    return ciphertext


def _open(client: TestClient, headers: dict[str, str]) -> str:
    summary_id = str(uuid.uuid4())
    r = client.post(
        f"{V1}/data/summaries",
        headers=headers,
        json={
            "id": summary_id,
            "scope": {
                "channels": ["chan_a"],
                "window": {"mode": "live", "durationMinutes": 60, "endGapMinutes": 0},
            },
            "extra": {"status": "failed"},
        },
    )
    assert r.status_code == 200, r.text
    r = client.put(
        f"{V1}/data/summaries/{summary_id}",
        headers=headers,
        json={"promptText": "Go."},
    )
    assert r.status_code == 200, r.text
    return summary_id


def _start(
    client: TestClient, headers: dict[str, str], summary_id: str, **body: Any
) -> dict[str, Any]:
    r = client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/start", headers=headers, json=body
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def _drain() -> str | None:
    return asyncio.run(summary_generation.run_next_attempt())


def test_a_retry_on_a_second_key_and_model_finishes_the_summary_with_them(
    client: TestClient,
    headers: dict[str, str],
    owner_id: uuid.UUID,
    built: list[_FakeProvider],
) -> None:
    _seed_key(owner_id, "sfr04-first", "sk-first")
    _seed_key(owner_id, "sfr04-second", "sk-second")
    summary_id = _open(client, headers)
    first = _start(
        client, headers, summary_id, aiKeyId="sfr04-first", model="first-model"
    )
    r = client.post(
        f"{V1}/data/summaries/{summary_id}/attempts/{first['id']}/stop",
        headers=headers,
    )
    assert r.status_code == 200, r.text

    retry = _start(
        client, headers, summary_id, aiKeyId="sfr04-second", model="second-model"
    )
    assert retry["keyId"] == "sfr04-second"
    assert retry["model"] == "second-model"
    while _drain() is not None:
        pass

    assert built[-1].api_key == "sk-second"
    assert built[-1].calls[-1]["model"] == "second-model"
    summary = client.get(f"{V1}/data/summaries/{summary_id}", headers=headers).json()
    assert summary["text"] == "Written with sk-second."
    assert summary["model"] == "second-model"
    assert summary["aiKeyId"] == "sfr04-second"
    attempts = client.get(
        f"{V1}/data/summaries/{summary_id}/attempts", headers=headers
    ).json()
    assert [(a["keyId"], a["model"], a["outcome"]) for a in attempts] == [
        ("sfr04-first", "first-model", "stopped"),
        ("sfr04-second", "second-model", "succeeded"),
    ]


def test_a_foreign_key_is_refused_before_decrypt_and_answers_as_an_absent_one(
    client: TestClient,
    headers: dict[str, str],
    owner_id: uuid.UUID,
    stranger: uuid.UUID,
    built: list[_FakeProvider],
    decrypted: list[str],
) -> None:
    """**Mutation:** drop the owner check in `resolve_ai_key` and the
    stranger's ciphertext is decrypted and a Provider is built with it."""
    _seed_key(owner_id, "sfr04-mine", "sk-mine")
    foreign_ciphertext = _seed_key(stranger, "sfr04-theirs", "sk-theirs")

    foreign = _start(
        client, headers, _open(client, headers), aiKeyId="sfr04-theirs", model="m"
    )
    absent = _start(
        client, headers, _open(client, headers), aiKeyId="sfr04-nobody", model="m"
    )

    assert foreign_ciphertext not in decrypted
    assert built == []
    assert _drain() is None
    for started in (foreign, absent):
        assert started["outcome"] == "failed"
        assert started["kind"] == "auth"
    assert foreign["error"] == absent["error"] == ai_keys.AI_CREDENTIAL_NOT_FOUND
