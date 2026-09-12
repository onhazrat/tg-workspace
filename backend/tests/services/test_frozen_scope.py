"""AW-05: an Artifact records exactly which Posts it was made from.

AW-02 moved *now* to the server, so a selection no longer depends on a browser's
clock. It said nothing about *when* the server reads that clock, and for a
Summary the answer was "twice": once when `/ai/summary/stream` assembled the
prompt, and again — from the browser, minutes later — when the finished text was
PUT back with two epoch milliseconds the client had been holding since before
the model started. With a Live window those are different windows. The Artifact
recorded the second one.

The rest of the Scope did not survive at all. A Summary stored channels and two
timestamps; the keyword that narrowed the feed, the media filter, the
per-channel cap and its random seed all shaped the text and none of them were
kept. A Discover report stored the lot, so "which Posts produced this" had a
different answer depending on which kind of Artifact you opened.

So submission freezes the whole Scope, once, before any work starts, and nothing
afterwards can move it.

## What is asserted

* **The freeze happens at submission and holds.** A window resolved at 14:32:47
  is the start of that minute, and it is still those two instants after the
  clock has moved on and the text has been written.
* **The filter set is complete, derived from the schemas rather than listed.** A
  filter added to `ScopeSubmission` and forgotten in `FrozenScope` fails here,
  which is the half a hand-written list cannot do.
* **The semantic path keeps its explicit selection**, in the payload table, out
  of the list projection.
* **A later write cannot replace it.** Not the text, not a flag, not a
  round-tripped list item — which is the shape the client actually PUTs.
* **Duration is derived.** It comes off the two boundaries every time rather
  than being stored beside them, so the number a reader looks at cannot
  disagree with the pair it came from.

## Watched to fail

* resolve Live against `now` instead of the minute start -> the minute case
* re-freeze the Scope on `PUT` -> the queue-delay and later-write cases
* let `upsert_summary` set `channels` / `start_date` / `end_date` again -> the
  round-tripped-list-item case
* drop a filter from `FrozenScope` -> the completeness case
* store `durationMinutes` instead of computing it -> the derived case
* put `scope_posts` on `tg_summaries` -> the list-projection case
"""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import Summary, SummaryPayload
from app.schemas.scope import FrozenScope, ScopeSubmission
from app.services import analysis_window as analysis_window_service
from app.services.analysis_window import MINUTE_MS, freeze_scope

PREFIX = f"{settings.API_V1_STR}/data"


def _ms(text: str) -> int:
    return int(dt.datetime.fromisoformat(text).timestamp() * 1000)


NOW = _ms("2026-03-14T14:32:47.812+00:00")
MINUTE = _ms("2026-03-14T14:32:00+00:00")
DAY_MS = 24 * 60 * MINUTE_MS


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def _live(duration: int = 24 * 60, gap: int = 0) -> dict[str, Any]:
    return {"mode": "live", "durationMinutes": duration, "endGapMinutes": gap}


def _scope(**overrides: Any) -> dict[str, Any]:
    body: dict[str, Any] = {"channels": ["ch"], "window": _live()}
    body.update(overrides)
    return body


def _submit(
    client: TestClient,
    headers: dict[str, str],
    *,
    summary_id: str | None = None,
    scope: dict[str, Any] | None = None,
    **extra: Any,
) -> Any:
    return client.post(
        f"{PREFIX}/summaries",
        json={
            "id": summary_id or str(uuid.uuid4()),
            "scope": scope or _scope(),
            **extra,
        },
        headers=headers,
    )


@pytest.fixture
def at_now(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the server's clock to `NOW` for the whole request."""
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: NOW)


def _stored(summary_id: str) -> tuple[Summary, SummaryPayload | None]:
    """Read the row back through a session that closes.

    Not the session-scoped `db` fixture: a read on it leaves a transaction open
    for the rest of the test, and the autouse `TRUNCATE` that runs afterwards
    then waits on it for ever with no traceback.
    """
    with Session(engine) as session:
        summary = session.get(Summary, summary_id)
        assert summary is not None
        payload = session.get(SummaryPayload, summary_id)
        session.expunge_all()
        return summary, payload


# --------------------------------------------------------------------------
# The freeze itself
# --------------------------------------------------------------------------


def test_a_live_window_freezes_to_the_start_of_the_servers_current_minute() -> None:
    """14:32:47 with a zero gap ends at 14:32:00, not at 14:32:47.

    The seconds of a minute that is still happening are the difference between
    two requests a second apart selecting the same Posts and selecting
    different ones while both reporting "the last 24 hours".
    """
    frozen = freeze_scope(ScopeSubmission.model_validate(_scope()), now_ms=NOW)

    assert frozen.end == MINUTE
    assert frozen.start == MINUTE - DAY_MS


