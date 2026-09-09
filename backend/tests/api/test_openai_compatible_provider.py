"""BYOK-02: the second Provider kind, and the model list that is no longer static.

**What is deliberately not here.** The ticket says the Provider classes are
integration code against somebody else's API and are not worth pinning with
tests — asserting a request-body shape teaches the suite a vendor's current
behaviour rather than ours. So there is nothing here about `messages` arrays or
`response_format`.

What is here is the pair of properties that *are* ours:

* the credential travels in a header and never in the URL, because a key-bearing
  query parameter is one log line away from the leak the recorded request body
  is composed at the call site to prevent; and
* `POST /ai/models` answers for the Key its caller named, falls back to free
  text rather than blocking an endpoint that serves no catalogue, and refuses a
  Key that is not the caller's.

The transport is a stub, so none of it reaches the network. `asyncio.run` rather
than an async test, because this suite configures no async plugin and one test
module is not the place to introduce one.
"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app import crud
from app.ai import registry
from app.ai.models import ChatMessage, ModelInfo
from app.ai.providers.openai_compatible import (
    OpenAICompatibleError,
    OpenAICompatibleProvider,
)
from app.core.config import settings
from app.core.db import engine
from app.core.secrets import encrypt_token
from app.models import User, UserCreate
from app.models_tg import AICredential
from app.services.ai_keys import (
    AI_CREDENTIAL_NOT_FOUND,
    AI_KEY_MISSING_DETAIL,
    AI_KEY_REJECTED_DETAIL,
    BASE_URL_REQUIRED_DETAIL,
    OPENAI_COMPATIBLE,
)
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR
SECRET = "sk-do-not-leak-me"
BASE_URL = "https://x.test/v1"


@pytest.fixture(autouse=True)
def _empty_model_cache() -> Iterator[None]:
    """The cache is process-local, so a leftover entry crosses tests."""
    registry._MODEL_CACHE.clear()
    yield
    registry._MODEL_CACHE.clear()


@pytest.fixture
def seen(monkeypatch: pytest.MonkeyPatch) -> list[httpx.Request]:
    """Every request the Provider makes, with the network replaced by a stub.

    Patched at `httpx.AsyncClient.__init__` rather than injected, because the
    Provider constructs its own client per call — which is the right shape for
    a class that may be built once per request and is what makes it awkward to
    hand a transport to.
    """
    captured: list[httpx.Request] = []
    original = httpx.AsyncClient.__init__

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "data": [{"id": "zeta-1"}, {"id": "alpha-1"}],
                "choices": [{"message": {"content": "hi"}}],
            },
        )

    def patched(self: httpx.AsyncClient, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(handler)
        original(self, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    return captured


# --------------------------------------------------------------------------
# The credential goes in a header and nowhere else
# --------------------------------------------------------------------------


def test_the_key_travels_in_a_header_and_never_in_the_url(
    seen: list[httpx.Request],
) -> None:
    """The guard `docs/byok-plan.md` step 2 asks for, as a runnable check.

    One widely-deployed gateway accepts its key as a query parameter, and the
    obvious implementation of a Provider follows the vendor's own example. The
    recorded request body for an AI call is composed at the call site from the
    prompt — that is the only reason nothing can capture a credential today —
    and a key in the URL puts it back within reach of anything that logs one.

    **Mutation:** move the key into `params={"key": self._api_key}` and this
    goes red on the URL assertion while every other test here stays green.
    """
    provider = OpenAICompatibleProvider(api_key=SECRET, base_url=BASE_URL)

    asyncio.run(provider.list_models())
    asyncio.run(provider.complete("prompt", model="m"))

    assert seen, "the stub transport was never reached"
    for request in seen:
        assert SECRET not in str(request.url), (
            f"the credential reached the URL: {request.url}"
        )
        assert request.headers["authorization"] == f"Bearer {SECRET}"


def test_a_trailing_slash_on_the_base_url_does_not_double(
    seen: list[httpx.Request],
) -> None:
    """Pasting a URL out of a vendor's docs usually brings one along."""
    provider = OpenAICompatibleProvider(api_key=SECRET, base_url="https://x.test/v1/")

    asyncio.run(provider.list_models())

    assert str(seen[0].url) == "https://x.test/v1/models"


def test_the_model_list_is_whatever_the_endpoint_returned(
    seen: list[httpx.Request],
) -> None:
    """No filtering by vendor and no hardcoded ids.

    Sorted, because an endpoint reaching several hundred models returns them in
    no useful order and a dropdown is the thing reading this.
    """
    provider = OpenAICompatibleProvider(api_key=SECRET, base_url=BASE_URL)

    models = asyncio.run(provider.list_models())

    assert [m.id for m in models] == ["alpha-1", "zeta-1"]
    assert {m.provider for m in models} == {OPENAI_COMPATIBLE}


