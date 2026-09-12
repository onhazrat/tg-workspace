"""AW-06: Artifact kind does not change temporal meaning.

AW-05 proved the frozen-Scope contract on Summaries and left the other three
families where they were: a Chat and a Tag run stored channels and two epoch
milliseconds the *browser* computed, and a Discover report stored the whole
filter set under a shape of its own. So "which Posts produced this" had three
different answers depending on which kind of Artifact you opened, and only one
of them was the answer AW-05 had settled on.

Worse, the two that stored a browser-computed pair stored it on a write that
happens *after* the work. A tag run is written twice — `copyTagPrompt` opens it
pending and the pasted response completes it — and a chat is written once per
turn, for as long as the conversation runs. With a Live window the prompt was
built from one window and the row recorded another.

So all four submit the same value, through the same resolver, at the same point
in their lifecycle: before any AI work starts.

## What is asserted

The matrix is parameterized over all four families and every claim below is
made of each of them, because a claim made of one is the shape of bug this
ticket exists to close.

* **Submission freezes the server's current minute**, not the client's clock.
* **A simulated queue delay does not move the stored boundaries.**
* **The whole filter set survives**, the same filter set for every kind.
* **A later write cannot replace it** — not the content, not a flag, not a
  round-tripped list item, which is the shape the client actually sends.
* **The list projection carries the Scope without its Post refs**, so a page of
  History does not detoast four corpora to render four date ranges — asserted
  on the wire *and* against the SQL, because dropping a field in Python after
  reading it off disk is the defect, not the fix.
* **The unified History read exposes one Scope shape** over all four kinds.
* **The explicit Post selection survives on the paths that have one.**

Two claims are Summary-only because only Summaries have successors:

* **`derivedFrom` produces the window the browser could not state.** Both
  derivations end in the future — a successor runs a full Duration past where
  its predecessor closed, and a repeat inherits that end — which
  `resolve_analysis_window` refuses, so the browser had been falling back to
  `PUT` and writing no Scope at all. A stated window is checked against the
  clock; a derived one never is.
* **The worker and the browser compute it with the same function**, so the same
  chain records the same thing whichever process is awake.

## Watched to fail

* stamp `scope` before spreading `extra` -> the round-tripped-list-item case
* let the merge branch set `channels` / `start_date` / `end_date` again -> the
  later-write case, per family
* resolve the window twice in the Discover route -> the queue-delay case
* select `scope_posts` in a light projection -> the list-payload case
* have `derived_scope` clamp its end to the current minute -> the successor
  case, which asserts the end is *past* that minute
* send a repeat through the stated-window door -> the repeat case, which is a
  re-run of a row whose own end has not elapsed
* drop `scope` from a leg of the History union -> the unified-read case
"""

from __future__ import annotations

import datetime as dt
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models_tg import ChatSession, DiscoverReport, Summary, TagRun
from app.services import analysis_window as analysis_window_service
from app.services.analysis_window import MINUTE_MS

PREFIX = f"{settings.API_V1_STR}/data"


def _ms(text: str) -> int:
    return int(dt.datetime.fromisoformat(text).timestamp() * 1000)


NOW = _ms("2026-03-14T14:32:47.812+00:00")
MINUTE = _ms("2026-03-14T14:32:00+00:00")
DAY_MS = 24 * 60 * MINUTE_MS

#: One filter set, sent by every family, so "the same contract" is asserted
#: rather than described. Every value is deliberately non-default: a filter that
#: silently failed to travel would otherwise read back as the value it was
#: given.
FILTERS: dict[str, Any] = {
    "keyword": "tehran",
    "forwarded": "original",
    "media": "photo",
    "maxPerChannel": 25,
    "maxPerChannelMode": "random",
    "seed": 4242,
}

#: What every family's frozen Scope must agree on. `sort` is absent because
#: Discover aggregates rather than lists, so it has no order to state and takes
#: the default; `channels`, `start` and `end` are asserted separately.
SHARED_KEYS = tuple(FILTERS)


