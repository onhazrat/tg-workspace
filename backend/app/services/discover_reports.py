"""Saved Discover reports: generate-and-persist, list, read, delete.

A Discover report is an artifact, not a view (IDEA-011 W1). Generating one runs
`compute_discover_candidates` and stores the result together with a snapshot of
the scope it was generated for. Nothing the user does afterwards — reselecting
channels, changing the Posts-tab filters, syncing — alters an existing report.

Two things are deliberately *not* frozen into the stored row:

* **`isFollowed`** is derived against the live `tg_channels` set on every read,
  so a report self-corrects as its candidates get followed. Counts are
  historical; follow state is live.
* **Sample post bodies.** Only the pointer (channel, post id, timestamp) is
  stored. Retention may prune the post later; callers render a Telegram
  web-view link so the evidence stays investigable outside our corpus.

Mirrors `app/services/summaries.py`, including its light-vs-full projection
split: a report's `candidates` list is the corpus-sized field here, so the list
endpoint must never ship it.
"""

from __future__ import annotations

import uuid
from typing import Any
from typing import cast as typing_cast

from fastapi import HTTPException
from sqlalchemy import Text, or_
from sqlalchemy import cast as sa_cast
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.models_tg import Channel, DiscoverReport, utc_now
from app.services.discover import SignalKind, compute_discover_candidates
from app.services.discover_ignored import ignored_handles
from app.services.discover_probes import enqueue_handles, probe_map
from app.services.post_filters import PostFilters

DEFAULT_REPORT_PAGE_SIZE = 100
MAX_REPORT_PAGE_SIZE = 1000


def _now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def _scope(report: DiscoverReport) -> dict[str, Any]:
    """The frozen inputs — what this report was generated *for*.

    Rendered by the scope card instead of live selection state, which is the
    whole point of storing it: after the user changes tabs, live state no longer
    describes where these numbers came from.
    """
    return {
        "channels": report.channels or [],
        "startDate": report.start_date,
        "endDate": report.end_date,
        "signals": report.signals or [],
        "keyword": report.keyword,
        "forwarded": report.forwarded,
        "media": report.media,
        "maxPerChannel": report.max_per_channel,
        "maxPerChannelMode": report.max_per_channel_mode,
        "seed": report.seed,
        "scopedPostCount": report.scoped_post_count,
    }


def _base(report: DiscoverReport) -> dict[str, Any]:
    return {
        "id": report.id,
        "scope": _scope(report),
        "scopeCounts": report.scope_counts or {},
        "postsInScope": report.posts_in_scope,
        "timestamp": report.timestamp,
    }


def followed_names(session: Session) -> set[str]:
    return {
        name.lower()  # ty: ignore[unresolved-attribute]
        for name in session.exec(select(Channel.name)).all()
    }


def _candidate_handle(candidate: dict[str, Any]) -> str:
    name = candidate.get("name")
    return name.lstrip("@").strip().lower() if isinstance(name, str) else ""