def test_duration_is_derived_from_the_boundaries_and_not_stored_beside_them(
    client: TestClient, at_now: None
) -> None:
    """The one number a reader looks at comes off the pair, every time.

    Storing it would make three facts where there are two, and the third would
    be the one nothing keeps in step.
    """
    headers = _auth(client)
    body = _submit(
        client, headers, scope=_scope(window=_live(duration=90, gap=30))
    ).json()

    assert body["scope"]["durationMinutes"] == 90
    assert body["scope"]["end"] - body["scope"]["start"] == 90 * MINUTE_MS

    stored, _ = _stored(body["id"])
    assert stored.scope is not None
    assert "durationMinutes" not in stored.scope


def test_a_simulated_queue_delay_does_not_move_the_stored_boundaries(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The whole point of the ticket, as the timeline actually runs.

    Submit at 14:32, let nine minutes of queue wait, retries and model latency
    pass, then write the text. The Artifact still says 14:32 — because nothing
    downstream of submission resolves a window at all.
    """
    headers = _auth(client)
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: NOW)
    submitted = _submit(client, headers).json()

    later = NOW + 9 * MINUTE_MS
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: later)
    client.put(
        f"{PREFIX}/summaries/{submitted['id']}",
        json={"text": "the finished summary", "postCount": 12},
        headers=headers,
    )

    stored, _ = _stored(submitted["id"])
    assert stored.scope is not None
    assert (stored.start_date, stored.end_date) == (MINUTE - DAY_MS, MINUTE)
    assert stored.scope["start"] == MINUTE - DAY_MS
    assert stored.scope["end"] == MINUTE


def test_a_second_submission_of_one_id_is_refused_rather_than_merged(
    client: TestClient, at_now: None
) -> None:
    """A submission is not idempotent — it reads the clock.

    So the same body twice describes two different windows, and a merge would
    quietly pick one of them. 409, and the first Artifact keeps its Scope.
    """
    headers = _auth(client)
    summary_id = str(uuid.uuid4())

    assert _submit(client, headers, summary_id=summary_id).status_code == 200
    assert _submit(client, headers, summary_id=summary_id).status_code == 409


# --------------------------------------------------------------------------
# Fixed validation, through the route a caller actually uses
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("start", "end", "why"),
    [
        (MINUTE - DAY_MS, MINUTE + MINUTE_MS, "an end past the server's minute"),
        (MINUTE - MINUTE_MS, MINUTE - DAY_MS, "a crossed pair"),
        (MINUTE - 30_000, MINUTE - 1, "a window narrower than the minute it floors to"),
    ],
)
def test_an_impossible_fixed_window_is_refused_at_submission(
    client: TestClient, at_now: None, start: int, end: int, why: str
) -> None:
    """Refused, not swapped and not clamped — and refused *here*.

    `test_analysis_window_resolution.py` asserts the resolver refuses these.
    This asserts the submission path actually reaches the resolver, which is
    the half that a route forgetting to call it would leave green.
    """
    response = _submit(
        client,
        _auth(client),
        scope=_scope(window={"mode": "fixed", "start": start, "end": end}),
    )

    assert response.status_code == 422, why


def test_a_fixed_window_freezes_to_itself(client: TestClient, at_now: None) -> None:
    """Which is what lets a producer re-state the frozen pair downstream.

    Every consumer of a frozen Scope sends it back as a Fixed window, so "the
    window the Artifact records" and "the window the prompt was built from" are
    the same two numbers rather than two readings of one clock.
    """
    start, end = MINUTE - DAY_MS, MINUTE - 60 * MINUTE_MS
    body = _submit(
        client,
        _auth(client),
        scope=_scope(window={"mode": "fixed", "start": start, "end": end}),
    ).json()

    assert (body["scope"]["start"], body["scope"]["end"]) == (start, end)


# --------------------------------------------------------------------------
# Completeness
# --------------------------------------------------------------------------


def test_every_filter_a_caller_can_submit_survives_into_the_record() -> None:
    """Derived from the two schemas, never listed.

    A hand-written list of filters is exactly the artefact that goes stale: the
    next filter gets added to the submission, the record keeps not having it,
    and the test still passes because nobody added the name in two places.
    """
    submitted = set(ScopeSubmission.model_fields)
    recorded = set(FrozenScope.model_fields)
    # `window` is the one field that changes shape: it becomes `start`/`end`.
    stranded = submitted - recorded - {"window"}

    assert not stranded, (
        "These are submittable and unrecorded, so an Artifact made with them "
        "cannot be reproduced: " + ", ".join(sorted(stranded))
    )
    assert {"start", "end", "scoped_post_count"} <= recorded


def test_the_record_carries_the_whole_filter_set_a_submission_named(
    client: TestClient, at_now: None
) -> None:
    """The same claim through the wire, so a projection cannot drop one."""
    sent = _scope(
        keyword="tehran",
        forwarded="original",
        media="photo",
        maxPerChannel=25,
        maxPerChannelMode="random",
        sort="channel_time",
        seed=4242,
    )
    body = _submit(client, _auth(client), scope=sent).json()

    for key in ("keyword", "forwarded", "media", "sort", "seed"):
        assert body["scope"][key] == sent[key]
    assert body["scope"]["maxPerChannel"] == 25
    assert body["scope"]["maxPerChannelMode"] == "random"
    assert body["scope"]["channels"] == ["ch"]


def test_a_filter_value_this_server_does_not_implement_is_refused(
    client: TestClient, at_now: None
) -> None:
    """A frozen Scope claims to be reproducible.

    A typo'd `sort` that fell through to the default would record a Scope that
    does not describe what happened, which is worse than no Scope at all.
    """
    response = _submit(client, _auth(client), scope=_scope(sort="relevance"))

    assert response.status_code == 422


# --------------------------------------------------------------------------
# The explicit selection
# --------------------------------------------------------------------------


def test_a_semantic_submission_keeps_the_posts_it_ranked(
    client: TestClient, at_now: None
) -> None:
    """Semantic and related-Post ranking is not expressible as filters.

    The server cannot rebuild the ordering from a keyword and a cap, so the
    selection itself is the reproduction and it has to be stored.
    """
    headers = _auth(client)
    refs = [{"channelName": "ch", "postId": n} for n in (11, 12, 13)]
    created = _submit(client, headers, scope=_scope(posts=refs)).json()

    detail = client.get(f"{PREFIX}/summaries/{created['id']}", headers=headers).json()

    assert detail["scope"]["scopedPostCount"] == 3
    assert detail["scope"]["posts"] == refs
    _, payload = _stored(created["id"])
    assert payload is not None and payload.scope_posts == refs


def test_the_selection_lives_in_the_payload_table_and_not_the_list(
    client: TestClient, at_now: None
) -> None:
    """A few thousand refs is a corpus, and the list must not read one.

    The same rule `citedPosts` / `promptText` / `chatMessages` already follow,
    for the same measured reason. `scopedPostCount` rides the base row so a
    list can still say the Scope was restricted.
    """
    headers = _auth(client)
    refs = [{"channelName": "ch", "postId": n} for n in range(40)]
    created = _submit(client, headers, scope=_scope(posts=refs)).json()

    listed = next(
        item
        for item in client.get(f"{PREFIX}/summaries", headers=headers).json()
        if item["id"] == created["id"]
    )

    assert listed["scope"]["scopedPostCount"] == 40
    assert listed["scope"]["posts"] is None


def test_a_filtered_submission_records_no_selection_at_all(
    client: TestClient, at_now: None
) -> None:
    """`null` means "the filters were the whole story", not "none matched"."""
    body = _submit(client, _auth(client)).json()

    assert body["scope"]["scopedPostCount"] is None
    assert body["scope"]["posts"] is None


# --------------------------------------------------------------------------
# Immutability
# --------------------------------------------------------------------------


def test_a_later_content_or_flag_write_cannot_replace_the_frozen_scope(
    client: TestClient, at_now: None
) -> None:
    """Editing a Summary's text does not change which Posts produced it."""
    headers = _auth(client)
    created = _submit(client, headers, scope=_scope(keyword="tehran")).json()

    client.put(
        f"{PREFIX}/summaries/{created['id']}",
        json={
            "text": "edited",
            "isStarred": True,
            "scope": {
                "channels": ["someone-elses"],
                "start": 0,
                "end": 1,
                "keyword": "rewritten",
            },
        },
        headers=headers,
    )

    stored, _ = _stored(created["id"])
    assert stored.scope is not None
    assert stored.text == "edited"
    assert stored.scope["keyword"] == "tehran"
    assert stored.scope["channels"] == ["ch"]
    assert stored.extra.get("scope") is None, (
        "a rejected `scope` must not be routed into `extra`, where the "
        "projection would pick it up as the real one"
    )


def test_round_tripping_a_list_item_back_through_put_moves_nothing(
    client: TestClient, at_now: None
) -> None:
    """The shape the client actually PUTs, which is why this is the real case.

    History sends whole items back to toggle one flag. While `channels`,
    `startDate` and `endDate` were settable, a Live window that had advanced in
    the meantime rewrote the boundaries of work that was already finished.
    """
    headers = _auth(client)
    created = _submit(client, headers).json()
    listed = next(
        item
        for item in client.get(f"{PREFIX}/summaries", headers=headers).json()
        if item["id"] == created["id"]
    )

    client.put(
        f"{PREFIX}/summaries/{created['id']}",
        json={
            **listed,
            "startDate": 0,
            "endDate": 1,
            "channels": [],
            "isStarred": True,
        },
        headers=headers,
    )

    stored, _ = _stored(created["id"])
    assert (stored.start_date, stored.end_date) == (MINUTE - DAY_MS, MINUTE)
    assert stored.channels == ["ch"]
    assert stored.extra.get("isStarred") is True
