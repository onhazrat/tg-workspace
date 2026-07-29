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

from fastapi import HTTPException
from sqlalchemy import Text, or_
from sqlalchemy import cast as sa_cast
from sqlmodel import Session, col, select

from app.models_tg import Channel, DiscoverReport, utc_now
from app.services.discover import SignalKind, compute_discover_candidates
from app.services.discover_ignored import ignored_handles
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


def _with_live_state(
    candidates: list[Any], followed: set[str], ignored: set[str]
) -> list[dict[str, Any]]:
    """Overlay `isFollowed` / `isIgnored` from live state.

    The stored candidate rows carry whatever `compute_discover_candidates`
    produced at generate time; those values are authoritative only for the
    instant they were written, so they are replaced rather than trusted. This is
    what makes following or dismissing a candidate update every saved report at
    once instead of only the one on screen.
    """
    out: list[dict[str, Any]] = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        name = candidate.get("name")
        handle = name.lstrip("@").strip().lower() if isinstance(name, str) else ""
        out.append(
            {
                **candidate,
                "isFollowed": handle in followed,
                "isIgnored": handle in ignored,
            }
        )
    return out


def report_to_camel(session: Session, report: DiscoverReport) -> dict[str, Any]:
    """Full projection, including every candidate."""
    followed = followed_names(session)
    ignored = ignored_handles(session)
    stored = report.candidates or []
    return {
        **_base(report),
        "candidates": _with_live_state(stored, followed, ignored),
        "candidateCount": len(stored),
    }


def report_to_camel_light(report: DiscoverReport) -> dict[str, Any]:
    """List projection: metadata and counts, never the candidate rows.

    `candidates` is the corpus-sized field — a wide-scope report holds the full
    single-reference tail — so the history list gets a count instead. Follow
    state is not resolved here because nothing in the list view renders it.
    """
    stored = report.candidates or []
    return {**_base(report), "candidateCount": len(stored)}


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
    statement = select(DiscoverReport)
    if search and search.strip():
        statement = statement.where(_search_clause(search.strip()))
    statement = (
        statement.order_by(col(DiscoverReport.timestamp).desc(), col(DiscoverReport.id))
        .offset(offset)
        .limit(limit)
    )
    return [report_to_camel_light(r) for r in session.exec(statement).all()]


def get_report(session: Session, report_id: str) -> dict[str, Any]:
    report = session.get(DiscoverReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    return report_to_camel(session, report)


def latest_report(session: Session) -> dict[str, Any] | None:
    """The most recent report, or None when the user has never generated one.

    Discover opens on this, which is what makes reports feel persistent rather
    than like a cache of the last run.
    """
    statement = select(DiscoverReport).order_by(
        col(DiscoverReport.timestamp).desc(), col(DiscoverReport.id)
    )
    report = session.exec(statement).first()
    return report_to_camel(session, report) if report is not None else None


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
        scope_counts=result["scopeCounts"],
        posts_in_scope=result["postsInScope"],
        timestamp=_now_ms(),
        updated_at=utc_now(),
    )
    session.add(report)
    session.commit()
    session.refresh(report)
    return report_to_camel(session, report)


def delete_report(session: Session, report_id: str) -> None:
    report = session.get(DiscoverReport, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="report not found")
    session.delete(report)
    session.commit()
