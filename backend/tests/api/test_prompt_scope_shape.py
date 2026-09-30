"""The prompt path under the Scope's new shape (PFB-01).

`POST /ai/*/prompt` resolves a `scope` into the prompt's posts block with the
same `list_feed` the Posts feed pages through, sized first by the same
`count_posts_in_scope`. PFB-01 respelled the filter half that scope carries —
media became a set, the order and the grouping two fields, the cap mode
`ordered` — and it is only a prefactor if an old spelling and its new one
assemble **the same Posts in the same order**.

So each old value is asserted against its new equivalent through the wire, and
the new block against the feed's own page for the same Scope, which is the
claim the prompt path exists to keep: a Summary reads exactly what the feed
shows.

## Watched to fail

* drop the legacy mapping from `PromptScopeInput` -> every parity case 422s
* stop passing `group_by_channel` to `list_feed` -> the grouped case
* rank the `ordered` cap by `newest` whatever the order -> the oldest case
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from app.prompts.posts import format_posts_for_prompt
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = settings.API_V1_STR
MINUTE_MS = 60_000
CHANNELS = ["alpha", "beta"]
WINDOW = {"mode": "fixed", "start": 0, "end": 9_000 * MINUTE_MS}


def _seed() -> None:
    """Two channels whose Posts interleave in time, one of them with a photo."""
    rows: list[tuple[str, int, int, dict[str, Any] | None, str | None]] = [
        ("alpha", 1, 1_000, None, "fa"),
        ("beta", 2, 1_500, {"kinds": ["photo"]}, "en"),
        ("alpha", 3, 2_000, {"kinds": ["photo"]}, "fa"),
        ("beta", 4, 2_500, None, "fa"),
        ("alpha", 5, 3_000, None, None),
        ("beta", 6, 3_500, {"kinds": ["video"]}, "fa"),
    ]
    with Session(engine) as session:
        for channel_name, post_id, minute, media, language in rows:
            session.add(
                Post(
                    channel_name=channel_name,
                    post_id=post_id,
                    text=f"{channel_name} post {post_id}",
                    timestamp=minute * MINUTE_MS,
                    media=media,
                    language=language,
                )
            )
        session.commit()
        follow_channels(session, *CHANNELS)


def _prompt(client: TestClient, headers: dict[str, str], **scope: Any) -> Any:
    return client.post(
        f"{PREFIX}/ai/summary/prompt",
        headers=headers,
        json={
            "channels": CHANNELS,
            "language": "English",
            "postsText": "",
            "scope": {"window": WINDOW, **scope},
        },
    )


def _prompt_text(client: TestClient, headers: dict[str, str], **scope: Any) -> str:
    response = _prompt(client, headers, **scope)
    assert response.status_code == 200, response.text
    return str(response.json()["prompt"])


def _feed_block(client: TestClient, headers: dict[str, str], **scope: Any) -> str:
    response = client.post(
        f"{PREFIX}/data/posts",
        headers=headers,
        json={"channelNames": CHANNELS, "window": WINDOW, **scope},
    )
    assert response.status_code == 200, response.text
    return format_posts_for_prompt(list(response.json()))


#: Each pre-PFB-01 prompt scope beside the new spelling that must assemble the
#: same block. The cap cases carry a cap so the mode is actually exercised.
EQUIVALENTS: list[tuple[str, dict[str, Any], dict[str, Any]]] = [
    ("media all", {"media": "all"}, {"media": []}),
    ("media one kind", {"media": "photo"}, {"media": ["photo"]}),
    ("sort time", {"sort": "time"}, {"sort": "newest"}),
    (
        "sort channel_time",
        {"sort": "channel_time"},
        {"sort": "newest", "groupByChannel": True},
    ),
    (
        "cap latest",
        {"maxPerChannel": 2, "maxPerChannelMode": "latest"},
        {"maxPerChannel": 2, "maxPerChannelMode": "ordered"},
    ),
    (
        "everything at once",
        {
            "media": "photo",
            "maxPerChannel": 1,
            "maxPerChannelMode": "latest",
            "sort": "channel_time",
        },
        {
            "media": ["photo"],
            "maxPerChannel": 1,
            "maxPerChannelMode": "ordered",
            "sort": "newest",
            "groupByChannel": True,
        },
    ),
]


@pytest.mark.parametrize(
    ("old", "new"),
    [(old, new) for _, old, new in EQUIVALENTS],
    ids=[name for name, _, _ in EQUIVALENTS],
)
def test_an_old_scope_assembles_what_its_new_spelling_does(
    client: TestClient, old: dict[str, Any], new: dict[str, Any]
) -> None:
    headers = get_superuser_token_headers(client)
    _seed()

    before = _prompt_text(client, headers, **old)
    after = _prompt_text(client, headers, **new)
    block = _feed_block(client, headers, **new)

    assert block, "an empty block would make the parity vacuous"
    assert before == after
    assert block in after


def test_grouped_assembles_channel_by_channel_in_the_feeds_order(
    client: TestClient,
) -> None:
    """Grouping reaches the prompt as it reaches the feed, not only the record."""
    headers = get_superuser_token_headers(client)
    _seed()

    grouped = _prompt_text(client, headers, groupByChannel=True)
    ungrouped = _prompt_text(client, headers)

    assert _feed_block(client, headers, groupByChannel=True) in grouped
    # beta holds the newest Post, so its whole block comes first (PFB-02).
    assert grouped.index("beta post 2") < grouped.index("alpha post 5")
    assert ungrouped.index("alpha post 5") < ungrouped.index("beta post 4")


def test_the_filter_bar_scope_assembles_what_the_feed_shows(
    client: TestClient,
) -> None:
    """Languages, the order, grouping and the cap reach the prompt together.

    Oldest first under a cap of two keeps each channel's two earliest Posts in
    Persian: alpha 1 and 3, beta 4 and 6, the unread alpha 5 matching nothing.
    Grouped, alpha's block leads because its earliest Post is the earliest.
    """
    headers = get_superuser_token_headers(client)
    _seed()
    scope = {
        "languages": ["fa"],
        "sort": "oldest",
        "groupByChannel": True,
        "maxPerChannel": 2,
        "maxPerChannelMode": "ordered",
    }

    prompt = _prompt_text(client, headers, **scope)

    assert _feed_block(client, headers, **scope) in prompt
    order = ["alpha post 1", "alpha post 3", "beta post 4", "beta post 6"]
    assert [prompt.index(text) for text in order] == sorted(
        prompt.index(text) for text in order
    )
    assert "beta post 2" not in prompt
    assert "alpha post 5" not in prompt


def test_oldest_assembles_oldest_first_and_caps_each_channels_earliest(
    client: TestClient,
) -> None:
    """Nothing in today's panel sends it; the prompt path already answers it."""
    headers = get_superuser_token_headers(client)
    _seed()
    scope = {"sort": "oldest", "maxPerChannel": 2, "maxPerChannelMode": "ordered"}

    prompt = _prompt_text(client, headers, **scope)

    assert _feed_block(client, headers, **scope) in prompt
    order = [f"{c} post {n}" for c, n in [("alpha", 1), ("beta", 2), ("alpha", 3)]]
    assert [prompt.index(text) for text in order] == sorted(
        prompt.index(text) for text in order
    )
    # Each channel's newest Posts fall outside an oldest-first cap of two.
    assert "alpha post 5" not in prompt
    assert "beta post 6" not in prompt


@pytest.mark.parametrize(
    "scope",
    [
        {"sort": "relevance"},
        {"maxPerChannelMode": "alphabetical"},
        {"media": ["nonsense"]},
        {"languages": "fa"},
    ],
    ids=lambda scope: next(iter(scope)),
)
def test_a_value_this_server_does_not_implement_is_refused(
    client: TestClient, scope: dict[str, Any]
) -> None:
    """A prompt over a Scope nobody can record is the one thing not to build."""
    headers = get_superuser_token_headers(client)
    assert _prompt(client, headers, **scope).status_code == 422
