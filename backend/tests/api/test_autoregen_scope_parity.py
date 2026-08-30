"""A bare channels+window scope reproduces the old date-range read (A1b).

Auto-regenerate used to call `getPostsByDateRange(s.channels, start, end)` in the
browser, concatenate the result with `formatPostsForPrompt`, and post the whole
string back. It now sends `scope: {startDate, endDate}` and lets the backend
assemble the block.

That substitution is only sound if a scope carrying *nothing but* the channels
and the window selects the same posts, in the same order, as the plain
date-range read did. Every other scope field takes its default on this path, so
these tests pin that each of those defaults is a **no-op**:

    forwarded="all"  media="all"  maxPerChannel=0  maxPerChannelMode="latest"
    sort="time"      seed=0       keyword=None

The formatter itself is already covered — `tests/prompts/test_posts_prompt.py`
asserts `format_posts_for_prompt` is byte-identical to the frontend's. What is
new here is the *selection*.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.prompts.posts import format_posts_for_prompt
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR


def _seed(rows: list[tuple[str, int, str, int]], **extra: Any) -> None:
    with Session(engine) as session:
        for channel_name, post_id, text, ts in rows:
            session.add(
                Post(
                    channel_name=channel_name,
                    post_id=post_id,
                    text=text,
                    timestamp=ts,
                    **extra,
                )
            )
        session.commit()
        # Ticket 21: `Post` is `FOLLOW_SCOPED`, so a bare row with no Channel
        # and no Follow is invisible under enforcement. These read back through
        # the client as `FIRST_SUPERUSER`, the operator this defaults to.
        follow_channels(session, *{row[0] for row in rows})


def _date_range_read(
    client: TestClient,
    headers: dict[str, str],
    channels: list[str],
    start: int,
    end: int,
) -> list[dict[str, Any]]:
    """The read the browser used to do: `POST /data/posts`, no filters."""
    r = client.post(
        f"{PREFIX}/data/posts",
        headers=headers,
        json={"channelNames": channels, "startDate": start, "endDate": end},
    )
    assert r.status_code == 200, r.text
    return list(r.json())


def _prompt_from_scope(
    client: TestClient,
    headers: dict[str, str],
    channels: list[str],
    start: int,
    end: int,
) -> str:
    """What auto-regenerate now sends: empty postsText, bare scope."""
    r = client.post(
        f"{PREFIX}/ai/summary/prompt",
        headers=headers,
        json={
            "channels": channels,
            "language": "English",
            "postsText": "",
            "scope": {"startDate": start, "endDate": end},
        },
    )
    assert r.status_code == 200, r.text
    return str(r.json()["prompt"])


def test_bare_scope_assembles_the_same_block_as_the_date_range_read(
    client: TestClient,
) -> None:
    """The whole of A1b in one assertion.

    Server-assembled block == `formatPostsForPrompt(getPostsByDateRange(...))`.
    """
    headers = get_superuser_token_headers(client)
    _seed(
        [
            ("alpha", 1, "first post", 1_000),
            ("alpha", 2, "second post", 2_000),
            ("beta", 3, "third post", 1_500),
        ]
    )

    expected_block = format_posts_for_prompt(
        _date_range_read(client, headers, ["alpha", "beta"], 0, 9_000)
    )
    prompt = _prompt_from_scope(client, headers, ["alpha", "beta"], 0, 9_000)

    assert expected_block
    assert expected_block in prompt


def test_the_window_bounds_are_applied(client: TestClient) -> None:
    """Auto-regenerate shifts the window forward; only the new slice may appear."""
    headers = get_superuser_token_headers(client)
    _seed(
        [
            ("alpha", 1, "before the window", 1_000),
            ("alpha", 2, "inside the window", 5_000),
            ("alpha", 3, "after the window", 9_000),
        ]
    )
    prompt = _prompt_from_scope(client, headers, ["alpha"], 4_000, 6_000)
    assert "inside the window" in prompt
    assert "before the window" not in prompt
    assert "after the window" not in prompt


def test_the_channel_list_is_applied(client: TestClient) -> None:
    """A regenerated summary keeps its own channel set, not the current UI one."""
    headers = get_superuser_token_headers(client)
    _seed([("alpha", 1, "mine", 1_000), ("beta", 2, "not mine", 1_000)])
    prompt = _prompt_from_scope(client, headers, ["alpha"], 0, 9_000)
    assert "mine" in prompt
    assert "not mine" not in prompt


def test_default_forwarded_and_media_drop_nothing(client: TestClient) -> None:
    """`forwarded="all"` / `media="all"` are the defaults and must not filter.

    The old path had no notion of these filters at all, so a non-neutral default
    would silently shrink every regenerated summary.
    """
    headers = get_superuser_token_headers(client)
    _seed([("alpha", 1, "plain post", 1_000)])
    _seed(
        [("alpha", 2, "forwarded post", 2_000)],
        forwarded_from="somewhere",
    )
    prompt = _prompt_from_scope(client, headers, ["alpha"], 0, 9_000)
    assert "plain post" in prompt
    assert "forwarded post" in prompt


def test_default_cap_of_zero_means_uncapped(client: TestClient) -> None:
    """`maxPerChannel=0` must mean "no cap", not "no posts"."""
    headers = get_superuser_token_headers(client)
    _seed([("alpha", i, f"post {i}", 1_000 + i) for i in range(1, 26)])
    prompt = _prompt_from_scope(client, headers, ["alpha"], 0, 9_000)
    for i in range(1, 26):
        assert f"post {i}" in prompt


def test_an_empty_window_assembles_an_empty_block(client: TestClient) -> None:
    """Emptiness is decided by `/data/posts/counts` client-side, but the prompt
    path must not invent content when the window is genuinely empty."""
    headers = get_superuser_token_headers(client)
    _seed([("alpha", 1, "outside", 1_000)])
    prompt = _prompt_from_scope(client, headers, ["alpha"], 5_000, 6_000)
    assert "outside" not in prompt


def test_counts_and_the_assembled_block_agree_on_the_post_set(
    client: TestClient,
) -> None:
    """The client sizes the run with `/data/posts/counts` and the server
    assembles with the same scope — a divergence would let auto-regenerate
    decide "no new posts" while the prompt path had posts, or vice-versa."""
    headers = get_superuser_token_headers(client)
    _seed(
        [
            ("alpha", 1, "in range one", 2_000),
            ("alpha", 2, "in range two", 3_000),
            ("alpha", 3, "out of range", 8_000),
        ]
    )
    counts = client.post(
        f"{PREFIX}/data/posts/counts",
        headers=headers,
        json={"channelNames": ["alpha"], "startDate": 0, "endDate": 5_000},
    )
    assert counts.status_code == 200, counts.text
    assert sum(counts.json().values()) == 2

    prompt = _prompt_from_scope(client, headers, ["alpha"], 0, 5_000)
    assert "in range one" in prompt
    assert "in range two" in prompt
    assert "out of range" not in prompt
