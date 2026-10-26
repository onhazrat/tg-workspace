"""`POST /ai/tag/prompt` names its Tag run (ADR-038).

The prompt reads the run's Covered Posts, by Channel, and answers how many of
them could not be read beside it. The browser names the run and never a Scope.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.api.routes import ai_routes
from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.services.ai_keys import ResolvedKey
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR
MINUTE = 60_000
WINDOW = {"mode": "fixed", "start": 0, "end": 900 * MINUTE}


def _seed(*posts: tuple[str, int]) -> None:
    with Session(engine) as session:
        for channel_name, post_id in posts:
            session.add(
                Post(
                    channel_name=channel_name,
                    post_id=post_id,
                    text=f"{channel_name} post {post_id}",
                    timestamp=post_id * MINUTE,
                )
            )
        session.commit()
        follow_channels(session, *{c for c, _ in posts})


def _open(client: TestClient, headers: dict[str, str], channels: list[str]) -> str:
    tag_run_id = str(uuid.uuid4())
    opened = client.post(
        f"{PREFIX}/data/tag-runs",
        headers=headers,
        json={"id": tag_run_id, "scope": {"channels": channels, "window": WINDOW}},
    )
    assert opened.status_code == 200, opened.text
    return tag_run_id


def _prompt(client: TestClient, headers: dict[str, str], **body: Any) -> Any:
    return client.post(f"{PREFIX}/ai/tag/prompt", headers=headers, json=body)


def test_the_prompt_reads_the_runs_covered_posts(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    _seed(("tg_a", 1), ("tg_a", 2), ("tg_b", 4))
    tag_run_id = _open(client, headers, ["tg_a", "tg_b"])
    with Session(engine) as session:
        # Reclaimed after the freeze: left out and counted.
        session.delete(session.exec(select(Post).where(col(Post.post_id) == 2)).one())
        # Synced into the window after the freeze: never read.
        session.add(
            Post(channel_name="tg_a", post_id=3, text="too late", timestamp=3 * MINUTE)
        )
        session.commit()

    response = _prompt(client, headers, tagRunId=tag_run_id, allTags="Politics")

    assert response.status_code == 200, response.text
    prompt = response.json()["prompt"]
    assert "tg_a post 1" in prompt
    assert "tg_b post 4" in prompt
    assert "tg_a post 2" not in prompt
    assert "too late" not in prompt
    # The tag layout: each Channel's block under its own heading.
    assert "### tg_b\nPosts (chronological):\n- [ID 4 |" in prompt
    assert "EXISTING TAGS IN USE" in prompt
    assert "Politics" in prompt
    assert response.json()["missingPosts"] == 1


def test_the_channel_descriptions_replace_the_bare_names(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    tag_run_id = _open(client, headers, ["legacy_name"])

    response = _prompt(
        client,
        headers,
        tagRunId=tag_run_id,
        channelsText="### scoped_channel\nCurrent tags: Politics",
    )

    assert response.status_code == 200, response.text
    assert "### scoped_channel" in response.json()["prompt"]
    assert response.json()["missingPosts"] == 0


def test_remove_mode_uses_remove_limits(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    tag_run_id = _open(client, headers, ["tg_a"])

    response = _prompt(client, headers, tagRunId=tag_run_id, tagMode="remove")

    assert response.status_code == 200, response.text
    assert "between 0 and 3 tags per channel" in response.json()["prompt"]


def test_an_absent_run_answers_tag_run_not_found(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    response = _prompt(client, headers, tagRunId="nope")
    assert response.status_code == 404
    assert response.json()["detail"] == "Tag run not found"


def test_a_scope_or_posts_in_the_body_is_refused(client: TestClient) -> None:
    """A tab left open across the deploy fails clearly; one reload fixes it."""
    headers = get_superuser_token_headers(client)
    tag_run_id = _open(client, headers, ["tg_a"])
    for stale in ({"scope": {"window": WINDOW}}, {"postsText": "### tg_a\n- x"}):
        response = _prompt(client, headers, tagRunId=tag_run_id, **stale)
        assert response.status_code == 422, stale


def test_a_run_records_its_refs_count_and_refuses_one_from_the_browser(
    client: TestClient,
) -> None:
    headers = get_superuser_token_headers(client)
    _seed(("tg_a", 1), ("tg_a", 2))
    body = {"id": str(uuid.uuid4()), "scope": {"channels": ["tg_a"], "window": WINDOW}}

    refused = client.post(
        f"{PREFIX}/data/tag-runs", headers=headers, json={**body, "postCount": 99}
    )
    opened = client.post(f"{PREFIX}/data/tag-runs", headers=headers, json=body)

    assert refused.status_code == 422
    assert opened.json()["postCount"] == 2


def test_the_stream_sends_the_missing_count_before_the_runs_prompt(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The stream asks the model the prompt `/ai/tag/prompt` answers."""
    headers = get_superuser_token_headers(client)
    _seed(("tg_a", 1), ("tg_a", 2))
    tag_run_id = _open(client, headers, ["tg_a"])
    with Session(engine) as session:
        session.delete(session.exec(select(Post).where(col(Post.post_id) == 2)).one())
        session.commit()
    asked: list[str] = []

    class _Provider:
        async def stream(self, prompt: str, **_: Any) -> AsyncIterator[str]:
            asked.append(prompt)
            yield "news: Politics"

    key = ResolvedKey(provider="gemini", api_key="k", credential_id=None)
    monkeypatch.setattr(
        ai_routes, "_provider_for", lambda *_a, **_k: (_Provider(), key)
    )

    streamed = client.post(
        f"{PREFIX}/ai/tag/stream", headers=headers, json={"tagRunId": tag_run_id}
    )

    frames = [f.removeprefix("data: ") for f in streamed.text.split("\n\n") if f]
    assert frames == [
        json.dumps({"missingPosts": 1}),
        json.dumps({"text": "news: Politics"}),
        "[DONE]",
    ]
    assert asked == [_prompt(client, headers, tagRunId=tag_run_id).json()["prompt"]]


def test_a_foreign_run_is_not_found_and_spends_nothing(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        ai_routes, "_provider_for", lambda *_a, **_k: pytest.fail("spent a Key")
    )
    response = client.post(
        f"{PREFIX}/ai/tag/stream",
        headers=get_superuser_token_headers(client),
        json={"tagRunId": "nope"},
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Tag run not found"


def test_tag_prompt_requires_auth(client: TestClient) -> None:
    response = client.post(f"{PREFIX}/ai/tag/prompt", json={"tagRunId": "x"})
    assert response.status_code in (401, 403)
