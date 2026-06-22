"""Tests for POST /api/v1/ai/summary/prompt (Copy Prompt — no LLM call)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = settings.API_V1_STR


def test_summary_prompt_requires_auth(client: TestClient) -> None:
    body = {
        "channels": ["test-channel"],
        "language": "English",
        "postsText": "Sample post content",
    }
    r = client.post(f"{PREFIX}/ai/summary/prompt", json=body)
    assert r.status_code in (401, 403)


def test_summary_prompt_returns_prompt(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    body = {
        "channels": ["test-channel"],
        "language": "English",
        "postsText": "Sample post content",
    }
    r = client.post(
        f"{PREFIX}/ai/summary/prompt",
        json=body,
        headers=superuser_token_headers,
    )
    assert r.status_code == 200
    data = r.json()
    assert set(data.keys()) == {"prompt"}
    assert isinstance(data["prompt"], str)
    assert len(data["prompt"]) > 0
    assert "test-channel" in data["prompt"]
    assert "Sample post content" in data["prompt"]