def _live(duration: int = 24 * 60, gap: int = 0) -> dict[str, Any]:
    return {"mode": "live", "durationMinutes": duration, "endGapMinutes": gap}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture
def at_now(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin the server's clock to `NOW` for the whole request."""
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: NOW)


# --------------------------------------------------------------------------
# The four families, as a caller reaches them
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    """One Artifact kind, described by the requests that reach it.

    A table rather than four near-identical test modules, because the point of
    the ticket is that these four are now the same thing. A claim written once
    and parameterized cannot hold for three kinds and quietly not the fourth,
    which is exactly how Discover ended up with a Scope shape of its own.
    """

    kind: str
    #: The submission body, given an id, a window and the filter set.
    body: Callable[[str, dict[str, Any], dict[str, Any]], dict[str, Any]]
    path: str
    #: Where a created Artifact is read back in full.
    detail: Callable[[str], str]
    #: Where a page of this kind is listed.
    list_path: str
    #: A write that happens *after* creation and tries to move the Scope.
    later_write: Callable[[str, dict[str, Any]], tuple[str, str, dict[str, Any]]]
    #: The row class, for reading the database directly.
    model: type[Any]
    #: Whether the submission accepts an explicit Post selection.
    takes_posts: bool = True


def _artifact_body(id_: str, window: dict[str, Any], filters: dict[str, Any]) -> dict:
    return {"id": id_, "scope": {"channels": ["ch"], "window": window, **filters}}


FAMILIES: list[Family] = [
    Family(
        kind="summary",
        body=_artifact_body,
        path=f"{PREFIX}/summaries",
        detail=lambda i: f"{PREFIX}/summaries/{i}",
        list_path=f"{PREFIX}/summaries",
        later_write=lambda i, scope: (
            "PUT",
            f"{PREFIX}/summaries/{i}",
            {"text": "the finished summary", "isStarred": True, "scope": scope},
        ),
        model=Summary,
    ),
    Family(
        kind="chat",
        body=_artifact_body,
        path=f"{PREFIX}/chat-sessions",
        detail=lambda i: f"{PREFIX}/chat-sessions/{i}",
        list_path=f"{PREFIX}/chat-sessions",
        later_write=lambda i, scope: (
            "PUT",
            f"{PREFIX}/chat-sessions/{i}",
            {
                "messages": [{"role": "user", "text": "and the next turn"}],
                "isStarred": True,
                "scope": scope,
            },
        ),
        model=ChatSession,
    ),
    Family(
        kind="tag",
        body=_artifact_body,
        path=f"{PREFIX}/tag-runs",
        detail=lambda i: f"{PREFIX}/tag-runs/{i}",
        list_path=f"{PREFIX}/tag-runs",
        later_write=lambda i, scope: (
            "PUT",
            f"{PREFIX}/tag-runs/{i}",
            {
                "status": "completed",
                "responseText": "the pasted reply",
                "isStarred": True,
                "scope": scope,
            },
        ),
        model=TagRun,
    ),
    Family(
        kind="discovery",
        # Discover states its Scope as the request it already had — see
        # `DiscoverCandidatesRequest.to_scope_submission`. `id` is server-chosen
        # here, which is why every helper below reads it off the response.
        body=lambda _id, window, filters: {
            "channelNames": ["ch"],
            "window": window,
            **filters,
        },
        path=f"{PREFIX}/discover/reports",
        detail=lambda i: f"{PREFIX}/discover/reports/{i}",
        list_path=f"{PREFIX}/discover/reports",
        later_write=lambda i, scope: (
            "PUT",
            f"{PREFIX}/discover/reports/{i}/flags",
            {"isStarred": True},
        ),
        model=DiscoverReport,
    ),
]

IDS = [f.kind for f in FAMILIES]


