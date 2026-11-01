"""Walked ranges: the post ids of a Channel a sync read without a break (ADR-044).

An aggregate, the sole writer of `tg_walked_ranges`. A page of a walk proves
every Post Telegram shows publicly from its oldest id up to the id the page
was asked below (or, for the newest page, up to its newest id), and a walk's
pages chain through each page's oldest id. So recording each page as a range,
merged with every range it touches or overlaps, leaves one range per walk,
joined to every range that walk reached. An id missing inside a range is a Post
that does not exist publicly; a **Hole** is the ids between two ranges.

A Channel is synced by one runner at a time (its claim), so no two writers
merge the same Channel's ranges at once.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, replace

from sqlalchemy import delete as sa_delete
from sqlmodel import Session, col, select

from app.models_tg import Post, WalkedRange, utc_now
from app.services.tenancy import scoped_select


@dataclass(frozen=True)
class Span:
    """One Walked range, as plain values."""

    lo_id: int
    hi_id: int
    lo_ts: int
    hi_ts: int
    top_read_at: int | None = None
    reached_start: bool = False


def _span(row: WalkedRange) -> Span:
    return Span(
        lo_id=row.lo_id,
        hi_id=row.hi_id,
        lo_ts=row.lo_ts,
        hi_ts=row.hi_ts,
        top_read_at=row.top_read_at,
        reached_start=row.reached_start,
    )


def _merged(spans: list[Span]) -> Span:
    """One range over touching or overlapping ones.

    The top-read moment is the latest of the parts': a head read proved
    nothing existed above its own top then, so nothing above the merged top
    did either. Taking the topmost part's instead loses a fresh read whenever
    the newest Post held was deleted since.
    """
    bottom = min(spans, key=lambda s: s.lo_id)
    reads = [s.top_read_at for s in spans if s.top_read_at is not None]
    return Span(
        lo_id=bottom.lo_id,
        hi_id=max(s.hi_id for s in spans),
        lo_ts=min(s.lo_ts for s in spans),
        hi_ts=max(s.hi_ts for s in spans),
        top_read_at=max(reads, default=None),
        reached_start=any(s.reached_start and s.lo_id == bottom.lo_id for s in spans),
    )


def _replace(
    session: Session, channel_name: str, old: list[WalkedRange], new: Span
) -> None:
    """Write `new` over the first of `old` and delete the rest, so a range a
    walk extends page by page stays one row."""
    row = WalkedRange(
        channel_name=channel_name,
        lo_id=new.lo_id,
        hi_id=new.hi_id,
        lo_ts=new.lo_ts,
        hi_ts=new.hi_ts,
        top_read_at=new.top_read_at,
        reached_start=new.reached_start,
        updated_at=utc_now(),
    )
    if old:
        old[0].sqlmodel_update(row.model_dump(exclude={"id"}))
        row = old[0]
        for extra in old[1:]:
            session.delete(extra)
    session.add(row)
    session.flush()


def record_page(session: Session, channel_name: str, page: Span) -> None:
    """A walk read `page`: merge it with every range it touches or overlaps.

    Does not commit, so the range lands in the transaction that stores the
    page's Posts, and a walk cut short keeps exactly the pages it applied.
    """
    touching = list(
        session.exec(
            select(WalkedRange).where(
                WalkedRange.channel_name == channel_name,
                col(WalkedRange.lo_id) <= page.hi_id + 1,
                col(WalkedRange.hi_id) >= page.lo_id - 1,
            )
        ).all()
    )
    _replace(session, channel_name, touching, _merged([page, *map(_span, touching)]))


def mark_reached_start(session: Session, channel_name: str, *, below_id: int) -> None:
    """A walk asked for the page below `below_id` and found none: the range
    holding it reaches the Channel's first Post. Only the lowest range can: a
    range with another below it reached only a stretch Telegram no longer
    shows."""
    row = session.exec(
        select(WalkedRange)
        .where(WalkedRange.channel_name == channel_name)
        .order_by(col(WalkedRange.lo_id))
        .limit(1)
    ).first()
    if row is not None and row.lo_id <= below_id <= row.hi_id:
        row.reached_start = True
        row.updated_at = utc_now()
        session.add(row)
        session.flush()


def ranges_of(
    session: Session, user_id: uuid.UUID, names: Iterable[str]
) -> dict[str, list[Span]]:
    """Each followed Channel's ranges, lowest first."""
    rows = session.exec(
        scoped_select(
            select(WalkedRange)
            .where(col(WalkedRange.channel_name).in_(list(names)))
            .order_by(col(WalkedRange.channel_name), col(WalkedRange.lo_id)),
            WalkedRange,
            user_id,
        )
    ).all()
    out: dict[str, list[Span]] = {}
    for row in rows:
        out.setdefault(row.channel_name, []).append(_span(row))
    return out


def channel_ranges(session: Session, channel_name: str) -> list[Span]:
    """One Channel's ranges, lowest first, for the sync that holds its claim."""
    rows = session.exec(
        select(WalkedRange)
        .where(WalkedRange.channel_name == channel_name)
        .order_by(col(WalkedRange.lo_id))
    ).all()
    return [_span(row) for row in rows]


def holes(ranges: list[Span]) -> list[tuple[Span, Span]]:
    """Each Hole as the ranges either side of it, lower first, from ranges
    sorted lowest first."""
    return [
        (lower, upper)
        for lower, upper in zip(ranges, ranges[1:], strict=False)
        if upper.lo_id > lower.hi_id + 1
    ]


def trim_below(session: Session, channel_name: str) -> None:
    """After retention deleted a Channel's oldest Posts: no range claims ids
    below its lowest remaining Post, nor a first Post it no longer holds. An
    anchor outlives the sweep but not the Posts above it, so it does not count.
    """
    lowest = session.exec(
        select(Post.post_id, Post.timestamp)
        .where(Post.channel_name == channel_name, col(Post.is_anchor).is_(False))
        .order_by(col(Post.post_id))
        .limit(1)
    ).first()
    if lowest is None:
        clear(session, channel_name)
        return
    low_id, low_ts = lowest
    session.execute(
        sa_delete(WalkedRange).where(
            col(WalkedRange.channel_name) == channel_name,
            col(WalkedRange.hi_id) < low_id,
        )
    )
    for row in session.exec(
        select(WalkedRange).where(
            WalkedRange.channel_name == channel_name,
            col(WalkedRange.lo_id) < low_id,
        )
    ).all():
        trimmed = replace(_span(row), lo_id=low_id, lo_ts=low_ts, reached_start=False)
        _replace(session, channel_name, [row], trimmed)


def clear(session: Session, channel_name: str) -> None:
    """Forget every range of a Channel whose Posts are gone."""
    session.execute(
        sa_delete(WalkedRange).where(col(WalkedRange.channel_name) == channel_name)
    )
