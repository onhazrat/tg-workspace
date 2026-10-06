"""Shared parents and Shared children, over HTTP (DIR-07).

"Shared parents with" a set of picks keeps the Channels cited by the same
Channels that cite the picks; "Shared children with" keeps the Channels that
cite the same Channels the picks cite. Both read the citation pairs (ADR-028),
so the corpus below is written through `write_references`, and the browser
sends the picks as handles whatever it resolved them from (typed, ticked, the
Channels tab selection or every Follow).

Picks are `p1` and `p2` throughout.

| Channel | cites                                                     |
|---------|-----------------------------------------------------------|
| s1      | p1, x_a, x_b                                              |
| s2      | p2, x_a, x_b, x_c                                         |
| s3      | p1, x_a                                                   |
| g1..g6  | x_a (so x_a is cited by 9: a well-connected candidate)    |
| hub     | p1, x_c and 2,999 more (cites 3,001: an aggregator)       |
| p1      | t1, t2, hub_t                                             |
| p2      | t2, t3                                                    |
| y_a     | t1, t2, t3, z1..z6 (cites 9)                              |
| y_b     | t1, t2                                                    |
| y_c     | t3, hub_t                                                 |
| x_b     | t1, t2                                                    |
| 2,999   | hub_t (cited by 3,001: an aggregator)                     |

Shared parents (sources s1, s2, s3; hub skipped): x_a 3, x_b 2, x_c 1 (2 if
the hub counted), p1 2 and p2 1 (picks, never results).
Weighted, `shared / sqrt(cited_by * 3)`: x_b 2/sqrt(6) = 0.82 ahead of x_a
3/sqrt(27) = 0.58.

Shared children (targets t1, t2, t3; hub_t skipped): y_a 3, x_b 2, y_b 2,
y_c 1 (2 if hub_t counted), p1 2 and p2 2 (picks).
Weighted, `shared / sqrt(cites * 3)`: x_b and y_b 2/sqrt(6) = 0.82 ahead of
y_a 3/sqrt(27) = 0.58.

## Watched to fail

Each mutation was applied alone and this module went red:

* return the picks -> the picks case
* count the hub and hub_t -> the aggregators case
* skip a source on how often it is cited, a target on how many it cites ->
  the aggregators case
* drop the minimum (`HAVING`) -> the minimum case
* swap citing and cited in Shared children -> the children case
* sort by the shared count, not the weighted score -> the weighted cases
* the row's count present while the Condition is off -> the columns case
* the column reading the first Shared Condition whatever its relation -> the
  columns case
* "Why it's here" naming every citing Channel, not the shared ones -> the
  Why case
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services import directory_reads
from app.services.channel_directory import record_probe_result
from app.services.post_references import (
    Reference,
    SourcedReferences,
    write_references,
)
from tests.utils.utils import get_superuser_token_headers

DIRECTORY = f"{settings.API_V1_STR}/data/directory"
FILLER = 2_999

LISTED = ("p1", "p2", "x_a", "x_b", "x_c", "y_a", "y_b", "y_c")

CITES: dict[str, list[str]] = {
    "s1": ["p1", "x_a", "x_b"],
    "s2": ["p2", "x_a", "x_b", "x_c"],
    "s3": ["p1", "x_a"],
    **{f"g{i}": ["x_a"] for i in range(1, 7)},
    "hub": ["p1", "x_c", *(f"far{i}" for i in range(FILLER))],
    "p1": ["t1", "t2", "hub_t"],
    "p2": ["t2", "t3"],
    "y_a": ["t1", "t2", "t3", *(f"z{i}" for i in range(1, 7))],
    "y_b": ["t1", "t2"],
    "y_c": ["t3", "hub_t"],
    "x_b": ["t1", "t2"],
    **{f"fan{i}": ["hub_t"] for i in range(FILLER)},
}


def _seed() -> None:
    now = int(time.time() * 1000)
    with Session(engine) as session:
        for handle in LISTED:
            record_probe_result(
                session,
                handle,
                {
                    "isTelegramPage": True,
                    "kind": "channel",
                    "displayName": handle.upper(),
                },
            )
        write_references(
            session,
            [
                SourcedReferences(
                    source_chat_id=n + 1,
                    source_channel=source,
                    source_post_id=1,
                    timestamp=now,
                    references=[
                        Reference(target_handle=t, kind="mention") for t in targets
                    ],
                )
                for n, (source, targets) in enumerate(CITES.items())
            ],
            target_chat_ids={},
        )
        session.commit()


@pytest.fixture
def operator(client: TestClient) -> Iterator[dict[str, str]]:
    directory_reads.forget_cached_counts()
    _seed()
    yield get_superuser_token_headers(client)
    directory_reads.forget_cached_counts()


def shared(relation: str, *handles: str, min: int | None = None) -> dict[str, Any]:
    cond: dict[str, Any] = {"type": relation, "handles": list(handles)}
    if min is not None:
        cond["min"] = min
    return {"kind": "atom", "id": relation, "cond": cond}


def root(*children: dict[str, Any]) -> dict[str, Any]:
    return {"kind": "group", "id": "root", "op": "and", "children": list(children)}


PICKS = ("p1", "@P2")


def _list(client: TestClient, headers: dict[str, str], **body: Any) -> dict[str, Any]:
    response = client.post(f"{DIRECTORY}/list", json=body, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _found(
    client: TestClient, headers: dict[str, str], tree: Any, sort: str = "subscribers"
) -> list[str]:
    page = _list(client, headers, filter=tree, sort=sort, descending=False)
    return [r["handle"] for r in page["rows"]]


def test_shared_parents_are_cited_by_whoever_cites_the_picks(
    client: TestClient, operator: dict[str, str]
) -> None:
    # The default minimum is 2; equal sorts fall to the handle.
    assert _found(client, operator, root(shared("parents", *PICKS))) == ["x_a", "x_b"]


def test_shared_children_cite_what_the_picks_cite(
    client: TestClient, operator: dict[str, str]
) -> None:
    assert _found(client, operator, root(shared("children", *PICKS))) == [
        "x_b",
        "y_a",
        "y_b",
    ]


def test_the_minimum_sets_how_many_shared_channels_it_takes(
    client: TestClient, operator: dict[str, str]
) -> None:
    assert _found(client, operator, root(shared("parents", *PICKS, min=3))) == ["x_a"]
    assert _found(client, operator, root(shared("parents", *PICKS, min=1))) == [
        "x_a",
        "x_b",
        "x_c",
    ]
    assert _found(client, operator, root(shared("children", *PICKS, min=3))) == ["y_a"]
    assert _found(client, operator, root(shared("children", *PICKS, min=1))) == [
        "x_b",
        "y_a",
        "y_b",
        "y_c",
    ]


def test_both_on_keeps_what_passes_both(
    client: TestClient, operator: dict[str, str]
) -> None:
    tree = root(shared("parents", *PICKS), shared("children", *PICKS))
    assert _found(client, operator, tree) == ["x_b"]


def test_a_pick_is_never_a_result(client: TestClient, operator: dict[str, str]) -> None:
    """p1 is cited by two of the shared parents, and p1 and p2 cite two shared
    targets each: as picks they are left out, as anything else they count."""
    for relation in ("parents", "children"):
        found = _found(client, operator, root(shared(relation, *PICKS, min=1)))
        assert not {"p1", "p2"} & set(found)
    assert "p1" in _found(client, operator, root(shared("parents", "x_a", min=1)))
    assert {"p1", "p2"} <= set(
        _found(client, operator, root(shared("children", "y_a", min=1)))
    )


def test_aggregators_are_skipped(client: TestClient, operator: dict[str, str]) -> None:
    """The hub cites 3,001 Channels and hub_t is cited by 3,001: neither makes
    x_c or y_c a second shared Channel, so neither reaches the minimum of 2."""
    assert "x_c" not in _found(client, operator, root(shared("parents", *PICKS)))
    assert "y_c" not in _found(client, operator, root(shared("children", *PICKS)))


def test_no_picks_match_nothing(client: TestClient, operator: dict[str, str]) -> None:
    """A shared link opened with no ticks sends no picks: nothing matches, and
    the negation keeps everything."""
    assert _found(client, operator, root(shared("parents"))) == []
    tree = root({**shared("children"), "not": True})
    assert len(_found(client, operator, tree)) == len(LISTED)


@pytest.mark.parametrize(
    ("relation", "expected"),
    [
        ("parents", ["x_b", "x_a"]),
        ("children", ["x_b", "y_b", "y_a"]),
    ],
)
def test_the_sort_weighs_the_count_against_the_candidates_degree(
    client: TestClient, operator: dict[str, str], relation: str, expected: list[str]
) -> None:
    page = _list(
        client,
        operator,
        filter=root(shared(relation, *PICKS)),
        sort=f"shared_{relation}",
        descending=True,
    )
    assert [r["handle"] for r in page["rows"]] == expected


def test_each_relation_adds_its_count_to_the_row_only_while_on(
    client: TestClient, operator: dict[str, str]
) -> None:
    def counts(tree: Any) -> dict[str, tuple[Any, Any]]:
        page = _list(client, operator, filter=tree, sort="subscribers")
        return {
            r["handle"]: (r["sharedParents"], r["sharedChildren"]) for r in page["rows"]
        }

    assert counts(None)["x_b"] == (None, None)
    assert counts(root(shared("parents", *PICKS)))["x_a"] == (3, None)
    both = counts(root(shared("parents", *PICKS), shared("children", *PICKS)))
    assert both == {"x_b": (2, 2)}


def test_a_zero_minimum_or_an_unknown_relation_is_refused(
    client: TestClient, operator: dict[str, str]
) -> None:
    for bad in (shared("parents", "p1", min=0), shared("cousins", "p1")):
        response = client.post(
            f"{DIRECTORY}/list", json={"filter": root(bad)}, headers=operator
        )
        assert response.status_code == 422


def test_why_its_here_names_the_shared_channels(
    client: TestClient, operator: dict[str, str]
) -> None:
    def why(handle: str, **picks: Any) -> dict[str, Any]:
        response = client.post(
            f"{DIRECTORY}/why", json={"handle": handle, **picks}, headers=operator
        )
        assert response.status_code == 200, response.text
        return dict(response.json())

    found = why("x_a", parents=list(PICKS), children=list(PICKS))
    assert found["parents"] == {
        "channels": [
            {"handle": "s1", "displayName": None},
            {"handle": "s2", "displayName": None},
            {"handle": "s3", "displayName": None},
        ],
        "total": 3,
    }
    assert found["children"] == {"channels": [], "total": 0}
    assert why("y_c", children=["y_b", "p2"])["children"] == {
        "channels": [{"handle": "t3", "displayName": None}],
        "total": 1,
    }
    off = why("x_a")
    assert off["parents"] is None and off["children"] is None