def test_a_refusal_is_readable_by_the_one_rejection_rule(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`is_credential_rejection` duck-types, and this Provider answers it.

    The alternative was a second exception hierarchy and a second rejection
    rule, which is how one Provider ends up clearing validation stamps and the
    other silently not.
    """
    original = httpx.AsyncClient.__init__

    def patched(self: httpx.AsyncClient, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(
            lambda _r: httpx.Response(401, text="Invalid Authentication")
        )
        original(self, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    provider = OpenAICompatibleProvider(api_key=SECRET, base_url=BASE_URL)

    with pytest.raises(OpenAICompatibleError) as raised:
        asyncio.run(provider.list_models())

    assert registry.is_credential_rejection(raised.value)


def test_a_401_is_a_rejection_whatever_the_body_says() -> None:
    """A 401 carries no ambiguity, so it needs no phrase match.

    The phrase list exists for **400** alone, because Gemini answers a bad key
    with `400 INVALID_ARGUMENT` and so does a bad model id. Requiring a phrase
    at 401 read OpenRouter's real body — `{"error":{"message":"No auth
    credentials found"}}` — as "briefly unwell", so a revoked Key answered 200
    with an empty model list and kept its validation stamp: the settings panel
    went on calling a dead key healthy.

    **Mutation:** fold 401/403 back in with 400 and this goes red while the
    Gemini cases below stay green.
    """
    assert registry.is_credential_rejection(
        OpenAICompatibleError(401, '{"error":{"message":"No auth credentials found"}}')
    )
    assert registry.is_credential_rejection(OpenAICompatibleError(403, "Forbidden"))


def test_a_400_still_needs_more_than_its_status() -> None:
    """The discrimination the phrase list is *for*, kept.

    A bad model id and a bad key are both 400 on Gemini, and clearing a stamp on
    the first would flag a working Key the moment somebody typed a model name
    wrong — which the free-text combo makes easy to do.
    """
    assert not registry.is_credential_rejection(
        OpenAICompatibleError(400, "model not found: gemini-9-ultra")
    )
    assert registry.is_credential_rejection(
        OpenAICompatibleError(400, "API key not valid")
    )
    assert not registry.is_credential_rejection(OpenAICompatibleError(500, "api key"))


def test_a_stream_reassembles_the_deltas_and_stops_at_done(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Chat and Tag runs stream; Summary is the only one that does not.

    The acceptance criterion is that all three Artifact kinds work against this
    Provider, and streaming is the half `complete` does not exercise — a
    different route, a different response format and its own terminator. Frame
    *parsing* is ours even though the vendor's schema is not: `[DONE]` is not
    JSON, and an implementation that fed it to `json.loads` would end every
    chat with an exception after the text had already arrived.
    """
    original = httpx.AsyncClient.__init__
    sse = (
        b'data: {"choices":[{"delta":{"content":"one "}}]}\n\n'
        b'data: {"choices":[{"delta":{"content":"two"}}]}\n\n'
        b"data: [DONE]\n\n"
    )

    def patched(self: httpx.AsyncClient, **kwargs: Any) -> None:
        kwargs["transport"] = httpx.MockTransport(
            lambda _r: httpx.Response(200, content=sse)
        )
        original(self, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched)
    provider = OpenAICompatibleProvider(api_key=SECRET, base_url=BASE_URL)

    async def collect() -> str:
        chunks = [
            chunk
            async for chunk in provider.stream(
                "hi", model="m", history=[ChatMessage(role="user", text="earlier")]
            )
        ]
        return "".join(chunks)

    assert asyncio.run(collect()) == "one two"


def test_an_openai_compatible_key_needs_an_address() -> None:
    """Refused at construction rather than at the first request.

    Without it the failure is an `httpx` complaint about a relative URL, raised
    somewhere inside a streaming Summary.
    """
    with pytest.raises(ValueError):
        OpenAICompatibleProvider(api_key=SECRET, base_url="")


# --------------------------------------------------------------------------
# The cache
# --------------------------------------------------------------------------


def test_a_second_render_of_a_dropdown_does_not_reach_the_provider(
    seen: list[httpx.Request],
) -> None:
    """Why the cache exists at all.

    Without it every render of the Action tab is an authenticated outbound
    request on somebody's own key — a small bill and a large number of them.

    **Mutation:** delete the TTL check in `list_models_cached` and the second
    call reaches the transport, taking this to two requests.
    """
    kwargs: dict[str, Any] = {
        "provider": OPENAI_COMPATIBLE,
        "api_key": SECRET,
        "base_url": BASE_URL,
        "cache_key": f"row-1|{BASE_URL}",
    }

    asyncio.run(registry.list_models_cached(**kwargs))
    asyncio.run(registry.list_models_cached(**kwargs))

    assert len(seen) == 1


def test_moving_a_key_to_another_endpoint_does_not_serve_the_old_catalogue(
    seen: list[httpx.Request],
) -> None:
    """The base URL is part of the cache key, and `forget_cached_models` is the
    save-time half of the same property."""
    asyncio.run(
        registry.list_models_cached(
            provider=OPENAI_COMPATIBLE,
            api_key=SECRET,
            base_url="https://one.test/v1",
            cache_key="row-1|https://one.test/v1",
        )
    )
    registry.forget_cached_models("row-1|")
    asyncio.run(
        registry.list_models_cached(
            provider=OPENAI_COMPATIBLE,
            api_key=SECRET,
            base_url="https://two.test/v1",
            cache_key="row-1|https://two.test/v1",
        )
    )

    assert [r.url.host for r in seen] == ["one.test", "two.test"]


# --------------------------------------------------------------------------
# POST /ai/models
# --------------------------------------------------------------------------


def _make_account(client: TestClient) -> tuple[User, dict[str, str]]:
    password = random_lower_string()
    with Session(engine) as session:
        user = crud.create_user(
            session=session,
            user_create=UserCreate(
                email=f"{random_lower_string()}@byok02.test-account.com",
                password=password,
            ),
        )
        session.commit()
        session.refresh(user)
    headers = user_authentication_headers(
        client=client, email=user.email, password=password
    )
    return user, headers


def _drop_account(user_id: uuid.UUID) -> None:
    with Session(engine) as session:
        session.exec(delete(AICredential).where(col(AICredential.user_id) == user_id))
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


@pytest.fixture
def account(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    user, headers = _make_account(client)
    yield user, headers
    _drop_account(user.id)


def _seed_key(user_id: uuid.UUID, key_id: str) -> None:
    with Session(engine) as session:
        session.add(
            AICredential(
                id=key_id,
                user_id=user_id,
                label=key_id,
                provider=OPENAI_COMPATIBLE,
                base_url=BASE_URL,
                key_encrypted=encrypt_token(SECRET),
            )
        )
        session.commit()


def test_the_listing_is_the_providers_answer_and_keeps_its_key_set(
    client: TestClient,
    account: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The wire shape `test_b6_projection.py` used to assert, moved here.

    It left that file by that file's own rule — it is scoped to what is
    reachable without mocking an outbound fetch, and this endpoint became one.
    """
    user, headers = account
    _seed_key(user.id, "models-ok")

    async def _list(**_kwargs: object) -> list[ModelInfo]:
        return [ModelInfo(id="m-1", label="M 1", provider=OPENAI_COMPATIBLE)]

    monkeypatch.setattr("app.api.routes.ai_routes.list_models_cached", _list)

    body = client.post(f"{V1}/ai/models", json={}, headers=headers).json()

    assert set(body) == {"models", "default"}
    assert [m["id"] for m in body["models"]] == ["m-1"]
    for entry in body["models"]:
        assert set(entry) == {"id", "label", "provider"}


def test_the_default_is_a_model_this_provider_actually_offers(
    client: TestClient,
    account: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`DEFAULT_AI_MODEL` is one deployment-wide Gemini id, and it is not an
    answer for an Account whose only Key is an OpenRouter or Ollama credential.

    Without this the break is on the *first run*, not at some edge: the settings
    default is a Gemini id, `ModelCombo` renders it unchanged, and the first
    Summary posts `gemini-3-flash-preview` to an endpoint that has never heard
    of it. Deleting `constants.MODELS` removed the client-side fallback that
    used to cover this (`oneOfSetting` rejected an unlisted id), so the repair
    moved here, where the offered list actually is.

    **Mutation:** return `default_model()` unconditionally from `_default_for`
    and this goes red.
    """
    user, headers = account
    _seed_key(user.id, "models-default")

    async def _list(**_kwargs: object) -> list[ModelInfo]:
        return [
            ModelInfo(id="qwen2.5:7b", label="qwen2.5:7b", provider=OPENAI_COMPATIBLE),
            ModelInfo(id="zzz", label="zzz", provider=OPENAI_COMPATIBLE),
        ]

    monkeypatch.setattr("app.api.routes.ai_routes.list_models_cached", _list)

    body = client.post(f"{V1}/ai/models", json={}, headers=headers).json()

    assert body["default"] == "qwen2.5:7b", (
        "the deployment's Gemini default was offered to a provider that does "
        "not have it, which is the first Summary failing"
    )


def test_a_default_the_provider_does_offer_is_kept(
    client: TestClient,
    account: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other half. A Gemini Key must keep the deployment's chosen model
    rather than being moved to whatever sorts first."""
    user, headers = account
    _seed_key(user.id, "models-keep")
    deployment_default = settings.DEFAULT_AI_MODEL

    async def _list(**_kwargs: object) -> list[ModelInfo]:
        return [
            ModelInfo(id="aaa-sorts-first", label="a", provider="gemini"),
            ModelInfo(id=deployment_default, label="d", provider="gemini"),
        ]

    monkeypatch.setattr("app.api.routes.ai_routes.list_models_cached", _list)

    body = client.post(f"{V1}/ai/models", json={}, headers=headers).json()

    assert body["default"] == deployment_default


def test_an_endpoint_serving_no_catalogue_falls_back_to_free_text(
    client: TestClient,
    account: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An empty list, not a 502.

    A local Ollama or a bare vLLM answering 404 on `/models` is exactly the
    Account this Provider kind exists to serve, and the client turns the empty
    list into a free-text model id. Blocking here would exclude them from the
    feature over a route they do not implement.

    **Mutation:** re-raise instead of returning `[]` in the route's `except` and
    this goes red with a 502.
    """
    user, headers = account
    _seed_key(user.id, "models-none")

    async def _boom(**_kwargs: object) -> list[ModelInfo]:
        raise OpenAICompatibleError(404, "not found")

    monkeypatch.setattr("app.api.routes.ai_routes.list_models_cached", _boom)

    response = client.post(f"{V1}/ai/models", json={}, headers=headers)

    assert response.status_code == 200
    assert response.json()["models"] == []


def test_a_rejected_key_says_so_rather_than_answering_empty(
    client: TestClient,
    account: tuple[User, dict[str, str]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The other side of the fallback, and the half that is easy to lose.

    Swallowing a 401 into an empty list tells somebody their provider offers no
    models when it has actually stopped accepting their key — collapsing the
    "different problems, different fixes" split BYOK-01 exists to keep.
    """
    user, headers = account
    _seed_key(user.id, "models-dead")

    async def _rejected(**_kwargs: object) -> list[ModelInfo]:
        raise OpenAICompatibleError(401, "Invalid Authentication")

    monkeypatch.setattr("app.api.routes.ai_routes.list_models_cached", _rejected)

    response = client.post(f"{V1}/ai/models", json={}, headers=headers)

    assert response.status_code == 502
    assert response.json()["detail"] == AI_KEY_REJECTED_DETAIL
    with Session(engine) as session:
        row = session.get(AICredential, "models-dead")
        assert row is not None and row.last_validated is None, (
            "a Provider rejected the Key and its validation stamp survived, so "
            "the settings surface has nothing to flag"
        )


def test_an_account_with_no_key_is_told_to_add_one(
    client: TestClient, account: tuple[User, dict[str, str]]
) -> None:
    """There is no list to serve, and an empty one would read as the Provider's
    answer rather than as a missing Key."""
    _user, headers = account

    response = client.post(f"{V1}/ai/models", json={}, headers=headers)

    assert response.status_code == 400
    assert response.json()["detail"] == AI_KEY_MISSING_DETAIL


def test_saving_an_openai_compatible_key_without_an_address_is_refused(
    client: TestClient, account: tuple[User, dict[str, str]]
) -> None:
    """The form is where this is answerable, so it is where it is answered.

    Without the check the row saves, resolves, and fails inside a streaming
    Summary as a `ValueError` out of the registry — a 500 with nothing on
    screen naming the missing field. A Gemini Key still needs no address, which
    is the other half and the one a blanket requirement would break.
    """
    _user, headers = account

    refused = client.put(
        f"{V1}/data/ai-keys/needs-a-url",
        json={"label": "openrouter", "provider": OPENAI_COMPATIBLE, "key": SECRET},
        headers=headers,
    )
    assert refused.status_code == 400
    assert refused.json()["detail"] == BASE_URL_REQUIRED_DETAIL
    with Session(engine) as session:
        assert session.get(AICredential, "needs-a-url") is None


def test_a_foreign_key_id_is_refused(
    client: TestClient, account: tuple[User, dict[str, str]]
) -> None:
    """Refused before `decrypt_token`, and answering as an absent row does.

    Probed again from the route inventory in `test_account_isolation.py`;
    asserted here because this is the module somebody reads when changing the
    endpoint.
    """
    _user, headers = account
    stranger, _stranger_headers = _make_account(client)
    _seed_key(stranger.id, "models-theirs")
    try:
        response = client.post(
            f"{V1}/ai/models", json={"aiKeyId": "models-theirs"}, headers=headers
        )
        assert response.status_code == 404
        assert response.json()["detail"] == AI_CREDENTIAL_NOT_FOUND
    finally:
        _drop_account(stranger.id)
