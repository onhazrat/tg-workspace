"""`GET /data/directory/{handle}/posts` — what the Candidate panel reads.

The wire seam for ticket 03. Its own module beside the other directory tests
rather than inside a discover-named one, because the route is **not** mounted
under discover: the Directory is corpus-wide and outlives every report, and the
Channels tab will want this read with no report in sight.

What is asserted here and nowhere else:

* the four fields a Post row renders, and no fifth — the media block, the
  forward attribution and the capture time stay off a payload read once;
* the view count, which the panel shows per Post so an Operator can see whether
  the median was flattered by one outlier;
* the difference between **no entry** (404) and **an entry with no Posts**
  (`200 []`), which are two different sentences on screen;
* that a queued-but-unprobed handle is the 404 and not an empty entry, the same
  rule `probe_map` applies to the report join — and that a **rechecked** one is
  not, because `requeue_probes` keeps its samples on purpose;
* that reading a panel issues no Telegram request.

## Watched to fail

* declare a fifth field on `DirectorySamplePostResponse` → the field-set test
  fails. Adding one to `sample_to_camel` alone does **not**, and that is the
  model doing its job: it is closed, so an extra key never reaches the wire.
  The guard is therefore on the response model, which is where the decision is
* answer `200 []` for an unknown handle → the 404 test fails
* drop the `attempted_at` filter (read the row directly instead of through
  `probe_map`) → the queued-handle test fails
* gate the 404 on `probe_map` alone → the recheck-window test fails
* read `views` off `media["views"]` (the display string) → the view test fails
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.channel_directory import (
    enqueue_handles,
    record_probe_result,
    requeue_probes,
)

PREFIX = f"{settings.API_V1_STR}/data/directory"

HANDLE = "panel_news"

#: Exactly what a Post row on the panel renders. A fifth key here is payload
#: nobody reads; a missing one is a blank cell.
POST_FIELDS = {"postId", "text", "timestamp", "views"}


def _post(post_id: int, **extra: Any) -> dict[str, Any]:
    return {
        "id": post_id,
        "text": f"post {post_id}",
        "date": "2026-09-01T10:00:00+00:00",
        "timestamp": 1_756_720_800_000 + post_id,
        "channelName": HANDLE,
        **extra,
    }


def _page(samples: list[dict[str, Any]] | None) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "isTelegramPage": True,
        "isUnavailableOnWebView": False,
        "kind": "channel",
        "displayName": "Panel News",
    }
    if samples is not None:
        payload["samples"] = samples
    return payload


def _probe(handle: str, samples: list[dict[str, Any]] | None) -> None:
    with Session(engine) as session:
        record_probe_result(session, handle, _page(samples))


def _get(client: TestClient, headers: dict[str, str], handle: str = HANDLE) -> Any:
    return client.get(f"{PREFIX}/{handle}/posts", headers=headers)


def test_the_panel_reads_the_posts_the_probe_stored(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The point of the ticket: what a Channel publishes, without Telegram."""
    _probe(HANDLE, [_post(11), _post(12), _post(13)])

    response = _get(client, superuser_token_headers)

    assert response.status_code == 200
    body = response.json()
    # Newest first — the panel shows recent Posts, and a disclosure that opened
    # onto the oldest ones would answer a different question.
    assert [row["postId"] for row in body] == [13, 12, 11]
    assert body[0]["text"] == "post 13"


