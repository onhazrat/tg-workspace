"""AW-02: the server owns now.

`test_analysis_window_boundaries.py` proves the window is half-open wherever
Posts are selected. It says nothing about where the two numbers came from, and
until this ticket they came from the browser: the client read its own clock,
subtracted 24 hours, and posted the result. A laptop whose clock is four
minutes fast therefore summarised a different set of Posts than the same
request from a correct one, and neither the response nor the stored Artifact
admitted to it.

So a caller now sends the *intent* — Live with a Duration and an End gap, or
Fixed with two exact instants — and one resolver turns either into the pair the
predicate compares against. The browser keeps a clock for previews and labels
(`GET /utils/server-time` is how it estimates its offset), but nothing it
computes reaches a selection.

## What is asserted

* **Live resolves against the start of the server's current minute.** Not
  "now": a zero-gap end of 14:32:47 would sweep in the 47 seconds of a minute
  that is still happening, so two requests a second apart would select
  different Posts while claiming the same window.
* **A crossed pair and a future Fixed end are refused, not repaired.** The
  defect ADR-018 names is a UI that silently swaps boundaries and clamps a
  future end; a server that repairs quietly is the same defect one layer down.
* **Fixed boundaries floor to the minute.** The editor presents minutes, so an
  end displayed as 02:00 must be the instant 02:00:00.000 (AW-01) rather than
  02:00 plus whatever seconds the client's clock contributed.
* **Duration is elapsed UTC time.** A day is 24 hours and a week is 168 across
  a daylight-saving change, because the ledger and the corpus are both in UTC
  and a "7d" window that gains an hour twice a year is not reproducible.
* **No request model still carries the legacy pair.** That guard is the one
  that makes the rest of it true: while `startDate` was a field, calling the
  resolver was a convention, and this repository has watched conventions decay.

## Watched to fail

* resolve Live against `now` instead of the minute start -> the 14:32:47 case
* drop the `end > current minute` refusal -> the future-end case
* swap a crossed pair instead of refusing -> the crossed case
* stop flooring Fixed bounds -> the normalisation case
* re-add `start_date` to `PostScopeRequest` -> the legacy-pair guard
"""

from __future__ import annotations

import datetime as dt

import pytest
from fastapi import HTTPException

from app.main import app
from app.schemas.analysis_window import (
    FixedAnalysisWindow,
    LiveAnalysisWindow,
)
from app.services.analysis_window import (
    MINUTE_MS,
    ResolvedWindow,
    current_minute_start,
    resolve_analysis_window,
)

HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS


def _ms(text: str) -> int:
    """An ISO-8601 UTC instant as epoch milliseconds."""
    return int(dt.datetime.fromisoformat(text).timestamp() * 1000)


NOW = _ms("2026-03-14T14:32:47.812+00:00")
MINUTE = _ms("2026-03-14T14:32:00+00:00")


def _live(duration: int, gap: int = 0) -> LiveAnalysisWindow:
    return LiveAnalysisWindow(mode="live", durationMinutes=duration, endGapMinutes=gap)


def _fixed(start: int, end: int) -> FixedAnalysisWindow:
    return FixedAnalysisWindow(mode="fixed", start=start, end=end)


# --- Live ------------------------------------------------------------------


def test_a_zero_gap_live_end_is_the_start_of_the_current_minute() -> None:
    """The partial minute is excluded, so the answer is stable within it.

    At 14:32:47 the obvious implementation ends the window at 14:32:47, and
    two requests a second apart then select different Posts while both
    reporting "the last 24 hours".
    """
    window = resolve_analysis_window(_live(24 * 60), now_ms=NOW)

    assert window == ResolvedWindow(start=MINUTE - DAY_MS, end=MINUTE)
    assert window.end == _ms("2026-03-14T14:32:00+00:00")