def _create(
    client: TestClient,
    family: Family,
    headers: dict[str, str],
    *,
    window: dict[str, Any] | None = None,
    filters: dict[str, Any] | None = None,
    posts: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Submit one Artifact of this kind and return the created body."""
    body = family.body(
        str(uuid.uuid4()), window or _live(), FILTERS if filters is None else filters
    )
    if posts is not None:
        if family.kind == "discovery":
            body["postIds"] = posts
        else:
            body["scope"]["posts"] = posts
    response = client.post(family.path, json=body, headers=headers)
    assert response.status_code == 200, response.text
    return dict(response.json())


def _stored_scope(family: Family, artifact_id: str) -> dict[str, Any] | None:
    """The `scope` column, read through a session that closes.

    Not the session-scoped `db` fixture: a read on it leaves a transaction open
    for the rest of the test, and the autouse `TRUNCATE` afterwards then waits
    on it for ever with no traceback.
    """
    with Session(engine) as session:
        row = session.get(family.model, artifact_id)
        assert row is not None
        stored = row.scope
        session.expunge_all()
        return stored


# --------------------------------------------------------------------------
# The freeze, for every kind
# --------------------------------------------------------------------------


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_submission_freezes_the_servers_current_minute(
    client: TestClient, at_now: None, family: Family
) -> None:
    """14:32:47 with a zero gap ends at 14:32:00, whatever the Artifact is.

    The seconds of a minute still happening are the difference between two
    requests a second apart selecting the same Posts and selecting different
    ones while both reporting "the last 24 hours".
    """
    created = _create(client, family, _auth(client))

    assert created["scope"]["end"] == MINUTE
    assert created["scope"]["start"] == MINUTE - DAY_MS
    assert created["scope"]["durationMinutes"] == 24 * 60


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_the_whole_filter_set_survives_for_every_kind(
    client: TestClient, at_now: None, family: Family
) -> None:
    """One filter set, one shape, four kinds.

    Before this ticket a Chat and a Tag run recorded none of these, and a
    Discover report recorded all of them under different key names. Either way
    the answer to "can I reproduce this" depended on which tab you were on.
    """
    created = _create(client, family, _auth(client))

    for key in SHARED_KEYS:
        assert created["scope"][key] == FILTERS[key], key
    assert created["scope"]["channels"] == ["ch"]


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_a_simulated_queue_delay_does_not_move_the_stored_boundaries(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, family: Family
) -> None:
    """The ticket's claim as the timeline actually runs.

    Submit at 14:32, let nine minutes of queue wait, retries and model latency
    pass, then write the content. The Artifact still says 14:32 — because
    nothing downstream of submission resolves a window at all.
    """
    headers = _auth(client)
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: NOW)
    created = _create(client, family, headers)

    later = NOW + 9 * MINUTE_MS
    monkeypatch.setattr(analysis_window_service, "server_now_ms", lambda: later)
    method, path, body = family.later_write(created["id"], {"start": 0, "end": 1})
    assert client.request(method, path, json=body, headers=headers).status_code == 200

    stored = _stored_scope(family, created["id"])
    assert stored is not None
    assert (stored["start"], stored["end"]) == (MINUTE - DAY_MS, MINUTE)


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_a_later_write_cannot_replace_the_frozen_scope(
    client: TestClient, at_now: None, family: Family
) -> None:
    """Finishing an Artifact does not change which Posts produced it.

    The body sent here is the one the client actually sends: History and the
    result tabs round-trip whole items back to set one flag, so a `scope` key
    in the payload is the ordinary case rather than an attack.
    """
    headers = _auth(client)
    created = _create(client, family, headers)
    method, path, body = family.later_write(
        created["id"],
        {"channels": ["someone-elses"], "start": 0, "end": 1, "keyword": "rewritten"},
    )
    client.request(method, path, json=body, headers=headers)

    detail = client.get(family.detail(created["id"]), headers=headers).json()
    assert detail["scope"]["keyword"] == FILTERS["keyword"]
    assert detail["scope"]["channels"] == ["ch"]
    assert (detail["scope"]["start"], detail["scope"]["end"]) == (
        MINUTE - DAY_MS,
        MINUTE,
    )


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_a_rejected_scope_does_not_land_in_the_open_extra_bag(
    client: TestClient, at_now: None, family: Family
) -> None:
    """Refusing the write is only half of it.

    Three of these four rows carry an open `extra` column that takes whatever
    the columns do not claim, and every projection spreads `extra` into the
    response. So a `scope` key that was merely *not written to the column*
    would be reported as the Scope anyway, over a column still holding the real
    one — a wrong answer with no failing write behind it.
    """
    headers = _auth(client)
    created = _create(client, family, headers)
    method, path, body = family.later_write(
        created["id"], {"channels": [], "start": 0, "end": 1, "keyword": "rewritten"}
    )
    client.request(method, path, json=body, headers=headers)

    with Session(engine) as session:
        row = session.get(family.model, created["id"])
        assert row is not None
        extra = dict(row.extra or {})
        session.expunge_all()
    assert "scope" not in extra


# --------------------------------------------------------------------------
# The reads
# --------------------------------------------------------------------------


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_the_list_projection_carries_the_scope_without_its_post_refs(
    client: TestClient, at_now: None, family: Family
) -> None:
    """A page of history renders date ranges, not corpora.

    `scopedPostCount` rides the Scope so a list can still say the selection was
    restricted; the refs themselves are in a payload table or a heavy column,
    and the list opens neither.
    """
    headers = _auth(client)
    refs = [{"channelName": "ch", "postId": n} for n in range(40)]
    created = _create(client, family, headers, posts=refs)

    listed = next(
        item
        for item in client.get(family.list_path, headers=headers).json()
        if item["id"] == created["id"]
    )

    assert listed["scope"]["scopedPostCount"] == 40
    assert listed["scope"]["posts"] is None


@contextmanager
def _captured_sql() -> Iterator[list[str]]:
    """Every statement the engine executes inside the block."""
    statements: list[str] = []

    def before_cursor_execute(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_a_list_never_reads_the_column_the_post_refs_live_in(
    client: TestClient, at_now: None, family: Family
) -> None:
    """The claim above it is about the wire; this one is about the disk.

    Dropping `posts` from a projection costs nothing if the column was read to
    build it — that is precisely the defect `list_tag_runs` and `list_reports`
    already shipped once, where the heavy fields were selected and then
    discarded in Python. Two of these four families keep the refs on the base
    row, so for them the exclusion is a `SELECT` list rather than a table the
    module simply never imports, and a `SELECT` list is a thing somebody edits.

    Asserted against the SQL the engine actually executes, so it fails whether
    the column is selected by name or dragged in by `select(Entity)`.
    """
    headers = _auth(client)
    _create(
        client,
        family,
        headers,
        posts=[{"channelName": "ch", "postId": n} for n in range(5)],
    )

    with _captured_sql() as statements:
        listed = client.get(family.list_path, headers=headers)
    assert listed.status_code == 200

    offenders = [st for st in statements if "scope_posts" in st]
    assert not offenders, f"the {family.kind} list read the Post refs: {offenders[:1]}"


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_the_detail_read_returns_the_selection_the_ranking_named(
    client: TestClient, at_now: None, family: Family
) -> None:
    """Semantic and related-Post ranking is not expressible as filters.

    The server cannot rebuild the ordering from a keyword and a cap, so the
    selection itself is the reproduction — for all four kinds, not only the one
    AW-05 happened to prove it on.
    """
    headers = _auth(client)
    refs = [{"channelName": "ch", "postId": n} for n in (11, 12, 13)]
    created = _create(client, family, headers, posts=refs)

    detail = client.get(family.detail(created["id"]), headers=headers).json()

    assert detail["scope"]["scopedPostCount"] == 3
    assert detail["scope"]["posts"] == refs


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_history_reports_one_scope_shape_for_every_kind(
    client: TestClient, at_now: None, family: Family
) -> None:
    """The unified read is where "kind changes temporal meaning" would show.

    History is the one screen listing all four, so it is the one place the rule
    is either true or visibly false. It reads the shared column per leg rather
    than four per-kind subsets, and it does so without opening a payload table
    — which is why `posts` is absent here and `scopedPostCount` is not.
    """
    headers = _auth(client)
    created = _create(client, family, headers)

    listed = next(
        item
        for item in client.get(f"{PREFIX}/artifacts", headers=headers).json()
        if item["id"] == created["id"]
    )

    assert listed["kind"] == family.kind
    assert listed["scope"]["start"] == MINUTE - DAY_MS
    assert listed["scope"]["end"] == MINUTE
    assert listed["scope"]["durationMinutes"] == 24 * 60
    for key in SHARED_KEYS:
        assert listed["scope"][key] == FILTERS[key], key


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_an_impossible_window_is_refused_at_every_submission_door(
    client: TestClient, at_now: None, family: Family
) -> None:
    """Refused, not clamped, and refused *here*.

    `test_analysis_window_resolution.py` asserts the resolver refuses a future
    end. This asserts each of the four submission paths actually reaches the
    resolver, which is the half a route that forgot to call it would leave
    green.
    """
    response = client.post(
        family.path,
        json=family.body(
            str(uuid.uuid4()),
            {"mode": "fixed", "start": MINUTE - DAY_MS, "end": MINUTE + MINUTE_MS},
            FILTERS,
        ),
        headers=_auth(client),
    )

    assert response.status_code == 422


@pytest.mark.parametrize("family", FAMILIES, ids=IDS)
def test_a_filter_value_this_server_does_not_implement_is_refused(
    client: TestClient, at_now: None, family: Family
) -> None:
    """A frozen Scope claims to be reproducible.

    A typo'd cap mode falling through to the default would record a Scope that
    does not describe what happened, which is worse than no Scope at all.
    """
    response = client.post(
        family.path,
        json=family.body(
            str(uuid.uuid4()), _live(), {**FILTERS, "maxPerChannelMode": "alphabetical"}
        ),
        headers=_auth(client),
    )

    assert response.status_code == 422


# --------------------------------------------------------------------------
# The successor, which is a Summary-only shape
# --------------------------------------------------------------------------


def _submit_summary(client: TestClient, headers: dict[str, str], **body: Any) -> Any:
    return client.post(
        f"{PREFIX}/summaries", json={"id": str(uuid.uuid4()), **body}, headers=headers
    )


def _derived(summary_id: str, mode: str) -> dict[str, Any]:
    return {"summaryId": summary_id, "mode": mode}


def test_a_successor_is_derived_from_its_predecessor_and_runs_into_the_future(
    client: TestClient, at_now: None
) -> None:
    """The window the browser could not state, which is why it stated none.

    A successor opens where its predecessor closed and runs the same Duration
    forward, so most of it has not elapsed. `resolve_analysis_window` refuses a
    future end — correctly, for a window somebody is choosing right now — so the
    browser had been falling back to `PUT`, which by AW-05's design writes no
    Scope at all. Naming the predecessor instead is what lets the server
    produce a window no caller is allowed to describe.
    """
    headers = _auth(client)
    first = _submit_summary(
        client, headers, scope={"channels": ["ch"], "window": _live()}
    ).json()

    second = _submit_summary(
        client, headers, derivedFrom=_derived(first["id"], "successor")
    ).json()

    assert second["scope"]["start"] == first["scope"]["end"]
    assert second["scope"]["end"] == first["scope"]["end"] + DAY_MS
    assert second["scope"]["end"] > MINUTE, (
        "a successor's end is deliberately in the future; clamping it to the "
        "current minute shortens every run after it and the chain decays"
    )


def test_a_repeat_of_a_summary_whose_window_has_not_elapsed_is_allowed(
    client: TestClient, at_now: None
) -> None:
    """The Regenerate button, on the rows the chain actually produces.

    Every successor has an end in the future by design, so the commonest thing
    to re-run is a Summary the stated-window door would refuse. Making the
    repeat *derive* rather than state is what keeps that button working: a
    window read off an Artifact is derived whichever offset it takes, and only
    a window somebody is choosing now is checked against the clock.

    An earlier cut of this ticket stated the predecessor's boundaries here and
    422'd on exactly these rows.
    """
    headers = _auth(client)
    first = _submit_summary(
        client, headers, scope={"channels": ["ch"], "window": _live()}
    ).json()
    successor = _submit_summary(
        client, headers, derivedFrom=_derived(first["id"], "successor")
    ).json()
    assert successor["scope"]["end"] > MINUTE

    repeat = _submit_summary(
        client, headers, derivedFrom=_derived(successor["id"], "repeat")
    )

    assert repeat.status_code == 200, repeat.text[:200]
    assert repeat.json()["scope"]["start"] == successor["scope"]["start"]
    assert repeat.json()["scope"]["end"] == successor["scope"]["end"]


def test_a_successor_carries_the_channels_and_no_filter_its_run_did_not_apply(
    client: TestClient, at_now: None
) -> None:
    """Carrying the keyword forward reads like the obvious thing and is a lie.

    Regeneration applies the channels and the shifted window and nothing else —
    it never applied the predecessor's keyword or cap — so a record naming them
    would describe a run that did not happen.
    """
    headers = _auth(client)
    first = _submit_summary(
        client,
        headers,
        scope={"channels": ["ch", "other"], "window": _live(), **FILTERS},
    ).json()

    second = _submit_summary(
        client, headers, derivedFrom=_derived(first["id"], "successor")
    ).json()

    assert second["scope"]["channels"] == ["ch", "other"]
    assert second["scope"]["keyword"] is None
    assert second["scope"]["maxPerChannel"] == 0
    assert second["scope"]["seed"] == 0


def test_the_worker_and_the_browser_derive_the_same_successor(
    client: TestClient, at_now: None
) -> None:
    """One function, so one chain cannot record two different things.

    This is the asymmetry AW-05 left named and AW-07 was warned about: the
    scheduler wrote a complete Scope and the browser wrote `NULL`, for the same
    chain, pruned afterwards by which process happened to be awake.
    """
    from app.services.summaries import derived_scope

    headers = _auth(client)
    first = _submit_summary(
        client, headers, scope={"channels": ["ch"], "window": _live()}
    ).json()
    through_the_route = _submit_summary(
        client, headers, derivedFrom=_derived(first["id"], "successor")
    ).json()

    with Session(engine) as session:
        predecessor = session.get(Summary, first["id"])
        assert predecessor is not None
        in_the_worker = derived_scope(predecessor, "successor")
        session.expunge_all()

    # The stored column on both sides, which is the claim: `auto_summary`
    # writes `successor_scope(...).stored()` straight onto its new row, and the
    # route writes it through `submit_summary`. Comparing the columns rather
    # than the responses is what makes a difference in *what is persisted*
    # visible, rather than a difference in what a projection adds on the way
    # out.
    stored = _stored_scope(FAMILIES[0], through_the_route["id"])

    assert in_the_worker.stored() == stored


def test_a_submission_states_its_scope_or_derives_it_and_never_both(
    client: TestClient, at_now: None
) -> None:
    """Both would need a precedence rule over "which Posts did this use".

    That is the ambiguity the whole effort was written against, and neither is
    the Scope-less submission AW-05 made impossible.
    """
    headers = _auth(client)
    first = _submit_summary(
        client, headers, scope={"channels": ["ch"], "window": _live()}
    ).json()

    assert _submit_summary(client, headers).status_code == 422
    assert (
        _submit_summary(
            client,
            headers,
            scope={"channels": ["ch"], "window": _live()},
            derivedFrom=_derived(first["id"], "successor"),
        ).status_code
        == 422
    )


def test_a_successor_of_somebody_elses_summary_is_refused_as_an_absent_one(
    client: TestClient, at_now: None
) -> None:
    """Which Artifact a new Artifact continues is identity, not visibility.

    A predecessor hands over its channels and its boundaries, so reaching a
    foreign one is a cross-account read whichever way `TENANCY_ENFORCED` is
    set — and it answers this family's own 404, so an absent id and a foreign
    one are indistinguishable.
    """
    response = _submit_summary(
        client, _auth(client), derivedFrom=_derived(str(uuid.uuid4()), "successor")
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Summary not found"
