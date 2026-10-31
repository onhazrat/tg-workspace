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
from collections import Counter
from collections.abc import Collection
from dataclasses import dataclass
from typing import Any, get_args

from sqlalchemy import BigInteger, Select, String, column, func, union_all, values
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
from app.services.analysis_window import server_now_ms
from app.services.follows import followed_with_groups
from app.services.scraper_jobs import channels_in_flight
from app.services.telegram_web import UNAVAILABLE_WEB_VIEW_MESSAGE
from app.services.tenancy import scoped_select

HOUR_MS = 3_600_000
WEEK_MS = 7 * 24 * HOUR_MS

#: ADR-043's order: what a person can act on first.
REASON_ORDER: tuple[Reason, ...] = get_args(Reason)


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
    session: Session, user_id: uuid.UUID, names: list[str], start: int, end: int
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
                func.min(pid).filter(ts > end),
                func.max(ts).filter(ts <= end),
                func.count().filter(ts >= start, ts <= end),
            )
            .where(col(Post.channel_name).in_(names))
            .group_by(col(Post.channel_name)),
            Post,
            user_id,
        )
    ).all()
    return {
        str(name): _Held(
            first_id=first_id,
            first_ts=first_ts,
            max_id=max_id,
            start_id=start_id,
            head_id=head_id,
            newest_ts=newest_ts,
            held=held,
        )
        for name, first_id, first_ts, max_id, start_id, head_id, newest_ts, held in rows
    }


def _ranges(name: str, rows: list[tuple[str, int, int]]) -> Any:
    return values(
        column("name", String),
        column("lo", BigInteger),
        column("hi", BigInteger),
        name=name,
    ).data(rows)


@dataclass(frozen=True)
class _Accounted:
    """A span's ids held as a Post or a confirmed gap, and its first and last
    break: the ids either side of the first and the last missing run."""

    count: int
    before: int | None
    after: int | None


def _accounted(
    session: Session, user_id: uuid.UUID, spans: list[tuple[str, int, int]]
) -> dict[str, _Accounted]:
    """Per Channel, the ids in `[lo, hi]` held as a Post or a confirmed gap.

    Disjoint by construction: storing a Post clears its gap. One read for
    every span, so a Scope of many holed Channels asks once.
    """
    if not spans:
        return {}
    ranges = _ranges("r", spans)
    held: list[Select[Any]] = [
        scoped_select(
            sa_select(
                col(model.channel_name).label("name"), col(model.post_id).label("id")
            ).join(
                ranges,
                (ranges.c.name == col(model.channel_name))
                & col(model.post_id).between(ranges.c.lo, ranges.c.hi),
            ),
            model,
            user_id,
        )
        for model in (Post, PostSyncState)
    ]
    ids = union_all(*held).subquery("ids")
    following = (
        func.lead(ids.c.id).over(partition_by=ids.c.name, order_by=ids.c.id)
    ).label("next")
    stepped = sa_select(ids.c.name, ids.c.id, following).subquery("stepped")
    gap = stepped.c.next > stepped.c.id + 1
    rows = session.execute(
        sa_select(
            stepped.c.name,
            func.count(),
            func.min(stepped.c.id).filter(gap),
            func.max(stepped.c.next).filter(gap),
        ).group_by(stepped.c.name)
    ).all()
    return {str(name): _Accounted(int(n), lo, hi) for name, n, lo, hi in rows}


def _stamps(
    session: Session, user_id: uuid.UUID, ids: list[tuple[str, int, int]]
) -> dict[tuple[str, int], int]:
    """When each `(Channel, id)` Post was published, read once for all."""
    if not ids:
        return {}
    ranges = _ranges("s", ids)
    rows = session.exec(
        scoped_select(
            select(Post.channel_name, Post.post_id, Post.timestamp).join(
                ranges,
                (ranges.c.name == col(Post.channel_name))
                & col(Post.post_id).between(ranges.c.lo, ranges.c.hi),
            ),
            Post,
            user_id,
        )
    ).all()
    return {(str(name), int(pid)): int(ts) for name, pid, ts in rows}


def _hole_bounds(
    session: Session, user_id: uuid.UUID, breaks: dict[str, _Accounted]
) -> dict[str, tuple[int, int]]:
    """When the Posts either side of each Channel's first and last missing id
    were published: the hole's stretch."""
    edges = [
        (name, pid, pid)
        for name, b in breaks.items()
        for pid in (b.before, b.after)
        if pid is not None
    ]
    stamps = _stamps(session, user_id, edges)
    # A neighbour that is a confirmed gap, not a Post, has no time: the hole
    # then reaches the window's edge.
    return {
        name: (
            stamps.get((name, b.before or 0), 0),
            stamps.get((name, b.after or 0), 2**62),
        )
        for name, b in breaks.items()
    }