def test_the_end_gap_moves_both_boundaries_and_keeps_the_duration() -> None:
    """Ten hours ago through thirty minutes ago, the spec's own example."""
    window = resolve_analysis_window(_live(duration=10 * 60, gap=30), now_ms=NOW)

    assert window.end == MINUTE - 30 * MINUTE_MS
    assert window.start == MINUTE - 30 * MINUTE_MS - 10 * HOUR_MS
    assert window.end - window.start == 10 * HOUR_MS


def test_a_live_window_advances_with_the_clock() -> None:
    """The whole point of the mode: the same input, a later now, a later pair."""
    first = resolve_analysis_window(_live(60), now_ms=NOW)
    later = resolve_analysis_window(_live(60), now_ms=NOW + 5 * MINUTE_MS)

    assert later.start == first.start + 5 * MINUTE_MS
    assert later.end == first.end + 5 * MINUTE_MS


def test_a_duration_of_one_minute_is_the_floor_and_zero_is_refused() -> None:
    assert resolve_analysis_window(_live(1), now_ms=NOW) == ResolvedWindow(
        start=MINUTE - MINUTE_MS, end=MINUTE
    )
    with pytest.raises(ValueError):
        _live(0)
    with pytest.raises(ValueError):
        _live(-5)


def test_a_zero_end_gap_is_valid_and_a_negative_one_is_not() -> None:
    """Ending at the current minute needs no dedicated shortcut (story 19)."""
    assert resolve_analysis_window(_live(60, gap=0), now_ms=NOW).end == MINUTE
    with pytest.raises(ValueError):
        _live(60, gap=-1)


@pytest.mark.parametrize(
    ("minutes", "expected_ms"),
    [
        (24 * 60, DAY_MS),
        (7 * 24 * 60, 7 * DAY_MS),
    ],
)
def test_duration_is_exact_elapsed_utc_across_a_daylight_saving_change(
    minutes: int, expected_ms: int
) -> None:
    """A day is 24 hours and a week is 168, spring-forward included.

    `now` here is the afternoon of the US spring-forward Sunday, so a Duration
    counted in local calendar days would come out an hour short. The corpus and
    the quota ledger are both UTC; a window that silently resized twice a year
    could not be reproduced from the Artifact it produced.
    """
    window = resolve_analysis_window(_live(minutes), now_ms=NOW)

    assert window.end - window.start == expected_ms


# --- Fixed -----------------------------------------------------------------


def test_fixed_boundaries_are_floored_to_the_minute() -> None:
    """An end displayed as 02:00 is the instant 02:00:00.000 (AW-01)."""
    window = resolve_analysis_window(
        _fixed(_ms("2026-03-13T02:00:31.500+00:00"), _ms("2026-03-14T02:00:59+00:00")),
        now_ms=NOW,
    )

    assert window == ResolvedWindow(
        start=_ms("2026-03-13T02:00:00+00:00"),
        end=_ms("2026-03-14T02:00:00+00:00"),
    )


def test_a_crossed_pair_is_refused_rather_than_swapped() -> None:
    with pytest.raises(HTTPException) as caught:
        resolve_analysis_window(_fixed(MINUTE - HOUR_MS, MINUTE - DAY_MS), now_ms=NOW)

    assert caught.value.status_code == 422
    assert "before" in str(caught.value.detail)


def test_a_sub_minute_fixed_window_is_refused_by_the_same_rule() -> None:
    """Both bounds floor into one minute, so start == end, so there is no window."""
    start = _ms("2026-03-14T09:15:10+00:00")
    with pytest.raises(HTTPException) as caught:
        resolve_analysis_window(_fixed(start, start + 30_000), now_ms=NOW)

    assert caught.value.status_code == 422


def test_a_fixed_end_past_the_current_minute_is_refused_rather_than_clamped() -> None:
    """Story 17. Clamping puts a value on screen that is not the one used."""
    with pytest.raises(HTTPException) as caught:
        resolve_analysis_window(_fixed(MINUTE - DAY_MS, MINUTE + MINUTE_MS), now_ms=NOW)

    assert caught.value.status_code == 422
    assert "future" in str(caught.value.detail).lower()