def _with_live_state(
    candidates: list[Any],
    followed: set[str],
    ignored: set[str],
    probes: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Overlay `isFollowed` / `isIgnored` / `probe` from live state.

    The stored candidate rows carry whatever `compute_discover_candidates`
    produced at generate time; those values are authoritative only for the
    instant they were written, so they are replaced rather than trusted. This is
    what makes following, dismissing or probing a candidate update every saved
    report at once instead of only the one on screen.

    `probe` is `None` for a handle nothing has looked at yet, which the client
    renders as "not checked" rather than as a verdict — an unprobed handle and
    one confirmed unfollowable must not look the same.
    """
    out: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        handle = _candidate_handle(candidate)
        out.append(
            {
                **candidate,
                "isFollowed": handle in followed,
                "isIgnored": handle in ignored,
                "probe": probes.get(handle),
            }
        )
    return out


def report_to_camel(session: Session, report: DiscoverReport) -> dict[str, Any]:
    """Full projection, including every candidate."""
    followed = followed_names(session)
    ignored = ignored_handles(session)
    stored = report.candidates or []
    handles = {_candidate_handle(c) for c in stored if isinstance(c, dict)} - {""}
    probes = probe_map(session, handles)
    return {
        **_base(report),
        "candidates": _with_live_state(stored, followed, ignored, probes),
        "candidateCount": len(stored),
        **(report.extra or {}),
    }


#: The one corpus-sized column: a wide-scope report holds the whole
#: single-reference tail.
HEAVY_REPORT_COLUMNS = frozenset({"candidates"})


def _light_columns() -> list[Any]:
    """Every `tg_discover_reports` column except `candidates`.

    Columns, not the entity. `report_to_camel_light` used to compute
    `candidateCount` as `len(report.candidates)` off a `select(DiscoverReport)`
    — detoasting the entire candidate array of every row on the page in order to
    ship one integer. `candidate_count` is a real column now, maintained on
    write, and this select is what makes the saving real.
    """
    return [
        c
        # `__table__` is set by SQLModel's metaclass at runtime — same cast
        # `logs.py::_log_table` uses.
        for c in typing_cast(Any, DiscoverReport).__table__.columns
        if c.key not in HEAVY_REPORT_COLUMNS
    ]


def _light_from_mapping(row: dict[str, Any]) -> dict[str, Any]:
    """The list projection, built from a column mapping rather than an entity."""
    return {
        "id": row["id"],
        "scope": {
            "channels": row["channels"],
            "startDate": row["start_date"],
            "endDate": row["end_date"],
            "signals": row["signals"],
            "keyword": row["keyword"],
            "forwarded": row["forwarded"],
            "media": row["media"],
            "maxPerChannel": row["max_per_channel"],
            "maxPerChannelMode": row["max_per_channel_mode"],
            "seed": row["seed"],
            "scopedPostCount": row["scoped_post_count"],
        },
        "scopeCounts": row["scope_counts"] or {},
        "postsInScope": row["posts_in_scope"],
        "timestamp": row["timestamp"],
        "candidateCount": row["candidate_count"],
        **(row.get("extra") or {}),
    }


def report_to_camel_light(report: DiscoverReport) -> dict[str, Any]:
    """List projection: metadata and counts, never the candidate rows.

    Follow state is not resolved here because nothing in the list view renders
    it. Kept for callers that already hold an entity; `list_reports` goes
    through `_light_from_mapping` so it never materialises one.
    """
    return _light_from_mapping(
        {c.key: getattr(report, c.key) for c in _light_columns()}
    )


def _search_clause(term: str) -> Any:
    """Case-insensitive match over the scope, for the history search box.

    Only scope fields are searchable: matching the candidate blob would make
    every report containing a popular handle a hit for that handle, which is
    not what someone searching their report history is asking for.
    """
    like = f"%{term}%"
    return or_(
        sa_cast(col(DiscoverReport.channels), Text).ilike(like),
        col(DiscoverReport.keyword).ilike(like),
    )


def list_reports(
    session: Session,
    *,
    limit: int = DEFAULT_REPORT_PAGE_SIZE,
    offset: int = 0,
    search: str | None = None,
) -> list[dict[str, Any]]:
    """One newest-first page of reports in the light projection."""
    statement = sa_select(*_light_columns())
    if search and search.strip():
        statement = statement.where(_search_clause(search.strip()))
    statement = (
        statement.order_by(col(DiscoverReport.timestamp).desc(), col(DiscoverReport.id))
        .offset(offset)
        .limit(limit)
    )
    return [
        _light_from_mapping(dict(row._mapping))
        for row in session.execute(statement).all()
    ]


def update_report_flags(
    session: Session, report_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    """Set the small UI flags on a saved report.

    The only write a report accepts. A report is otherwise immutable by design —
    changing the scope produces a *new* report rather than editing this one — so
    this deliberately touches nothing but `extra`. It exists because History
    became one list over all four artifact kinds, and a starred-only filter that
    skipped two of them would be worse than not having one.
    """
    report = session.get(DiscoverReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")

    merged = dict(report.extra or {})
    for key in ("isStarred", "note"):
        if key not in body:
            continue
        value = body[key]
        if value is None:
            merged.pop(key, None)
        else:
            merged[key] = value
    report.extra = merged
    report.updated_at = utc_now()
    session.add(report)
    session.commit()
    session.refresh(report)
    return report_to_camel(session, report)


def get_report(session: Session, report_id: str) -> dict[str, Any]:
    report = session.get(DiscoverReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    return report_to_camel(session, report)


def create_report(
    session: Session,
    *,
    channel_names: list[str],
    start_date: int | None,
    end_date: int | None,
    signals: set[SignalKind] | None,
    filters: PostFilters,
    max_per_channel: int,
    max_per_channel_mode: str = "latest",
    seed: int = 0,
    post_ids: list[tuple[str, int]] | None = None,
    user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Run the aggregation and persist it as a new report.

    Always creates; never overwrites an existing report for the same scope. Two
    runs over identical inputs are legitimately different artifacts — the corpus
    grows between them, and comparing the two is the point of keeping both.
    """
    result = compute_discover_candidates(
        session,
        channel_names=channel_names,
        start_date=start_date,
        end_date=end_date,
        signals=signals,
        filters=filters,
        max_per_channel=max_per_channel,
        max_per_channel_mode=max_per_channel_mode,
        seed=seed,
        post_ids=post_ids,
    )

    report = DiscoverReport(
        id=str(uuid.uuid4()),
        user_id=user_id,
        channels=channel_names,
        start_date=start_date or 0,
        end_date=end_date or 0,
        signals=sorted(signals) if signals is not None else [],
        keyword=filters.keyword,
        forwarded=filters.forwarded,
        media=filters.media,
        max_per_channel=max_per_channel,
        max_per_channel_mode=max_per_channel_mode,
        seed=seed,
        scoped_post_count=None if post_ids is None else len(post_ids),
        candidates=result["candidates"],
        # Maintained on write so the list never opens `candidates` to count it.
        candidate_count=len(result["candidates"]),
        scope_counts=result["scopeCounts"],
        posts_in_scope=result["postsInScope"],
        timestamp=_now_ms(),
        updated_at=utc_now(),
    )
    session.add(report)
    session.commit()
    session.refresh(report)

    # Queue the handles for probing. This is the only enqueue point for reports:
    # they are created server-side with the candidates already ranked, so rank
    # order — which is the probe drain order — comes for free here and could not
    # be reconstructed as reliably anywhere else. Handles with a verdict already
    # are skipped inside `enqueue_handles`, so a report over familiar channels
    # queues nothing.
    enqueue_handles(session, [c["name"] for c in result["candidates"]])

    return report_to_camel(session, report)


def delete_report(session: Session, report_id: str) -> None:
    report = session.get(DiscoverReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    session.delete(report)
    session.commit()
