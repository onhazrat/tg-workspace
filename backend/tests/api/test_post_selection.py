"""The Post selection on the posts reads, with two live accounts (PTR-05).

`POST /data/posts`, `/data/posts/lookup` and `/data/posts/counts` take the
Post selection beside the Post filter: an ordered list of Selection rules and
Picks, last step to reach a Post wins. Every Post comes back with `selected`,
and the counts report the selected Posts per Channel, filters aside. The
Operator follows `ps_a` and `ps_b`, the second account `ps_b` and `ps_c`:

| Post | channel | language | window |
|------|---------|----------|--------|
| 1    | ps_a    | fa       | early  |
| 2    | ps_a    | en       | early  |
| 3    | ps_a    | fa       | early  |
| 4    | ps_b    | fa       | late   |
| 5    | ps_b    | en       | late   |
| 6    | ps_c    | fa       | late   |

Ids run in time order, so the feed's newest-first order is the ids descending.

## Watched to fail

* evaluate the steps first to last (first step wins) -> 9 cases, the
  both-orders case among them
* drop the follow scope from the read that freezes the references -> the
  frozen-references case, which then holds the foreign Post 6

PTR-06's tools, each watched to fail the same way:

* order the selected Posts last -> the 5 Selected first cases
* drop `onlySelected`'s predicate -> 2 cases
* ignore a rule's `not` -> the negated-rule case
* count every shown Post as selected -> the Venn's count case
* count a value's Posts as all selected, Languages or Types and media -> the
  facets case
"""

from __future__ import annotations

import time
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.core.config import settings
from app.core.db import engine
from app.models import User
from app.models_tg import Post
from app.schemas.posts import PostResponse
from tests.utils.tenancy import follow_channels
from tests.utils.user import create_random_user, user_authentication_headers
from tests.utils.utils import get_superuser_token_headers

PREFIX = f"{settings.API_V1_STR}/data"
MINUTE = 60_000
HOUR = 60 * MINUTE
BASE = (int(time.time() * 1000) // MINUTE - 200 * 60) * MINUTE
ALL = ["ps_a", "ps_b", "ps_c"]

#: (channel, id, language, window)
CORPUS = [
    ("ps_a", 1, "fa", "early"),
    ("ps_a", 2, "en", "early"),
    ("ps_a", 3, "fa", "early"),
    ("ps_b", 4, "fa", "late"),
    ("ps_b", 5, "en", "late"),
    ("ps_c", 6, "fa", "late"),
]


def _timestamp(post_id: int, window: str) -> int:
    return BASE + (0 if window == "early" else 10 * HOUR) + post_id * MINUTE


EARLY = {"mode": "fixed", "start": BASE, "end": BASE + 5 * HOUR}
LATE = {"mode": "fixed", "start": BASE + 5 * HOUR, "end": BASE + 20 * HOUR}
BOTH = {"mode": "fixed", "start": BASE, "end": BASE + 20 * HOUR}


@pytest.fixture
def other(client: TestClient) -> Iterator[tuple[uuid.UUID, dict[str, str]]]:
    with Session(engine) as session:
        user = create_random_user(session)
        from app import crud
        from app.models import UserUpdate

        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="ptr05-pass")
        )
        user_id, email = user.id, user.email
    headers = user_authentication_headers(
        client=client, email=email, password="ptr05-pass"
    )
    yield user_id, headers
    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == user_id))
        session.commit()


@pytest.fixture
def seeded(
    client: TestClient, other: tuple[uuid.UUID, dict[str, str]]
) -> tuple[dict[str, str], dict[str, str]]:
    """Write the corpus and both accounts' follows; answer both accounts' headers."""
    other_id, other_headers = other
    with Session(engine) as session:
        for channel, post_id, language, window in CORPUS:
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=f"{channel} post {post_id}",
                    timestamp=_timestamp(post_id, window),
                    language=language,
                )
            )
        session.commit()
        follow_channels(session, "ps_a", "ps_b")
        follow_channels(session, "ps_b", "ps_c", user_id=other_id)
        session.commit()
    return get_superuser_token_headers(client), other_headers


# ---- The steps, as the browser sends them -----------------------------------


def lang(value: str) -> dict[str, Any]:
    return {
        "kind": "group",
        "op": "and",
        "children": [
            {"kind": "atom", "cond": {"type": "language", "value": value}},
        ],
    }


def rule(select: bool, tree: Any = None, **snapshot: Any) -> dict[str, Any]:
    return {"kind": "rule", "select": select, "filter": {"tree": tree, **snapshot}}


