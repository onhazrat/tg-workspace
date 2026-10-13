"""Channel posts in window and Channel posts in filtered window (PTI-02).

Two Post filter Conditions bound how busy a Post's Channel is. `channel_posts`
counts every Post the Channel has in the Analysis window; `channel_posts_filtered`
counts only the Posts the rest of the Post filter and the keyword keep, every
Channel posts Condition set aside, before the per-Channel cap. The Operator
follows all three Channels:

| Channel  | in the window W                        | in the old window |
|----------|----------------------------------------|-------------------|
| cp_busy  | 6: ids 1-2 original, 3-6 forwarded     |                   |
| cp_mid   | 3: id 11 original, 12-13 forwarded     | 4: ids 14-17      |
| cp_quiet | 1: id 21 original                      |                   |

"news" is in the text of ids 1, 3, 4 and 11.

## Watched to fail

* count over every Post ever, not the window -> `test_the_window_decides`
* count the filtered posts without the keyword -> `test_the_keyword_is_counted`
* count after the cap -> `test_the_cap_is_ignored`
* prune nothing under NOT -> `test_set_aside_under_or_and_not`
* bin the filtered measure without the filter -> the filtered histogram
* treat a Channel with none of the counted Posts as outside every bound ->
  `test_a_channel_counting_zero_is_inside_a_bound_from_zero`
"""

from __future__ import annotations

import time
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from tests.utils.tenancy import follow_channels
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
HOUR = 3_600_000
BASE = (int(time.time() * 1000) // HOUR - 500) * HOUR
W = {"mode": "fixed", "start": BASE, "end": BASE + 10 * HOUR}
OLD = {"mode": "fixed", "start": BASE - 100 * HOUR, "end": BASE - 90 * HOUR}

#: (channel, id, hours after BASE, forwarded, text)
CORPUS: list[tuple[str, int, int, bool, str]] = [
    ("cp_busy", 1, 1, False, "news"),
    ("cp_busy", 2, 1, False, "x"),
    ("cp_busy", 3, 2, True, "news"),
    ("cp_busy", 4, 2, True, "news"),
    ("cp_busy", 5, 3, True, "x"),
    ("cp_busy", 6, 3, True, "x"),
    ("cp_mid", 11, 1, False, "news"),
    ("cp_mid", 12, 2, True, "x"),
    ("cp_mid", 13, 3, True, "x"),
    *(("cp_mid", i, -95, False, "x") for i in (14, 15, 16, 17)),
    ("cp_quiet", 21, 4, False, "x"),
]


@pytest.fixture
def operator(client: TestClient) -> dict[str, str]:
    with Session(engine) as session:
        for channel, post_id, hours, forwarded, text in CORPUS:
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=f"{text} {post_id}",
                    timestamp=BASE + hours * HOUR + post_id * 1000,
                    forwarded_from="elsewhere" if forwarded else None,
                )
            )
        session.commit()
        follow_channels(session, "cp_busy", "cp_mid", "cp_quiet")
        session.commit()
    return get_superuser_token_headers(client)


def atom(cond: dict[str, Any], *, negated: bool = False) -> dict[str, Any]:
    return {"kind": "atom", "id": "a", "not": negated, "cond": cond}


def group(op: str, *children: dict[str, Any], negated: bool = False) -> dict[str, Any]:
    return {
        "kind": "group",
        "id": "g",
        "op": op,
        "not": negated,
        "children": list(children),
    }


def posts(minimum: float | None = None, maximum: float | None = None) -> Any:
    return atom({"type": "channel_posts", "min": minimum, "max": maximum})


def filtered(
    minimum: float | None = None, maximum: float | None = None, *, negated: bool = False
) -> Any:
    cond = {"type": "channel_posts_filtered", "min": minimum, "max": maximum}
    return atom(cond, negated=negated)


ORIGINAL = atom({"type": "type", "value": "original"})
FORWARDED = atom({"type": "type", "value": "forwarded"})


