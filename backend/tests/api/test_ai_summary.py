"""`POST /ai/summary/prompt` (Copy Prompt) names its Summary (ADR-038).

The prompt reads the Summary's Covered Posts, the prompt Generate would store,
and answers how many of them could not be read beside it.
"""

from __future__ import annotations

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Channel, Post
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR
MINUTE = 60_000
WINDOW = {"mode": "fixed", "start": 0, "end": 900 * MINUTE}


def _open(client: TestClient, headers: dict[str, str], channels: list[str]) -> str:
    summary_id = str(uuid.uuid4())
    opened = client.post(
        f"{PREFIX}/data/summaries",
        headers=headers,
        json={"id": summary_id, "scope": {"channels": channels, "window": WINDOW}},
    )
    assert opened.status_code == 200, opened.text
    return summary_id


def test_the_prompt_reads_the_summarys_covered_posts(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    with Session(engine) as session:
        for post_id in (1, 2):
            session.add(
                Post(
                    channel_name="cp_a",
                    post_id=post_id,
                    text=f"covered {post_id}",
                    timestamp=post_id * MINUTE,
                )
            )
        session.commit()
        follow_channels(session, "cp_a")
    summary_id = _open(client, headers, ["cp_a"])
    with Session(engine) as session:
        # Reclaimed after the freeze: left out and counted.
        session.delete(session.exec(select(Post).where(col(Post.post_id) == 2)).one())
        session.add(
            Post(channel_name="cp_a", post_id=3, text="too late", timestamp=3 * MINUTE)
        )
        session.commit()

    response = client.post(
        f"{PREFIX}/ai/summary/prompt", headers=headers, json={"summaryId": summary_id}
    )

    assert response.status_code == 200, response.text
    assert "covered 1" in response.json()["prompt"]
    assert "covered 2" not in response.json()["prompt"]
    assert "too late" not in response.json()["prompt"]
    assert response.json()["missingPosts"] == 1


def test_the_accounts_bio_setting_describes_the_channels(client: TestClient) -> None:
    """The server reads the switch the settings route stores (AC-03)."""
    headers = get_superuser_token_headers(client)
    with Session(engine) as session:
        follow_channels(session, "bio_a")
        channel = session.exec(
            select(Channel).where(col(Channel.name) == "bio_a")
        ).one()
        channel.bio = "Wire news"
        session.add(channel)
        session.commit()
    summary_id = _open(client, headers, ["bio_a"])

    def prompt() -> str:
        response = client.post(
            f"{PREFIX}/ai/summary/prompt",
            headers=headers,
            json={"summaryId": summary_id},
        )
        assert response.status_code == 200, response.text
        return str(response.json()["prompt"])

    assert "Bio: Wire news" not in prompt()
    stored = client.put(
        f"{PREFIX}/data/settings/ai_prefs",
        headers=headers,
        json={"includeChannelBio": True},
    )
    assert stored.status_code == 200, stored.text
    assert "### bio_a\nBio: Wire news" in prompt()


def test_channel_text_from_the_browser_is_refused(client: TestClient) -> None:
    """The Channels block is the server's now; a stale tab's 422 is one reload."""
    headers = get_superuser_token_headers(client)
    summary_id = _open(client, headers, [])
    response = client.post(
        f"{PREFIX}/ai/summary/prompt",
        headers=headers,
        json={"summaryId": summary_id, "channelsText": "### a\nBio: b"},
    )
    assert response.status_code == 422


def test_an_absent_summary_answers_summary_not_found(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    response = client.post(
        f"{PREFIX}/ai/summary/prompt", headers=headers, json={"summaryId": "nope"}
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "Summary not found"


def test_a_scope_in_the_body_is_refused(client: TestClient) -> None:
    """A tab left open across the deploy fails clearly; one reload fixes it."""
    headers = get_superuser_token_headers(client)
    summary_id = _open(client, headers, [])
    response = client.post(
        f"{PREFIX}/ai/summary/prompt",
        headers=headers,
        json={"summaryId": summary_id, "scope": {"window": WINDOW}},
    )
    assert response.status_code == 422


def test_the_generate_route_that_took_a_scope_is_gone(client: TestClient) -> None:
    """No path spends a Key over a Scope the browser states (ADR-038)."""
    headers = get_superuser_token_headers(client)
    response = client.post(
        f"{PREFIX}/ai/summary",
        headers=headers,
        json={"scope": {"channels": ["tg_a"], "window": WINDOW}},
    )
    assert response.status_code in (404, 405)


def test_summary_prompt_requires_auth(client: TestClient) -> None:
    response = client.post(f"{PREFIX}/ai/summary/prompt", json={"summaryId": "x"})
    assert response.status_code in (401, 403)
