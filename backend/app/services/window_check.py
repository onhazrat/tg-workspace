"""Which Channels of a Scope are Incomplete, and why (ADR-043). A read model.

`check_window` answers, for an Account, Channel names, a window and a frozen
moment, each Channel's verdict. E is the earlier of the window's End and the
frozen moment. A Channel is Complete when all three tests hold:

1. head: a sync read its newest page at or after E (`head_read_at`), or a
   Post published after E is held;
2. start: a Post at or before the Start is held, or a walk reached the
   Channel's first Post;
3. continuity: every id from that Post (or the first one held) to the head
   (the first Post after E, or the newest held) is held or a confirmed gap.

Each failing test leaves an unproven stretch: the end from the last proven
moment to E, a hole between the Posts either side of its missing ids, the
start from the Start to the first Post. Everything is read from data, so a
Follow made yesterday, a capped walk and another Follower's older sync need
no special case. The corpus is read through the Follow-scoped seam, and
frozen, unavailable and the schedule from the Account's own Follows.

**Unproven Posts** is how much an Incomplete window may lack: a hole's
missing ids exactly, every other stretch at the Channel's pace, Posts an hour
over the week before its head-read moment (no earlier than its first Post or
the scrape cutoff). A pace over less than an hour is unknown, and an unknown
pace under a non-hole stretch makes the total a floor.

The live check reads only what it holds now; it never syncs. Skipped and
timed out are the action's: `freeze_record` lays them over the check an
Artifact freezes (CW-02). Refused is the scheduler's (CW-03).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

from sqlalchemy import BigInteger, String, column, func, values
from sqlalchemy import select as sa_select
from sqlmodel import Session, col, select

from app.jobs.settings import (
    compute_scrape_cutoff_ms,
    load_retention_policy,
    load_sync_settings,
)
from app.models_tg import Channel, ChannelSettingGroup, Post, PostSyncState, SyncLog
from app.schemas.window_check import (
    ChannelVerdict,
    Completeness,
    GateOutcome,
    Reason,
    UnprovenStretch,
    WindowCheckResponse,
)
from app.services.follows import followed_with_groups
from app.services.telegram_web import UNAVAILABLE_WEB_VIEW_MESSAGE
from app.services.tenancy import scoped_select

HOUR_MS = 3_600_000
WEEK_MS = 7 * 24 * HOUR_MS

#: ADR-043's order: what a person can act on first.
REASON_ORDER: tuple[Reason, ...] = (
    "skipped",
    "failed",
    "timed_out",
    "refused",
    "end",
    "hole",
    "start",
    "retention",
    "frozen",
    "unavailable",
)


@dataclass
class _Held:
    """What the workspace holds of one Channel, as the three tests read it."""

    first_id: int | None = None
    first_ts: int | None = None
    max_id: int | None = None
    #: The newest Post at or before the Start, and the first one after E.
    start_id: int | None = None
    head_id: int | None = None
    newest_ts: int | None = None
    held: int = 0


def _held(
    session: Session, user_id: uuid.UUID, names: list[str], start: int, e: int
) -> dict[str, _Held]:
    ts, pid = col(Post.timestamp), col(Post.post_id)
    rows = session.execute(
        scoped_select(
            sa_select(
                col(Post.channel_name),
                func.min(pid),
                func.min(ts),
                func.max(pid),
                func.max(pid).filter(ts <= start),
                func.min(pid).filter(ts > e),
                func.max(ts).filter(ts <= e),
                func.count().filter(ts >= start, ts <= e),
            )
            .where(col(Post.channel_name).in_(names))
            .group_by(col(Post.channel_name)),
            Post,
            user_id,
        )
    ).all()
    return {str(row[0]): _Held(*row[1:]) for row in rows}


def _ranges(name: str, rows: list[tuple[str, int, int]]) -> Any:
    return values(
        column("name", String),
        column("lo", BigInteger),
        column("hi", BigInteger),
        name=name,
    ).data(rows)


def _accounted(
    session: Session, user_id: uuid.UUID, spans: list[tuple[str, int, int]]
) -> dict[str, int]:
    """Per Channel, the ids in `[lo, hi]` held as a Post or a confirmed gap.

    Disjoint by construction: storing a Post clears its gap.
    """
    counts: dict[str, int] = {}
    if not spans:
        return counts
    for model in (Post, PostSyncState):
        r = _ranges("r", spans)
        key, pid = col(model.channel_name), col(model.post_id)
        rows = session.exec(
            scoped_select(
                select(key, func.count())
                .join(r, (r.c.name == key) & pid.between(r.c.lo, r.c.hi))
                .group_by(key),
                model,
                user_id,
            )
        ).all()
        for name, n in rows:
            counts[str(name)] = counts.get(str(name), 0) + int(n)
    return counts


def _hole_bounds(
    session: Session, user_id: uuid.UUID, name: str, lo: int, hi: int
) -> tuple[int, int]:
    """When the Posts either side of a Channel's first and last missing id
    were published: the hole's stretch."""
    accounted = sorted(
        {
            *session.exec(
                scoped_select(
                    select(Post.post_id).where(
                        Post.channel_name == name, col(Post.post_id).between(lo, hi)
                    ),
                    Post,
                    user_id,
                )
            ).all(),
            *session.exec(
                scoped_select(
                    select(PostSyncState.post_id).where(
                        PostSyncState.channel_name == name,
                        col(PostSyncState.post_id).between(lo, hi),
                    ),
                    PostSyncState,
                    user_id,
                )
            ).all(),
        }
    )
    breaks = [
        (a, b) for a, b in zip(accounted, accounted[1:], strict=False) if b > a + 1
    ]
    before, after = breaks[0][0], breaks[-1][1]
    stamps = dict(
        session.exec(
            scoped_select(
                select(Post.post_id, Post.timestamp).where(
                    Post.channel_name == name, col(Post.post_id).in_([before, after])
                ),
                Post,
                user_id,
            )
        ).all()
    )
    # A neighbour that is a confirmed gap, not a Post, has no time: the hole
    # then reaches the window's edge.
    return stamps.get(before, 0), stamps.get(after, 2**62)


