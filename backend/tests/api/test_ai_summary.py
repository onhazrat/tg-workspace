"""Tests for POST /api/v1/ai/summary/prompt (Copy Prompt)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR


def test_summary_prompt_returns_prompt(client: TestClient) -> None:
    headers = get_superuser_token_headers(client)
    response = client.post(
        f"{PREFIX}/ai/summary/prompt",
        headers=headers,
        json={
            "channels": ["testchannel"],
            "language": "English",
            "postsText": "Sample post content for prompt building.",
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "prompt" in data
    assert isinstance(data["prompt"], str)
    assert len(data["prompt"]) > 0
    assert "testchannel" in data["prompt"] or "Sample post" in data["prompt"]


def test_summary_prompt_requires_auth(client: TestClient) -> None:
    response = client.post(
        f"{PREFIX}/ai/summary/prompt",
        json={
            "channels": [],
            "language": "English",
            "postsText": "",
        },
    )
    assert response.status_code in (401, 403)