def pick(select: bool, channel: str, post_id: int) -> dict[str, Any]:
    return {"kind": "pick", "select": select, "channelName": channel, "postId": post_id}


def _selected(
    client: TestClient,
    headers: dict[str, str],
    selection: Any = None,
    *,
    window: dict[str, Any] = BOTH,
    **body: Any,
) -> dict[int, bool]:
    """Each Post the feed shows, and whether it is selected."""
    if selection is not None:
        body["selection"] = selection
    response = client.post(
        f"{PREFIX}/posts",
        json={"channelNames": ALL, "window": window, **body},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return {row["id"]: row["selected"] for row in response.json()}


def _chosen(flags: dict[int, bool]) -> list[int]:
    return [post_id for post_id, chosen in flags.items() if chosen]


# ---- Evaluation --------------------------------------------------------------


def test_the_default_selects_every_post(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    assert _selected(client, operator) == {5: True, 4: True, 3: True, 2: True, 1: True}
    assert _chosen(_selected(client, operator, [rule(True)])) == [5, 4, 3, 2, 1]


def test_no_step_reaching_a_post_leaves_it_unselected(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    assert _chosen(_selected(client, operator, [])) == []
    assert _chosen(_selected(client, operator, [pick(True, "ps_a", 2)])) == [2]


@pytest.mark.parametrize(
    ("steps", "chosen"),
    [
        # The Pick comes last, so it decides Post 1 against the rule.
        ([rule(True), rule(False, lang("fa")), pick(True, "ps_a", 1)], [5, 2, 1]),
        # The rule comes last and reaches Post 1, so it overrides the Pick.
        ([rule(True), pick(True, "ps_a", 1), rule(False, lang("fa"))], [5, 2]),
        ([rule(False), pick(True, "ps_a", 3), rule(True, lang("en"))], [5, 3, 2]),
        ([rule(True), pick(False, "ps_a", 2), pick(True, "ps_a", 2)], [5, 4, 3, 2, 1]),
        ([rule(True), pick(True, "ps_a", 2), pick(False, "ps_a", 2)], [5, 4, 3, 1]),
    ],
    ids=["pick-last", "rule-last", "rule-pick-rule", "pick-repick", "pick-unpick"],
)
def test_the_last_step_to_reach_a_post_decides_it(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    steps: list[dict[str, Any]],
    chosen: list[int],
) -> None:
    operator, _other = seeded

    flags = _selected(client, operator, steps)

    assert _chosen(flags) == chosen
    assert sorted(flags) == [1, 2, 3, 4, 5], "a selection never hides a Post"


def test_a_select_all_after_anything_selects_everything_as_sent(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """The server evaluates the steps as sent; compaction is the browser's."""
    operator, _other = seeded
    steps = [rule(False, lang("fa")), pick(False, "ps_b", 5), rule(True)]

    assert _chosen(_selected(client, operator, steps)) == [5, 4, 3, 2, 1]
    assert _chosen(_selected(client, operator, [*steps, rule(False)])) == []


def test_a_rule_is_applied_again_in_another_window_and_a_pick_stays_put(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    steps = [rule(True), rule(False, lang("fa")), pick(False, "ps_a", 2)]

    early = _selected(client, operator, steps, window=EARLY)
    late = _selected(client, operator, steps, window=LATE)

    assert early == {3: False, 2: False, 1: False}
    # Post 4 did not exist in the first window and the rule reaches it here;
    # the Pick on Post 2 reaches nothing in this one.
    assert late == {5: True, 4: False}


def test_a_rule_keeps_its_keyword_and_its_filter_not_the_feeds(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    steps = [rule(True, keyword="post 3")]

    # The feed shows only `en`; the rule still reaches Post 3, which it hides.
    flags = _selected(client, operator, steps, filter=lang("en"))

    assert flags == {5: False, 2: False}
    counts = client.post(
        f"{PREFIX}/posts/counts",
        json={"channelNames": ALL, "window": BOTH, "selection": steps},
        headers=operator,
    ).json()
    assert counts["selected"] == {"ps_a": 1}


def test_a_random_cap_rule_gives_the_same_posts_every_time(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    def capped(seed: int) -> list[int]:
        steps = [
            rule(True, maxPerChannel=1, maxPerChannelMode="random", seed=seed),
        ]
        return _chosen(_selected(client, operator, steps, window=EARLY))

    picks = {seed: capped(seed) for seed in range(12)}

    assert all(len(chosen) == 1 for chosen in picks.values())
    assert all(capped(seed) == chosen for seed, chosen in picks.items())
    assert len({tuple(chosen) for chosen in picks.values()}) > 1, (
        "the seed picks the Posts"
    )


def test_an_ordered_cap_rule_follows_its_own_order(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    steps = [rule(True, maxPerChannel=1, sort="oldest")]

    # The first Post of each Channel in the rule's order, whatever the feed's.
    assert _chosen(_selected(client, operator, steps, sort="newest")) == [4, 1]


# ---- Bounds ------------------------------------------------------------------


def test_past_the_pick_cap_the_request_is_refused(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    at_cap = [pick(False, "ps_a", n) for n in range(5000)]

    assert _chosen(_selected(client, operator, [rule(True), *at_cap])) == [5, 4]
    response = client.post(
        f"{PREFIX}/posts",
        json={"channelNames": ALL, "selection": [*at_cap, pick(False, "ps_a", 9)]},
        headers=operator,
    )
    assert response.status_code == 422
    assert "Selection rule" in response.text


def test_the_number_of_rules_and_each_tree_are_bounded(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    deep: Any = lang("fa")
    for _ in range(7):
        deep = {"kind": "group", "op": "and", "children": [deep]}

    for selection in ([rule(True)] * 51, [rule(True, deep)]):
        response = client.post(
            f"{PREFIX}/posts",
            json={"channelNames": ALL, "selection": selection},
            headers=operator,
        )
        assert response.status_code == 422


def test_an_unknown_step_is_refused(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    for step in (
        {"kind": "invert", "select": True},
        {**rule(True), "extra": 1},
        rule(True, views=">10"),
    ):
        response = client.post(
            f"{PREFIX}/posts",
            json={"channelNames": ALL, "selection": [step]},
            headers=operator,
        )
        assert response.status_code == 422, step


# ---- Tenancy -----------------------------------------------------------------


def test_a_pick_or_rule_naming_a_foreign_channel_reaches_nothing(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    channel_c = {
        "kind": "group",
        "op": "and",
        "children": [{"kind": "atom", "cond": {"type": "channel", "value": "ps_c"}}],
    }
    steps = [pick(True, "ps_c", 6), rule(True, channel_c), pick(True, "ps_a", 1)]

    assert _selected(client, operator, steps) == {
        5: False,
        4: False,
        3: False,
        2: False,
        1: True,
    }
    counts = client.post(
        f"{PREFIX}/posts/counts",
        json={"channelNames": ALL, "window": BOTH, "selection": steps},
        headers=operator,
    ).json()
    assert counts["selected"] == {"ps_a": 1}
    # The account that follows `ps_c` gets its Post, and nothing of `ps_a`.
    assert _chosen(_selected(client, other, steps)) == [6]


# ---- Counts and lookup ------------------------------------------------------


def test_counts_report_the_selected_beside_the_shown(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    body = {
        "channelNames": ALL,
        "window": BOTH,
        "filter": lang("fa"),
        "selection": [rule(True), pick(False, "ps_a", 1), pick(False, "ps_b", 5)],
    }

    mine = client.post(f"{PREFIX}/posts/counts", json=body, headers=operator).json()
    theirs = client.post(f"{PREFIX}/posts/counts", json=body, headers=other).json()

    assert mine["counts"] == {"ps_a": 2, "ps_b": 1}
    assert mine["selected"] == {"ps_a": 2, "ps_b": 1}
    assert theirs["selected"] == {"ps_b": 1, "ps_c": 1}
    default = client.post(
        f"{PREFIX}/posts/counts", json={"channelNames": ALL}, headers=operator
    ).json()
    assert default["selected"] == {"ps_a": 3, "ps_b": 2}


def test_the_lookup_flags_each_post_with_the_selection(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    refs = [{"channelName": "ps_a", "postId": n} for n in (1, 2)]
    refs.append({"channelName": "ps_c", "postId": 6})

    response = client.post(
        f"{PREFIX}/posts/lookup",
        json={
            "posts": refs,
            "channelNames": ALL,
            "window": BOTH,
            "selection": [rule(True), rule(False, lang("en"))],
        },
        headers=operator,
    )

    assert response.status_code == 200, response.text
    assert {row["id"]: row["selected"] for row in response.json()} == {
        1: True,
        2: False,
    }
    bare = client.post(
        f"{PREFIX}/posts/lookup", json={"posts": refs[:1]}, headers=operator
    ).json()
    assert bare[0]["selected"] is True


def test_the_reads_add_selected_and_nothing_else(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """The projection: one new key on a Post row, two on the counts."""
    operator, _other = seeded
    post_keys = {f.alias or name for name, f in PostResponse.model_fields.items()}

    feed = client.post(
        f"{PREFIX}/posts", json={"channelNames": ALL}, headers=operator
    ).json()
    lookup = client.post(
        f"{PREFIX}/posts/lookup",
        json={"posts": [{"channelName": "ps_a", "postId": 1}]},
        headers=operator,
    ).json()
    counts = client.post(
        f"{PREFIX}/posts/counts", json={"channelNames": ALL}, headers=operator
    ).json()

    assert {frozenset(row) for row in [*feed, *lookup]} == {
        frozenset(post_keys | {"selected"})
    }
    assert set(counts) == {"counts", "selected", "selectedShown", "tooNewToJudge"}


# ---- Actions -----------------------------------------------------------------

STEPS = [
    rule(True),
    rule(False, lang("fa")),
    pick(True, "ps_a", 3),
    pick(True, "ps_c", 6),
]
#: What `STEPS` selects for the Operator: the `en` Posts, and Post 3 picked
#: back. The Pick on `ps_c` names a Channel the Operator does not follow.
SELECTED = [5, 3, 2]


def test_a_prompt_covers_exactly_the_selection(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Never what the filter shows: the body carries no filter at all."""
    operator, _other = seeded

    response = client.post(
        f"{settings.API_V1_STR}/ai/summary/prompt",
        json={"channels": ALL, "scope": {"window": BOTH, "selection": STEPS}},
        headers=operator,
    )

    assert response.status_code == 200, response.text
    prompt = response.json()["prompt"]
    assert [n for n in range(1, 7) if f"post {n}" in prompt] == sorted(SELECTED)


def test_a_summary_freezes_the_steps_and_every_post_they_reached(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded
    summary_id = str(uuid.uuid4())

    created = client.post(
        f"{PREFIX}/summaries",
        json={
            "id": summary_id,
            "scope": {"channels": ALL, "window": BOTH, "selection": STEPS},
        },
        headers=operator,
    )
    assert created.status_code == 200, created.text
    detail = client.get(f"{PREFIX}/summaries/{summary_id}", headers=operator).json()

    assert [ref["postId"] for ref in detail["scope"]["posts"]] == SELECTED
    assert detail["scope"]["scopedPostCount"] == len(SELECTED)
    assert detail["scope"]["selection"][3]["channelName"] == "ps_c"


def test_a_discovery_report_covers_exactly_the_selection(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    response = client.post(
        f"{PREFIX}/discover/candidates",
        json={"channelNames": ALL, "window": BOTH, "selection": STEPS},
        headers=operator,
    )

    assert response.status_code == 200, response.text
    assert response.json()["postsInScope"] == len(SELECTED)


# ---- The selection tools (PTR-06) -------------------------------------------


def _feed(client: TestClient, headers: dict[str, str], **body: Any) -> list[int]:
    response = client.post(
        f"{PREFIX}/posts",
        json={"channelNames": ALL, "window": BOTH, **body},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return [row["id"] for row in response.json()]


#: Selects the `en` Posts, 5 and 2, and nothing else.
EN_ONLY = [rule(True), rule(False, lang("fa"))]


@pytest.mark.parametrize(
    ("view", "ordered"),
    [
        ({"sort": "newest"}, [5, 2, 4, 3, 1]),
        ({"sort": "oldest"}, [2, 5, 1, 3, 4]),
        # Grouped: each part places its own blocks by the feed's order.
        ({"sort": "newest", "groupByChannel": True}, [5, 2, 4, 3, 1]),
        ({"sort": "oldest", "groupByChannel": True}, [2, 5, 1, 3, 4]),
        # Under a cap the parts hold only what the cap shows: 5 and 3.
        ({"sort": "newest", "maxPerChannel": 1}, [5, 3]),
    ],
    ids=["newest", "oldest", "grouped-newest", "grouped-oldest", "capped"],
)
def test_selected_first_lists_the_selected_before_the_rest_in_the_feeds_order(
    client: TestClient,
    seeded: tuple[dict[str, str], dict[str, str]],
    view: dict[str, Any],
    ordered: list[int],
) -> None:
    operator, _other = seeded

    whole = _feed(client, operator, selection=EN_ONLY, selectedFirst=True, **view)
    pages = [
        _feed(
            client,
            operator,
            selection=EN_ONLY,
            selectedFirst=True,
            limit=2,
            offset=offset,
            **view,
        )
        for offset in (0, 2, 4)
    ]

    assert whole == ordered
    assert [post_id for page in pages for post_id in page] == ordered
    assert sorted(_feed(client, operator, selection=EN_ONLY, **view)) == sorted(
        ordered
    ), "the switch reorders and hides nothing"


def test_only_selected_keeps_the_selected_posts_the_filter_shows(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, other = seeded
    steps = [rule(True), pick(False, "ps_a", 3)]

    assert _feed(
        client, operator, selection=steps, onlySelected=True, filter=lang("fa")
    ) == [4, 1]
    # The cap shows 5 and 3; Post 1 is selected and not shown, so not taken.
    assert (
        _feed(
            client,
            operator,
            selection=[rule(False), pick(True, "ps_a", 1)],
            onlySelected=True,
            maxPerChannel=1,
        )
        == []
    )
    # Another account's copy reads its own Follows; its Pick on ps_a is nothing.
    assert (
        _feed(
            client,
            other,
            selection=[rule(False), pick(True, "ps_a", 1)],
            onlySelected=True,
        )
        == []
    )


def test_only_selected_is_bounded_at_the_page_limit(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    operator, _other = seeded

    assert len(_feed(client, operator, onlySelected=True, limit=5000)) == 5
    response = client.post(
        f"{PREFIX}/posts",
        json={"channelNames": ALL, "onlySelected": True, "limit": 5001},
        headers=operator,
    )
    assert response.status_code == 422


def test_counts_report_the_selected_posts_the_filter_shows(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """The Venn's middle region; the other two are subtractions."""
    operator, _other = seeded

    def counts(**body: Any) -> Any:
        response = client.post(
            f"{PREFIX}/posts/counts",
            json={"channelNames": ALL, "window": BOTH, **body},
            headers=operator,
        )
        assert response.status_code == 200, response.text
        return response.json()

    filtered = counts(filter=lang("fa"), selection=[rule(True), pick(False, "ps_a", 1)])
    assert filtered["counts"] == {"ps_a": 2, "ps_b": 1}
    assert filtered["selected"] == {"ps_a": 2, "ps_b": 2}
    assert filtered["selectedShown"] == {"ps_a": 1, "ps_b": 1}

    picked = [rule(False), pick(True, "ps_a", 3)]
    # The cap keeps each Channel's first Post in the feed's order.
    assert counts(selection=picked, maxPerChannel=1)["selectedShown"] == {"ps_a": 1}
    assert (
        counts(selection=picked, maxPerChannel=1, sort="oldest")["selectedShown"] == {}
    )


def test_facets_report_the_selected_posts_of_each_value(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """Over the window, filters aside, as a tick on a row ignores the filter."""
    operator, other = seeded

    def facets(
        headers: dict[str, str], key: str = "languages", **body: Any
    ) -> dict[str, list[int]]:
        response = client.post(
            f"{PREFIX}/posts/facets",
            json={"channelNames": ALL, "window": BOTH, **body},
            headers=headers,
        )
        assert response.status_code == 200, response.text
        return {
            row["value"]: [row["selected"], row["count"]]
            for row in response.json()[key]
            if row["count"]
        }

    assert facets(operator) == {"fa": [3, 3], "en": [2, 2]}
    assert facets(operator, selection=EN_ONLY) == {"fa": [0, 3], "en": [2, 2]}
    assert facets(operator, selection=[rule(False), pick(True, "ps_b", 4)]) == {
        "fa": [1, 3],
        "en": [0, 2],
    }
    assert facets(other, selection=EN_ONLY) == {"fa": [0, 2], "en": [1, 1]}
    # Every Post is an original with no media, so those rows count all five.
    assert facets(operator, "types", selection=EN_ONLY) == {"original": [2, 5]}
    assert facets(operator, "media", selection=EN_ONLY) == {"text_only": [2, 5]}


def test_a_negated_rule_reaches_every_post_its_filter_does_not(
    client: TestClient, seeded: tuple[dict[str, str], dict[str, str]]
) -> None:
    """ "Keep only shown" deselects NOT F, which a keyword or cap cannot be inverted
    into inside the tree."""
    operator, _other = seeded

    def negated(select: bool, tree: Any = None, **snapshot: Any) -> dict[str, Any]:
        return {**rule(select, tree, **snapshot), "not": True}

    assert _chosen(
        _selected(client, operator, [rule(True), negated(False, lang("fa"))])
    ) == [
        4,
        3,
        1,
    ]
    assert _chosen(
        _selected(client, operator, [rule(True), negated(False, keyword="post 3")])
    ) == [3]
    assert _chosen(
        _selected(client, operator, [rule(True), negated(False, maxPerChannel=1)])
    ) == [5, 3]
    # NOT of everything is nothing.
    assert _chosen(_selected(client, operator, [rule(True), negated(False)])) == [
        5,
        4,
        3,
        2,
        1,
    ]