def _last_logs(
    session: Session, user_id: uuid.UUID, names: list[str], frozen_at: int
) -> dict[str, tuple[str, str | None]]:
    rows = session.exec(
        scoped_select(
            select(SyncLog.channel_name, SyncLog.status, SyncLog.error)
            .where(col(SyncLog.channel_name).in_(names), SyncLog.timestamp <= frozen_at)
            .order_by(col(SyncLog.channel_name), col(SyncLog.timestamp).desc())
            .distinct(col(SyncLog.channel_name)),
            SyncLog,
            user_id,
        )
    ).all()
    return {str(name): (str(status), error) for name, status, error in rows}


def _week_posts(
    session: Session, user_id: uuid.UUID, spans: list[tuple[str, int, int]]
) -> dict[str, int]:
    if not spans:
        return {}
    r = _ranges("p", spans)
    rows = session.exec(
        scoped_select(
            select(Post.channel_name, func.count())
            .join(
                r,
                (r.c.name == col(Post.channel_name))
                & col(Post.timestamp).between(r.c.lo, r.c.hi),
            )
            .group_by(col(Post.channel_name)),
            Post,
            user_id,
        )
    ).all()
    return {str(name): int(n) for name, n in rows}


def _pace_span(channel: Channel, held: _Held, cutoff: int) -> tuple[int, int] | None:
    to = channel.head_read_at
    if to is None:
        return None
    since = max(
        to - WEEK_MS, held.first_ts if held.first_ts is not None else to, cutoff
    )
    return (since, to) if to - since >= HOUR_MS else None


def _next_due(channel: Channel, group: ChannelSettingGroup) -> int | None:
    """When the scheduler next syncs it; None when that is now or never."""
    dues: list[int | None] = []
    if group.regular_sync_enabled:
        dues.append(channel.next_regular_sync_at)
    if group.dynamic_sync_enabled and channel.next_dynamic_sync_at is not None:
        dues.append(channel.next_dynamic_sync_at)
    if not dues or None in dues:
        return None
    return min(d for d in dues if d is not None)


