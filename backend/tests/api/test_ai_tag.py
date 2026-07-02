"""Tests for tag prompt AI endpoints."""

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR


def test_tag_prompt_returns_prompt(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    response = client.post(
        f"{PREFIX}/ai/tag/prompt",
        headers=headers,
        json={
            "channels": ["chan_a"],
            "channelsText": "### chan_a\nCurrent tags: Politics",
            "postsText": "### chan_a\n- [ID 1] sample",
            "allTags": "Politics, Economy & Finance",
            "tagMode": "add",
        },
    )
    assert response.status_code == 200
    prompt = response.json()["prompt"]
    assert "### CHANNELS IN SCOPE" in prompt
    assert "### chan_a" in prompt
    assert "EXISTING TAGS IN USE" in prompt
    assert "Politics, Economy & Finance" in prompt


def test_tag_prompt_remove_mode_uses_remove_limits(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    response = client.post(
        f"{PREFIX}/ai/tag/prompt",
        headers=headers,
        json={
            "channels": ["chan_a"],
            "postsText": "### chan_a\n- [ID 1] sample",
            "allTags": "(none yet)",
            "tagMode": "remove",
        },
    )
    assert response.status_code == 200
    prompt = response.json()["prompt"]
    assert "between 0 and 3 tags per channel" in prompt


def test_tag_prompt_requires_auth(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/ai/tag/prompt",
        json={
            "channels": ["chan_a"],
            "postsText": "### chan_a\n- [ID 1] sample",
            "allTags": "(none yet)",
            "tagMode": "add",
        },
    )
    assert response.status_code in (401, 403)
