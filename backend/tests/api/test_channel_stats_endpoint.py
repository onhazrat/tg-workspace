"""`GET /data/channels/stats` — the batch the Channels tab paints without.

Stats used to ride along on `GET /channels?includeStats=true`, where the two
aggregate queries behind them cost 2.36s of a 3.13s response while contributing
46 KB of a 536 KB payload. Only two of the grid's eleven sort options read them,
and not the default, so the grid now paints from the base list and fills these in
after.

These tests pin the two things that split can get wrong: the batch must agree
with the per-channel route it generalises, and the literal path segment "stats"
must not be swallowed by a `/channels/{channel_id}` route.
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Post
from tests.utils.setting_groups import add_test_channel

PREFIX = f"{settings.API_V1_STR}/data"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _seed(channel: str, post_ids: list[int]) -> None:
    with Session(engine) as session:
        add_test_channel(session, channel)
        for i, post_id in enumerate(post_ids, start=1):
            session.add(
                Post(
                    channel_name=channel,
                    post_id=post_id,
                    text=f"p{post_id}",
                    timestamp=1_700_000_000_000 + i * 3_600_000,
                )
            )
        session.commit()


def test_stats_are_keyed_by_channel_name(client: TestClient) -> None:
    headers = _auth(client)
    _seed("stats-ep-a", [4, 9])
    _seed("stats-ep-b", [7])

    r = client.get(f"{PREFIX}/channels/stats", headers=headers)

    assert r.status_code == 200
    body = r.json()
    assert body["stats-ep-a"]["count"] == 2
    assert body["stats-ep-a"]["minId"] == 4
    assert body["stats-ep-a"]["maxId"] == 9
    assert body["stats-ep-b"]["count"] == 1


def test_batch_agrees_with_the_per_channel_route(client: TestClient) -> None:
    """The two must not drift — the grid reads one, channel detail the other.

    `velocity` is compared approximately on purpose: it folds in the time since
    the newest post via `utc_now()`, so two requests a millisecond apart differ
    in the tenth decimal. Asserting equality there tests the clock, not the code.
    """
    headers = _auth(client)
    _seed("stats-ep-agree", [2, 5, 11])

    batch = client.get(f"{PREFIX}/channels/stats", headers=headers).json()[
        "stats-ep-agree"
    ]
    single = client.get(
        f"{PREFIX}/channels/stats-ep-agree/stats", headers=headers
    ).json()

    assert batch.keys() == single.keys()
    assert {k: v for k, v in batch.items() if k != "velocity"} == {
        k: v for k, v in single.items() if k != "velocity"
    }
    assert batch["velocity"] == pytest.approx(single["velocity"], rel=1e-6)


def test_stats_is_not_captured_as_a_channel_id(client: TestClient) -> None:
    """Route order, asserted.

    `/channels/stats` sits ahead of the `/channels/{channel_id}` routes. If it
    ever slipped below a `GET /channels/{channel_id}`, this would come back as a
    single channel named "stats" — or a 404 — rather than the batch.
    """
    headers = _auth(client)
    _seed("stats-ep-order", [1])

    body = client.get(f"{PREFIX}/channels/stats", headers=headers).json()

    assert isinstance(body, dict)
    assert "stats-ep-order" in body
    # A captured id would have produced a channel payload, not a stats map.
    assert set(body["stats-ep-order"]) == {"count", "minId", "maxId", "velocity"}


def test_stats_requires_auth(client: TestClient) -> None:
    assert client.get(f"{PREFIX}/channels/stats").status_code == 401


def test_channels_list_no_longer_needs_the_stats_block(client: TestClient) -> None:
    """The grid's own call: no `stats` key, which is the point of the split."""
    headers = _auth(client)
    _seed("stats-ep-plain", [3])

    rows = client.get(f"{PREFIX}/channels", headers=headers).json()

    row = next(r for r in rows if r["name"] == "stats-ep-plain")
    assert "stats" not in row


def test_bios_are_keyed_by_name_and_skip_empty_ones(client: TestClient) -> None:
    headers = _auth(client)
    with Session(engine) as session:
        add_test_channel(session, "bio-has", bio="a description")
        add_test_channel(session, "bio-none")
        session.commit()

    body = client.get(f"{PREFIX}/channels/bios", headers=headers).json()

    assert body["bio-has"] == "a description"
    assert "bio-none" not in body


def test_the_channel_list_omits_bio_rather_than_nulling_it(
    client: TestClient,
) -> None:
    """Absent, not `"bio": null`.

    `ChannelResponse` still declares `bio` because `PUT /channels/{id}` returns a
    channel in full. A declared-but-empty field would serialise as an explicit
    null here and claim these channels have no bio, which is the wire-format trap
    `app/schemas/summaries.py` documents.
    """
    headers = _auth(client)
    with Session(engine) as session:
        add_test_channel(session, "bio-omitted", bio="still in the database")
        session.commit()

    row = next(
        r
        for r in client.get(f"{PREFIX}/channels", headers=headers).json()
        if r["name"] == "bio-omitted"
    )

    assert "bio" not in row


@pytest.mark.parametrize("path", ["/channels", "/channels/stats", "/channels/bios"])
def test_unchanged_reads_come_back_as_a_bodiless_304(
    client: TestClient, path: str
) -> None:
    """`refetchOnWindowFocus` asks for these on every focus; unchanged is free."""
    headers = _auth(client)
    _seed("etag-ch", [1])

    first = client.get(f"{PREFIX}{path}", headers=headers)
    assert first.status_code == 200
    etag = first.headers["etag"]
    assert first.headers["cache-control"] == "private, no-cache"

    second = client.get(f"{PREFIX}{path}", headers={**headers, "If-None-Match": etag})

    assert second.status_code == 304
    assert second.content == b""
    assert second.headers["etag"] == etag


def test_a_weakened_validator_still_matches(client: TestClient) -> None:
    """A proxy may return our tag as `W/"..."`, and may send several."""
    headers = _auth(client)
    _seed("etag-weak", [1])

    etag = client.get(f"{PREFIX}/channels", headers=headers).headers["etag"]
    r = client.get(
        f"{PREFIX}/channels",
        headers={**headers, "If-None-Match": f'"other", W/{etag}'},
    )

    assert r.status_code == 304


def test_a_changed_list_does_not_serve_a_stale_304(client: TestClient) -> None:
    """The validator hashes the body, so any payload change invalidates it."""
    headers = _auth(client)
    _seed("etag-before", [1])
    etag = client.get(f"{PREFIX}/channels", headers=headers).headers["etag"]

    _seed("etag-after", [2])
    r = client.get(f"{PREFIX}/channels", headers={**headers, "If-None-Match": etag})

    assert r.status_code == 200
    assert any(c["name"] == "etag-after" for c in r.json())