@dataclass(frozen=True)
class _Window:
    start: int
    e: int
    frozen_at: int
    cutoff: int


def _stretches(
    channel: Channel,
    held: _Held,
    window: _Window,
    *,
    missing: int,
    hole: tuple[int, int] | None,
) -> list[tuple[Reason, UnprovenStretch]]:
    """Each failing test's reason and the stretch it leaves unproven."""
    start, e = window.start, window.e
    out: list[tuple[Reason, UnprovenStretch]] = []
    head_read = channel.head_read_at or 0
    if held.head_id is None and head_read < e:
        since = max(start, head_read, held.newest_ts or 0)
        out.append(("end", UnprovenStretch(kind="end", **{"from": since}, to=e)))
    if held.start_id is None and not channel.history_reached_channel_start:
        first = held.first_ts if held.first_ts is not None else e
        reason: Reason = "retention" if start < window.cutoff else "start"
        stretch = UnprovenStretch(kind="start", **{"from": start}, to=min(first, e))
        out.append((reason, stretch))
    if missing > 0 and hole is not None:
        since, to = max(start, hole[0]), min(e, hole[1])
        out.append(("hole", UnprovenStretch(kind="hole", **{"from": since}, to=to)))
    return out


@dataclass(frozen=True)
class _Standing:
    """What the Account's settings and the last sync say: reasons no test
    names, the failed sync's error, and whether a sync can fix anything."""

    reasons: list[Reason]
    error: str | None
    blocked: bool


def _standing(
    group: ChannelSettingGroup | None, last_log: tuple[str, str | None] | None
) -> _Standing:
    status, error = last_log or ("", None)
    failed = status == "failed"
    error = error if failed else None
    unavailable = bool(group and group.is_unavailable_on_web_view) or (
        UNAVAILABLE_WEB_VIEW_MESSAGE in (error or "")
    )
    frozen = bool(group and group.is_frozen)
    reasons: list[Reason] = []
    if unavailable:
        reasons.append("unavailable")
    elif failed:
        reasons.append("failed")
    if frozen:
        reasons.append("frozen")
    return _Standing(reasons, error, frozen or unavailable)


def _is_behind(
    channel: Channel,
    group: ChannelSettingGroup | None,
    reasons: list[Reason],
    syncable: bool,
    frozen_at: int,
) -> bool:
    """Only lagging, a sync can fix it, and its next scheduled sync is not
    past due: routine lag the scheduler will clear. Otherwise Overdue."""
    next_due = _next_due(channel, group) if group else None
    return (
        [r for r in reasons if r != "skipped"] == ["end"]
        and syncable
        and next_due is not None
        and next_due >= frozen_at
    )


def _verdict(
    channel: Channel,
    group: ChannelSettingGroup | None,
    held: _Held,
    *,
    window: _Window,
    missing: int,
    hole: tuple[int, int] | None,
    last_log: tuple[str, str | None] | None,
    pace: float | None,
) -> ChannelVerdict:
    failing = _stretches(channel, held, window, missing=missing, hole=hole)
    standing = _standing(group, last_log)
    # A failure or a freeze explains an Incomplete Channel; alone it is none.
    reasons = [r for r, _ in failing] + (standing.reasons if failing else [])
    reasons.sort(key=REASON_ORDER.index)
    stretches = [s for _, s in failing]
    syncable = not standing.blocked and reasons != ["retention"]
    paced_ms = sum(s.to - s.from_ for s in stretches if s.kind != "hole")
    return ChannelVerdict(
        name=channel.name,
        reasons=reasons,
        reason=reasons[0] if reasons else None,
        lastSync=channel.last_updated,
        headReadAt=channel.head_read_at,
        error=standing.error if reasons else None,
        stretches=stretches,
        missingIds=missing,
        syncable=syncable,
        behind=_is_behind(channel, group, reasons, syncable, window.frozen_at),
        pacePerHour=pace,
        heldPosts=held.held,
        unprovenPosts=missing + (pace or 0) * paced_ms / HOUR_MS,
    )