def feed(
    client: TestClient, headers: dict[str, str], tree: Any, **body: Any
) -> list[tuple[str, int]]:
    response = client.post(
        f"{PREFIX}/posts",
        json={"window": W, "filter": tree, **body},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return sorted((p["channelName"], p["id"]) for p in response.json())


def channels(
    client: TestClient, headers: dict[str, str], *conds: Any, **body: Any
) -> set[str]:
    return {c for c, _ in feed(client, headers, group("and", *conds), **body)}


# ---- Channel posts in window -------------------------------------------------


def test_both_ends_and_between(client: TestClient, operator: dict[str, str]) -> None:
    assert channels(client, operator, posts(maximum=3)) == {"cp_mid", "cp_quiet"}
    assert channels(client, operator, posts(minimum=6)) == {"cp_busy"}
    assert channels(client, operator, posts(2, 5)) == {"cp_mid"}
    # Every Post of a kept Channel, not only one.
    assert len(feed(client, operator, group("and", posts(minimum=6)))) == 6


def test_a_fraction_is_accepted_and_rounded_inward(
    client: TestClient, operator: dict[str, str]
) -> None:
    """A stored fractional bound keeps working: 2.5..3.5 is 3..3."""
    assert channels(client, operator, posts(2.5, 3.5)) == {"cp_mid"}
    # No whole number between the ends keeps nothing, and is not refused.
    assert channels(client, operator, posts(3.2, 3.8)) == set()


def test_the_window_decides(client: TestClient, operator: dict[str, str]) -> None:
    """cp_mid is quiet in W and busy in the old window."""
    assert channels(client, operator, posts(minimum=4)) == {"cp_busy"}
    assert channels(client, operator, posts(minimum=4), window=OLD) == {"cp_mid"}
    assert channels(client, operator, posts(maximum=3), window=OLD) == set()


def test_inside_a_selection_rule_it_counts_in_the_window_applied_in(
    client: TestClient, operator: dict[str, str]
) -> None:
    rule = {
        "kind": "rule",
        "select": True,
        "filter": {"tree": group("and", posts(minimum=4))},
    }

    def selected(window: dict[str, Any]) -> dict[str, int]:
        response = client.post(
            f"{PREFIX}/posts/counts",
            json={"window": window, "selection": [rule]},
            headers=operator,
        )
        assert response.status_code == 200, response.text
        body: dict[str, int] = response.json()["selected"]
        return body

    assert selected(W) == {"cp_busy": 6}
    assert selected(OLD) == {"cp_mid": 4}


# ---- Channel posts in filtered window ----------------------------------------


def test_the_original_example(client: TestClient, operator: dict[str, str]) -> None:
    """Under "Type: Original" cp_busy counts its 2 originals, not its 6 Posts."""
    assert feed(client, operator, group("and", ORIGINAL, filtered(maximum=1))) == [
        ("cp_mid", 11),
        ("cp_quiet", 21),
    ]
    assert feed(client, operator, group("and", ORIGINAL, posts(maximum=1))) == [
        ("cp_quiet", 21)
    ]
    assert channels(client, operator, ORIGINAL, filtered(minimum=2)) == {"cp_busy"}


def test_set_aside_under_or_and_not(
    client: TestClient, operator: dict[str, str]
) -> None:
    """Pruned, the tree is "original" wherever the Condition sat: 2, 1, 1."""
    # OR(original, NOT filtered >= 2): cp_busy's originals, all of cp_mid and cp_quiet.
    got = feed(
        client, operator, group("or", ORIGINAL, filtered(minimum=2, negated=True))
    )
    assert got == [
        ("cp_busy", 1),
        ("cp_busy", 2),
        ("cp_mid", 11),
        ("cp_mid", 12),
        ("cp_mid", 13),
        ("cp_quiet", 21),
    ]
    # NOT(AND(forwarded, filtered >= 2)) prunes to NOT forwarded, so cp_busy
    # counts 2 and its forwarded Posts are hidden; the rest all pass.
    tree = group("and", group("and", FORWARDED, filtered(minimum=2), negated=True))
    assert feed(client, operator, tree) == [
        ("cp_busy", 1),
        ("cp_busy", 2),
        ("cp_mid", 11),
        ("cp_mid", 12),
        ("cp_mid", 13),
        ("cp_quiet", 21),
    ]


def test_a_channel_counting_zero_is_inside_a_bound_from_zero(
    client: TestClient, operator: dict[str, str]
) -> None:
    """cp_quiet has no forwarded Post, so it counts 0, and "at most 0" keeps it."""
    tree = group("or", FORWARDED, filtered(maximum=0))
    assert feed(client, operator, tree) == [
        ("cp_busy", 3),
        ("cp_busy", 4),
        ("cp_busy", 5),
        ("cp_busy", 6),
        ("cp_mid", 12),
        ("cp_mid", 13),
        ("cp_quiet", 21),
    ]


def test_the_keyword_is_counted(client: TestClient, operator: dict[str, str]) -> None:
    """With "news" cp_busy counts 3 and cp_mid 1."""
    tree = group("and", filtered(maximum=1))
    assert feed(client, operator, tree, keyword="news") == [("cp_mid", 11)]


def test_the_cap_is_ignored(client: TestClient, operator: dict[str, str]) -> None:
    """Capped at 1, cp_busy and cp_mid still count 6 and 3."""
    got = feed(client, operator, group("and", filtered(minimum=3)), maxPerChannel=1)
    assert [c for c, _ in got] == ["cp_busy", "cp_mid"]


# ---- The value histogram -----------------------------------------------------


def histogram(
    client: TestClient, headers: dict[str, str], measure: str, **body: Any
) -> dict[str, Any]:
    response = client.post(
        f"{PREFIX}/posts/value-histogram",
        json={"window": W, "measure": measure, **body},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    got: dict[str, Any] = response.json()
    return got


def test_channel_posts_histogram_counts_channels_by_window_count(
    client: TestClient, operator: dict[str, str]
) -> None:
    got = histogram(client, operator, "channel_posts")
    assert (got["measured"], got["total"], got["median"]) == (3, 3, 3)
    assert (got["edges"][0], got["edges"][32], got["log"]) == (1, 6, False)
    assert sum(got["bins"]) == 3
    # The filter and keyword are aside.
    aside = histogram(
        client, operator, "channel_posts", filter=group("and", ORIGINAL), keyword="news"
    )
    assert aside == got


def test_channel_posts_filtered_histogram_applies_the_filter(
    client: TestClient, operator: dict[str, str]
) -> None:
    tree = group("and", ORIGINAL, filtered(maximum=0))
    got = histogram(client, operator, "channel_posts_filtered", filter=tree)
    # Originals per Channel: 2, 1, 1; the Condition itself set aside.
    assert (got["measured"], got["total"], got["median"]) == (3, 3, 1)
    assert (got["edges"][0], got["edges"][32]) == (1, 2)
    # And the keyword: cp_busy 1, cp_mid 1, cp_quiet 0.
    got = histogram(
        client, operator, "channel_posts_filtered", filter=tree, keyword="news"
    )
    assert (got["edges"][0], got["edges"][32], got["median"]) == (0, 1, 1)