def test_a_fixed_end_inside_the_current_minute_floors_onto_it_and_is_accepted() -> None:
    """14:32:47 is not "later than the current minute"; it is that minute.

    The refusal is about a boundary the clock has not reached. A client whose
    clock ran a few seconds ahead of the server used to have its request
    silently clamped; now it floors onto the same minute the server is in,
    which is the value the editor was displaying anyway.
    """
    window = resolve_analysis_window(_fixed(MINUTE - DAY_MS, NOW), now_ms=NOW)

    assert window.end == MINUTE


def test_a_fixed_window_does_not_move_with_the_clock() -> None:
    fixed = _fixed(MINUTE - DAY_MS, MINUTE)

    assert resolve_analysis_window(fixed, now_ms=NOW) == resolve_analysis_window(
        fixed, now_ms=NOW + 9 * DAY_MS
    )


# --- The open window -------------------------------------------------------


def test_no_window_leaves_both_sides_open() -> None:
    """The export and lookup fallbacks read newest-first over the whole corpus.

    They are not a Scope anybody selected, so they send no window rather than
    a Fixed pair spanning the epoch — and `analysis_window_clauses` already
    takes `None` per side.
    """
    assert resolve_analysis_window(None, now_ms=NOW) == ResolvedWindow(
        start=None, end=None
    )


def test_the_current_minute_floors_and_is_stable_within_the_minute() -> None:
    assert current_minute_start(NOW) == MINUTE
    assert current_minute_start(MINUTE) == MINUTE
    assert current_minute_start(MINUTE + MINUTE_MS - 1) == MINUTE
    assert current_minute_start(MINUTE + MINUTE_MS) == MINUTE + MINUTE_MS


# --- The guard that makes the rest of it true ------------------------------
#
# Off `app.openapi()` rather than `app.routes`: this FastAPI keeps included
# routers lazy, so walking `app.routes` finds four default routes and nothing
# else — the same trap `tests/api/test_account_isolation.py` documents. Reading
# the generated spec has a second advantage here, since the wire contract is
# exactly what this ticket is about: the guard sees `startDate`, the alias a
# client would actually send, not the Python attribute name.


def _schema_refs(node: object, out: set[str]) -> None:
    """Every `#/components/schemas/X` name reachable from a schema fragment."""
    if isinstance(node, dict):
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith(_SCHEMA_PREFIX):
            out.add(ref[len(_SCHEMA_PREFIX) :])
        for value in node.values():
            _schema_refs(value, out)
    elif isinstance(node, list):
        for value in node:
            _schema_refs(value, out)


_SCHEMA_PREFIX = "#/components/schemas/"


def _request_schemas() -> dict[str, dict[str, object]]:
    """Every schema a mounted operation accepts in its body, keyed by name.

    Transitive: a model nested inside a request body is a request body too,
    which is how `PromptScopeInput` — reachable only through the three AI
    request models — is covered without being named.
    """
    spec = app.openapi()
    components: dict[str, dict[str, object]] = spec["components"]["schemas"]

    names: set[str] = set()
    for operations in spec["paths"].values():
        for operation in operations.values():
            if isinstance(operation, dict) and "requestBody" in operation:
                _schema_refs(operation["requestBody"], names)

    resolved: set[str] = set()
    while names - resolved:
        name = (names - resolved).pop()
        resolved.add(name)
        if name in components:
            _schema_refs(components[name], names)

    return {name: components[name] for name in resolved if name in components}


def _properties(schema: dict[str, object]) -> set[str]:
    properties = schema.get("properties")
    return set(properties) if isinstance(properties, dict) else set()