def _last_logs(
    session: Session, user_id: uuid.UUID, names: list[str]
) -> dict[str, tuple[str, str | None]]:
    """Each Channel's last sync up to now, not to the frozen moment: a sync
    the gate waited on that failed shows as failed (story 39)."""
    rows = session.exec(
        scoped_select(
            select(SyncLog.channel_name, SyncLog.status, SyncLog.error)
            .where(col(SyncLog.channel_name).in_(names))
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
    #: E: the earlier of the window's End and the frozen moment.
    end: int
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
    start, end = window.start, window.end
    out: list[tuple[Reason, UnprovenStretch]] = []
    head_read = channel.head_read_at or 0
    if held.head_id is None and head_read < end:
        since = max(start, head_read, held.newest_ts or 0)
        out.append(("end", UnprovenStretch(kind="end", **{"from": since}, to=end)))
    if held.start_id is None and not channel.history_reached_channel_start:
        first = held.first_ts if held.first_ts is not None else end
        reason: Reason = "retention" if start < window.cutoff else "start"
        stretch = UnprovenStretch(kind="start", **{"from": start}, to=min(first, end))
        out.append((reason, stretch))
    if missing > 0 and hole is not None:
        since, to = max(start, hole[0]), min(end, hole[1])
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


def must_sync_again(started: int, head_read_at: int | None, end: int) -> bool:
    """Whether a sync in flight since `started` already read its head, before
    E, so it cannot pass the head test and another sync must follow it.

    A head-read moment at or after the sync's start is that sync's own; an
    older one is a previous sync's, and this one's read is still to come
    (CW-03). The one rule the gate and the successor both ask.
    """
    return head_read_at is not None and started <= head_read_at < end


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
    syncing_since: int | None,
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
        syncingSince=syncing_since,
        syncAgain=syncing_since is not None
        and must_sync_again(syncing_since, channel.head_read_at, window.end),
    )


def _spans(listed: list[str], held: dict[str, _Held]) -> list[tuple[str, int, int]]:
    """Each Channel's ids the continuity test reads: from the Post at or
    before the Start (or the first held) to the head (or the newest held)."""
    spans: list[tuple[str, int, int]] = []
    for name in listed:
        h = held.get(name, _Held())
        lo = h.start_id if h.start_id is not None else h.first_id
        hi = h.head_id if h.head_id is not None else h.max_id
        if lo is not None and hi is not None and hi > lo:
            spans.append((name, lo, hi))
    return spans


def frozen_moment(asked: int | None) -> int:
    """The moment an action froze: the one asked for, never later than now,
    since a window cannot be frozen in the future; now when none is asked."""
    now = server_now_ms()
    return now if asked is None else min(asked, now)


def check_window(
    session: Session,
    *,
    user_id: uuid.UUID,
    names: list[str],
    start: int,
    end: int,
    frozen_at: int,
) -> WindowCheckResponse:
    """Every followed Channel in `names`, judged for `[start, min(end, frozen_at)]`.

    The last sync and the syncs in flight are read as they are now, whatever
    the frozen moment: the gate waits past it (ADR-043).
    """
    window = _Window(
        start=start,
        end=min(end, frozen_at),
        frozen_at=frozen_at,
        cutoff=compute_scrape_cutoff_ms(
            load_sync_settings(session, user_id=user_id),
            load_retention_policy(session),
            now_ms=frozen_at,
        ),
    )
    followed = followed_with_groups(session, user_id=user_id, names=names)
    listed = [channel.name for channel, _ in followed]
    held = _held(session, user_id, listed, start, window.end)
    spans = _spans(listed, held)
    accounted = _accounted(session, user_id, spans)
    missing = {
        n: hi - lo + 1 - (accounted[n].count if n in accounted else 0)
        for n, lo, hi in spans
    }
    holes = _hole_bounds(
        session, user_id, {n: accounted[n] for n in missing if missing[n] > 0}
    )
    paces = {
        channel.name: span
        for channel, _ in followed
        if (span := _pace_span(channel, held.get(channel.name, _Held()), window.cutoff))
    }
    week = _week_posts(session, user_id, [(n, lo, hi) for n, (lo, hi) in paces.items()])
    logs = _last_logs(session, user_id, listed)
    flight = channels_in_flight(session, listed)
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
            syncing_since=flight.get(channel.name),
        )
        for channel, group in followed
    ]
    incomplete = [v for v in verdicts if v.reasons]
    return WindowCheckResponse(
        frozenAt=frozen_at,
        start=start,
        end=window.end,
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
    refused: Collection[str] = (),
) -> Completeness:
    """The record an Artifact freezes (CW-02): the check run here, at the
    gate's moment, with the person's skips and the gate's timeouts laid over
    the server's own verdicts. Only a Channel this check finds Incomplete
    takes one; the client's view of the check is never the record.

    `refused` is the scheduler's (CW-03): Channels its own sync was refused,
    by a Budget ceiling or a disabled Request kind. No client sends it."""
    check = check_window(
        session,
        user_id=user_id,
        names=names,
        start=start,
        end=end,
        frozen_at=gate.frozen_at,
    )
    overlay: dict[str, Reason] = dict.fromkeys(gate.timed_out, "timed_out")
    overlay.update(dict.fromkeys(refused, "refused"))
    overlay.update(dict.fromkeys(gate.skipped, "skipped"))
    incomplete = [
        _overlaid(v, overlay.get(v.name)) for v in check.channels if v.reasons
    ]
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
        counts=Counter(v.reason for v in incomplete if v.reason),
    )