def check_window(
    session: Session,
    *,
    user_id: uuid.UUID,
    names: list[str],
    start: int,
    end: int,
    frozen_at: int,
) -> WindowCheckResponse:
    """Every followed Channel in `names`, judged for `[start, min(end, frozen_at)]`."""
    window = _Window(
        start=start,
        e=min(end, frozen_at),
        frozen_at=frozen_at,
        cutoff=compute_scrape_cutoff_ms(
            load_sync_settings(session, user_id=user_id),
            load_retention_policy(session),
            now_ms=frozen_at,
        ),
    )
    followed = followed_with_groups(session, user_id=user_id, names=names)
    listed = [channel.name for channel, _ in followed]
    held = _held(session, user_id, listed, start, window.e)
    spans: list[tuple[str, int, int]] = []
    for name in listed:
        h = held.get(name, _Held())
        lo = h.start_id if h.start_id is not None else h.first_id
        hi = h.head_id if h.head_id is not None else h.max_id
        if lo is not None and hi is not None and hi > lo:
            spans.append((name, lo, hi))
    accounted = _accounted(session, user_id, spans)
    missing = {n: hi - lo + 1 - accounted.get(n, 0) for n, lo, hi in spans}
    holes = {
        n: _hole_bounds(session, user_id, n, lo, hi)
        for n, lo, hi in spans
        if missing[n] > 0
    }
    paces = {
        channel.name: span
        for channel, _ in followed
        if (span := _pace_span(channel, held.get(channel.name, _Held()), window.cutoff))
    }
    week = _week_posts(session, user_id, [(n, lo, hi) for n, (lo, hi) in paces.items()])
    logs = _last_logs(session, user_id, listed, frozen_at)
    verdicts = [
        _verdict(
            channel,
            group,
            held.get(channel.name, _Held()),
            window=window,
            missing=missing.get(channel.name, 0),
            hole=holes.get(channel.name),
            last_log=logs.get(channel.name),
            pace=(
                week.get(channel.name, 0) / ((span[1] - span[0]) / HOUR_MS)
                if (span := paces.get(channel.name))
                else None
            ),
        )
        for channel, group in followed
    ]
    incomplete = [v for v in verdicts if v.reasons]
    return WindowCheckResponse(
        frozenAt=frozen_at,
        start=start,
        end=window.e,
        channels=verdicts,
        heldPosts=sum(v.held_posts for v in verdicts),
        unprovenPosts=round(sum(v.unproven_posts for v in incomplete)),
        unprovenFloor=any(
            v.pace_per_hour is None and any(s.kind != "hole" for s in v.stretches)
            for v in incomplete
        ),
    )


def _overlaid(verdict: ChannelVerdict, reason: Reason | None) -> ChannelVerdict:
    if reason is None or reason in verdict.reasons:
        return verdict
    reasons = sorted([*verdict.reasons, reason], key=REASON_ORDER.index)
    return verdict.model_copy(update={"reasons": reasons, "reason": reasons[0]})


def freeze_record(
    session: Session,
    *,
    user_id: uuid.UUID,
    names: list[str],
    start: int,
    end: int,
    gate: GateOutcome,
) -> Completeness:
    """The record an Artifact freezes (CW-02): the check run here, at the
    gate's moment, with the person's skips and the gate's timeouts laid over
    the server's own verdicts. Only a Channel this check finds Incomplete
    takes one; the client's view of the check is never the record."""
    check = check_window(
        session,
        user_id=user_id,
        names=names,
        start=start,
        end=end,
        frozen_at=gate.frozen_at,
    )
    said: dict[str, Reason] = dict.fromkeys(gate.timed_out, "timed_out")
    said.update(dict.fromkeys(gate.skipped, "skipped"))
    incomplete = [_overlaid(v, said.get(v.name)) for v in check.channels if v.reasons]
    return Completeness(
        choice=gate.choice,
        frozenAt=check.frozen_at,
        start=check.start,
        end=check.end,
        channelCount=len(check.channels),
        heldPosts=check.held_posts,
        channels=incomplete,
        leftOut=gate.left_out,
        unprovenPosts=check.unproven_posts,
        unprovenFloor=check.unproven_floor,
        fixable=any(v.syncable for v in incomplete),
        incompleteCount=len(incomplete),
    )