def test_a_post_carries_four_fields_and_no_media_block(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The list-versus-detail rule applied one rung down.

    A sample row holds the parsed media block, the reply pointer, the forward
    attribution and the capture time. The panel renders none of them, and the
    thumbnail URLs in that block point at a cache a probe never fills.
    """
    _probe(HANDLE, [_post(11, media={"type": "photo", "viewsCount": 900})])

    body = _get(client, superuser_token_headers).json()

    assert set(body[0]) == POST_FIELDS


def test_a_post_reports_the_view_count_the_median_was_computed_from(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The parsed integer, not Telegram's display string.

    `media` carries both — `views` is `"9.7K"` and `viewsCount` is `9700`. The
    panel shows this number beside a median derived from the same key, so
    reading the other one would put a string next to an integer and let the two
    disagree about the same Post.
    """
    _probe(
        HANDLE,
        [_post(11, media={"type": "photo", "views": "9.7K", "viewsCount": 9700})],
    )

    body = _get(client, superuser_token_headers).json()

    assert body[0]["views"] == 9700


def test_a_post_telegram_showed_no_counter_for_reports_no_views(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """`null` is *not measured*, and it is ordinary rather than an error.

    Telegram stops rendering the counter on older Posts, which is the whole
    reason the median counts measured views separately from samples.
    """
    _probe(HANDLE, [_post(11), _post(12, media={"type": "photo"})])

    body = _get(client, superuser_token_headers).json()

    assert [row["views"] for row in body] == [None, None]


def test_an_entry_whose_snapshot_is_empty_answers_an_empty_list(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """ "This Channel shows no recent Posts" is an answer, not a missing one.

    An `unavailable` verdict clears the snapshot outright and retention
    collects it on the sample window, so a probed entry with no Posts is the
    ordinary end state — and it must not read as "never probed", which is the
    404 below.
    """
    _probe(HANDLE, [])

    response = _get(client, superuser_token_headers)

    assert response.status_code == 200
    assert response.json() == []


def test_a_handle_with_no_entry_is_a_404(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """Not probed yet, which the panel says in words and offers a recheck for."""
    response = _get(client, superuser_token_headers, handle="nobody_has_looked")

    assert response.status_code == 404


def test_a_queued_handle_is_still_not_probed(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The table is also the work queue, so a row is not an answer.

    Generating a report creates a Directory row for every candidate on it
    immediately. Reading those as entries would make most of a fresh report
    claim an empty snapshot when nothing has fetched the handle at all, which is
    the distinction `probe_map` already draws for the report join.
    """
    with Session(engine) as session:
        enqueue_handles(session, ["queued_only"])

    assert (
        _get(client, superuser_token_headers, handle="queued_only").status_code == 404
    )


def test_a_rechecked_handle_still_shows_what_the_channel_published(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The verdict is disowned; the snapshot is not.

    `requeue_probes` clears the statistics because a row claiming no answer must
    not still show a cadence, and **keeps the samples** because clearing them
    "would blank the one part of the entry worth reading for however long the
    queue takes to reach the handle". Gating this read on the verdict would
    blank them anyway, which is the same mistake one rung out — so the panel
    goes on answering "what does this Channel publish" while the fresh fetch is
    queued at the front.
    """
    _probe(HANDLE, [_post(11), _post(12)])
    with Session(engine) as session:
        requeue_probes(session, [HANDLE])

    response = _get(client, superuser_token_headers)

    assert response.status_code == 200
    assert [row["postId"] for row in response.json()] == [12, 11]


def test_the_handle_is_normalized_the_way_a_candidate_name_is(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """`@Panel_News` in a URL is the same entry as `panel_news`.

    Candidate names arrive off Post bodies, so the case and the leading `@` are
    whatever the author typed. The Directory is keyed by the normalized handle
    and this read has to key the same way or the panel 404s on a row that is
    plainly on screen.
    """
    _probe(HANDLE, [_post(11)])

    response = _get(client, superuser_token_headers, handle="@Panel_News")

    assert response.status_code == 200
    assert [row["postId"] for row in response.json()] == [11]


def test_reading_the_panel_fetches_nothing_from_telegram(
    client: TestClient, superuser_token_headers: dict[str, str], monkeypatch: Any
) -> None:
    """No probe on demand, asserted rather than described.

    A user-facing trigger on a rate-limited scraper lets a click jump the queue
    that exists to decide ordering, and the harvest is already saturating it.
    The route is a read of what the last probe stored; the way to get a fresher
    answer is `POST /discover/probe/refresh`, which goes through the queue.

    **Patched on `scraper`, not on `network`.** `scraper.py` does
    `from app.services.network import fetch_with_retry` at import, so rebinding
    the attribute on `network` leaves every real caller pointing at the original
    function and the guard cannot fail. That is the "guard that could not fail
    at all" `CLAUDE.md` warns about, and it was this test until review caught
    it. `fetch_with_retry` rather than `get_channel_info` because it is the name
    `scraper` itself calls, so a fetch reaching Telegram by any of its paths
    trips this.
    """
    from app.services import scraper

    def _explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("the panel read a Telegram page")

    monkeypatch.setattr(scraper, "fetch_with_retry", _explode)
    _probe(HANDLE, [_post(11)])

    assert _get(client, superuser_token_headers).status_code == 200