#: Request schemas that still carry `startDate`/`endDate`, and why each is not
#: an Analysis window the server should be resolving.
#:
#: Every one is an Artifact *write* — a client posting a row it already holds,
#: on the import and legacy-create paths. The boundaries there are history, not
#: a selection: they describe a window that has already been used, so resolving
#: them against the current minute would answer the wrong question, and
#: refusing a past-dated one would refuse an import of last year's Summaries.
#:
#: AW-05 replaces them anyway, by freezing the Scope server-side at submission
#: so an Artifact's window is never something a client states at all. Until
#: then they stay, named here rather than tolerated silently.
FROZEN_ARTIFACT_WRITES: dict[str, str] = {
    "SummaryUpsertRequest": (
        "A Summary the client already holds, re-posted or imported. Its "
        "boundaries are the window that produced the text, so they are a "
        "record rather than a request — resolving them against the current "
        "minute would answer a question nobody asked, and refusing a "
        "past-dated one would refuse an import of last year's Summaries."
    ),
}


def test_no_request_schema_still_carries_the_browser_computed_pair() -> None:
    """The structural half of AW-02, and the half that makes it hold.

    Resolving through `resolve_analysis_window` is a convention, and a route
    that forgot it would look entirely correct — it would simply select Posts
    by whichever clock the caller happened to have. So the legacy fields were
    *removed* rather than deprecated: with no `startDate` on the request, there
    is no pair to select by except the one the resolver returns.

    Derived from the mounted spec rather than a list of models, so a new Scope
    route is covered the day it is written.
    """
    offenders = {
        name
        for name, schema in _request_schemas().items()
        if {"startDate", "endDate"} & _properties(schema)
    }
    stranded = sorted(offenders - set(FROZEN_ARTIFACT_WRITES))

    assert not stranded, (
        "These request schemas still carry a browser-computed window: "
        + ", ".join(stranded)
        + ". Take an `AnalysisWindowInput` and resolve it, or add the schema to "
        "FROZEN_ARTIFACT_WRITES with the reason it is an Artifact's history "
        "rather than a selection."
    )


def test_the_frozen_artifact_exceptions_are_all_still_real() -> None:
    """An exception nobody checks becomes a leftover nobody dares touch.

    AW-05 removes these from the wire. When it does, this fails rather than
    leaving stale names reading as a deliberate carve-out.
    """
    schemas = _request_schemas()
    stale = sorted(
        name
        for name in FROZEN_ARTIFACT_WRITES
        if name not in schemas
        or not {"startDate", "endDate"} & _properties(schemas[name])
    )

    assert not stale, (
        "FROZEN_ARTIFACT_WRITES names schemas that no longer carry the pair (or "
        "are no longer mounted): " + ", ".join(stale) + ". Drop the entries."
    )


def test_every_scope_carrying_request_states_a_window() -> None:
    """The other direction: the three Scope shapes all take the new input.

    Named rather than derived, because "carries a Scope" is not a property a
    schema declares — and the point of listing them is that a fourth appearing
    without a window is a question somebody has to answer deliberately.
    """
    schemas = _request_schemas()
    for name in ("PostScopeRequest", "RagSearchRequest", "PromptScopeInput"):
        assert name in schemas, f"{name} is no longer reachable from a mounted route"
        assert "window" in _properties(schemas[name]), (
            f"{name} carries a Post scope but states no Analysis window"
        )


def test_the_window_reaches_the_client_as_a_discriminated_union() -> None:
    """Two shapes told apart by `mode`, not four optional fields.

    The generated TypeScript is where this is felt: a union gives the client a
    `mode` to switch on, while an all-optional flat object gives it four
    `| undefined`s and a precedence rule somebody has to invent — which is the
    inference ADR-018 refuses.
    """
    schemas = _request_schemas()
    window = schemas["PostScopeRequest"]["properties"]["window"]  # type: ignore[index]

    refs: set[str] = set()
    _schema_refs(window, refs)
    assert {"LiveAnalysisWindow", "FixedAnalysisWindow"} <= refs

    for name in ("LiveAnalysisWindow", "FixedAnalysisWindow"):
        assert "mode" in _properties(schemas[name])
