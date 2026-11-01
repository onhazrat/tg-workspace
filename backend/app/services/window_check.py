"""Which Channels of a Scope are Incomplete, and why (ADR-043, ADR-044). A read model.

`check_window` answers, for an Account, Channel names, a window and a frozen
moment, each Channel's verdict. E is the earlier of the window's End and the
frozen moment. A Channel is Complete when one of its Walked ranges spans the
window:

1. head: the range's top was read at or after E, or it holds a Post published
   after E;
2. start: it holds a Post at or before the Start, or it reached the Channel's
   first Post.

Each failing test leaves an unproven stretch. The end runs from the top
range's newest Post (or its top read) to E, a Hole is the space between two
ranges inside the window, and the start runs from the Start to the lowest
range. A Post stored without a walk (an import) belongs to no range, so it is
held but proves nothing. Everything is read from data, so a Follow made
yesterday, a capped walk and another Follower's older sync need no special
case. The corpus is read through the Follow-scoped seam, and frozen,
unavailable and the schedule from the Account's own Follows.

**Unproven Posts** is how much an Incomplete window may lack. A Hole counts
its missing ids, an upper bound since some may be deleted Posts, and every
other stretch the Channel's stored pace (`Channel.pace_per_hour`). An unknown
pace under a non-hole stretch makes the total a floor.

The live check reads only what it holds now; it never syncs. Skipped and
timed out are the action's, and `freeze_record` lays them over the check an
Artifact freezes (CW-02). Refused is the scheduler's (CW-03).
"""

from __future__ import annotations

import uuid
from collections import Counter
from collections.abc import Collection
from dataclasses import dataclass
from typing import get_args

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.jobs.settings import (
    compute_scrape_cutoff_ms,
    load_retention_policy,
    load_sync_settings,
)
from app.models_tg import Channel, ChannelSettingGroup, Post, SyncLog
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
from app.services.walked_ranges import Span, holes, ranges_of

HOUR_MS = 3_600_000

#: ADR-043's order, what a person can act on first.
REASON_ORDER: tuple[Reason, ...] = get_args(Reason)


def _held(
    session: Session, user_id: uuid.UUID, names: list[str], start: int, end: int
) -> dict[str, int]:
    """Posts each Channel holds inside the window, off the timestamp index."""
    if not names:
        return {}
    rows = session.exec(
        scoped_select(
            select(Post.channel_name, func.count())
            .where(
                col(Post.channel_name).in_(names),
                col(Post.timestamp).between(start, end),
            )
            .group_by(col(Post.channel_name)),
            Post,
            user_id,
        )
    ).all()
    return {str(name): int(n) for name, n in rows}


def _last_logs(
    session: Session, user_id: uuid.UUID, names: list[str]
) -> dict[str, tuple[str, str | None]]:
    """Each Channel's last sync up to now, not to the frozen moment, so a
    sync the gate waited on that failed shows as failed (story 39)."""
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


def _in_window(ranges: list[Span], window: _Window) -> list[tuple[Span, Span]]:
    """The Holes whose unread stretch reaches into the window."""
    return [
        (low, up)
        for low, up in holes(ranges)
        if low.hi_ts < window.end and up.lo_ts > window.start
    ]


def _stretches(
    ranges: list[Span], window: _Window
) -> list[tuple[Reason, UnprovenStretch]]:
    """Each failing test's reason and the stretch it leaves unproven; none
    when one range spans the window."""
    start, end = window.start, window.end

    def head(r: Span) -> bool:
        return (r.top_read_at or 0) >= end or r.hi_ts > end

    def foot(r: Span) -> bool:
        return r.reached_start or r.lo_ts <= start

    if any(head(r) and foot(r) for r in ranges):
        return []
    out: list[tuple[Reason, UnprovenStretch]] = []
    if not any(head(r) for r in ranges):
        top = ranges[-1] if ranges else None
        since = max(start, top.top_read_at or 0, top.hi_ts) if top else start
        out.append(("end", UnprovenStretch(kind="end", **{"from": since}, to=end)))
    if not any(foot(r) for r in ranges):
        first = ranges[0].lo_ts if ranges else end
        reason: Reason = "retention" if start < window.cutoff else "start"
        stretch = UnprovenStretch(kind="start", **{"from": start}, to=min(first, end))
        out.append((reason, stretch))
    if gaps := _in_window(ranges, window):
        since = max(start, min(low.hi_ts for low, _ in gaps))
        to = min(end, max(up.lo_ts for _, up in gaps))
        out.append(("hole", UnprovenStretch(kind="hole", **{"from": since}, to=to)))
    return out


@dataclass(frozen=True)
class _Standing:
    """What the Account's settings and the last sync say. Reasons no test
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
    """Only short of the end, a sync can fix it, and its next scheduled sync is not
    past due, so the scheduler will clear it. Otherwise Overdue."""
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
    ranges: list[Span],
    *,
    window: _Window,
    held: int,
    missing: int,
    last_log: tuple[str, str | None] | None,
    syncing_since: int | None,
) -> ChannelVerdict:
    failing = _stretches(ranges, window)
    standing = _standing(group, last_log)
    # A failure or a freeze explains an Incomplete Channel; alone it is none.
    reasons = [r for r, _ in failing] + (standing.reasons if failing else [])
    reasons.sort(key=REASON_ORDER.index)
    stretches = [s for _, s in failing]
    syncable = not standing.blocked and reasons != ["retention"]
    missing = missing if "hole" in reasons else 0
    pace = channel.pace_per_hour
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
        heldPosts=held,
        unprovenPosts=missing + (pace or 0) * paced_ms / HOUR_MS,
        syncingSince=syncing_since,
        syncAgain=syncing_since is not None
        and must_sync_again(syncing_since, channel.head_read_at, window.end),
    )


def frozen_moment(asked: int | None) -> int:
    """The moment an action froze. The one asked for, never later than now,
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
    the frozen moment, since the gate waits past it (ADR-043).
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
    ranges = ranges_of(session, user_id, listed)
    # Every id of a Hole counts, an upper bound: some are deleted Posts, and a
    # Post an import stored there is counted too, since no walk read it.
    missing = {
        n: sum(
            up.lo_id - low.hi_id - 1
            for low, up in _in_window(ranges.get(n, []), window)
        )
        for n in listed
    }
    held = _held(session, user_id, listed, start, window.end)
    logs = _last_logs(session, user_id, listed)
    flight = channels_in_flight(session, listed)
    verdicts = [
        _verdict(
            channel,
            group,
            ranges.get(channel.name, []),
            window=window,
            held=held.get(channel.name, 0),
            missing=missing.get(channel.name, 0),
            last_log=logs.get(channel.name),
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
    """The record an Artifact freezes (CW-02). The check runs here, at the
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
