"""Per-handle metadata probes for Discover candidates (IDEA-011 D9).

A Discover report surfaces every handle its posts point at, and most of those
are not channels anyone could follow: bots, personal accounts, groups, and
private or deleted channels are all referenced from posts exactly the way real
channels are. This module records what one fetch of `t.me/<handle>` said, once
per handle, so that triage happens automatically instead of by hand on every
report.

Deliberately kept apart from `discover_ignored`:

* A **dismissal** is a judgement — "not interesting to me".
* A **probe** is a fact about the handle — "cannot be followed by anyone".

They are surfaced as two separate views for the same reason. Folding them
together would make an automated verdict indistinguishable from a deliberate
one, and would let a mistaken probe pass for something the operator chose.

Like `isFollowed` and `isIgnored`, a probe is joined onto candidates at read
time rather than frozen into the stored report: the report is a record of what
was referenced, while a handle's nature is current state that should correct
itself across every saved report at once.

## The verdict rule

`record_probe_result` writes `ok`/`unavailable` **only** when a Telegram page
actually parsed. Everything else — timeouts, HTTP errors, a proxy handing back
a block page — records `unknown` and bumps `attempts`.

This is the single most important rule here. Because a conclusive answer is
cached indefinitely, writing a verdict from a failed fetch would permanently
hide a real channel from every future report, with nothing on screen to hint
that anything went wrong. An `unknown` costs a retry; a wrong `unavailable`
costs a channel, silently.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlmodel import Session, col, select

from app.models_tg import DiscoverHandleProbe, utc_now

#: Statuses that mean "Telegram answered, and this is the answer".
CONCLUSIVE_STATUSES = frozenset({"ok", "unavailable"})

PROBE_STATUSES = frozenset({"ok", "unavailable", "unknown"})
PROBE_KINDS = frozenset({"channel", "group", "bot", "user", "unknown"})

#: How long to wait before re-probing a handle that keeps failing.
#:
#: Doubles per consecutive failure and stops growing at a day: a handle that
#: has failed eight times in a row is probably failing for a reason a tighter
#: loop will not fix, and the sweep should not keep spending proxy lanes on it.
RETRY_BACKOFF_BASE_MINUTES = 15
RETRY_BACKOFF_MAX_MINUTES = 24 * 60


def normalize_handle(name: str) -> str:
    """Mirrors `discover.normalize_handle` — the key must match candidate names."""
    return name.lstrip("@").strip().lower()


def _retry_due_at(row: DiscoverHandleProbe) -> datetime | None:
    """When an inconclusive handle becomes eligible for another attempt."""
    if row.attempted_at is None:
        return None
    minutes = min(
        RETRY_BACKOFF_BASE_MINUTES * (2 ** max(row.attempts - 1, 0)),
        RETRY_BACKOFF_MAX_MINUTES,
    )
    return row.attempted_at + timedelta(minutes=minutes)


def probe_to_camel(row: DiscoverHandleProbe) -> dict[str, Any]:
    return {
        "handle": row.handle,
        "status": row.status,
        "kind": row.kind,
        "displayName": row.display_name,
        "bio": row.bio,
        "subscribers": row.subscribers,
        "photoUrl": row.photo_url,
        "attempts": row.attempts,
        "lastError": row.last_error,
        "checkedAt": (
            int(row.checked_at.timestamp() * 1000) if row.checked_at else None
        ),
    }


def probe_map(session: Session, handles: set[str]) -> dict[str, dict[str, Any]]:
    """Probes for the given handles, keyed by handle, for the read-time join.

    Scoped to the handles asked about rather than loading the whole table: the
    probe cache is global and grows across every report ever generated, while a
    single report only needs its own candidates.
    """
    if not handles:
        return {}
    statement = select(DiscoverHandleProbe).where(
        col(DiscoverHandleProbe.handle).in_(handles)
    )
    return {row.handle: probe_to_camel(row) for row in session.exec(statement).all()}


def list_probes(session: Session, *, status: str | None = None) -> list[dict[str, Any]]:
    statement = select(DiscoverHandleProbe)
    if status:
        statement = statement.where(col(DiscoverHandleProbe.status) == status)
    statement = statement.order_by(col(DiscoverHandleProbe.handle))
    return [probe_to_camel(row) for row in session.exec(statement).all()]


def handles_needing_probe(
    session: Session, handles: list[str], *, now: datetime | None = None
) -> list[str]:
    """Which of `handles` the sweep should actually fetch, input order preserved.

    Order is preserved because the caller passes candidates ranked by score, and
    probing in that order is what makes the top of the report resolve within
    seconds instead of after the long single-reference tail.

    Skipped: handles with a conclusive verdict (cached indefinitely — a bot does
    not become a channel), and handles whose retry backoff has not elapsed.
    """
    moment = now or utc_now()
    wanted = [h for h in (normalize_handle(x) for x in handles) if h]
    if not wanted:
        return []

    existing = {
        row.handle: row
        for row in session.exec(
            select(DiscoverHandleProbe).where(
                col(DiscoverHandleProbe.handle).in_(set(wanted))
            )
        ).all()
    }

    out: list[str] = []
    seen: set[str] = set()
    for handle in wanted:
        if handle in seen:
            continue
        seen.add(handle)
        row = existing.get(handle)
        if row is None:
            out.append(handle)
            continue
        if row.status in CONCLUSIVE_STATUSES:
            continue
        due = _retry_due_at(row)
        if due is None or due <= moment:
            out.append(handle)
    return out


def _get_or_create(session: Session, handle: str) -> DiscoverHandleProbe:
    row = session.get(DiscoverHandleProbe, handle)
    if row is None:
        row = DiscoverHandleProbe(handle=handle, created_at=utc_now())
        session.add(row)
    return row


def record_probe_result(
    session: Session,
    handle: str,
    info: dict[str, Any] | None,
    *,
    error: str | None = None,
) -> dict[str, Any]:
    """Store the outcome of one fetch.

    Pass `info` as the `get_channel_info` payload on success, or `None` with an
    `error` when the fetch raised. A payload that did not come from a Telegram
    page (`isTelegramPage` false) is treated as a failure regardless of what
    else it contains — see the module docstring.
    """
    key = normalize_handle(handle)
    row = _get_or_create(session, key)
    now = utc_now()
    row.attempted_at = now

    inconclusive = info is None or not info.get("isTelegramPage")
    if inconclusive:
        row.status = "unknown"
        row.attempts += 1
        row.last_error = error or "no telegram page in response"
        session.commit()
        session.refresh(row)
        return probe_to_camel(row)

    payload: dict[str, Any] = info or {}
    row.status = "unavailable" if payload.get("isUnavailableOnWebView") else "ok"
    kind = str(payload.get("kind") or "unknown")
    row.kind = kind if kind in PROBE_KINDS else "unknown"
    row.display_name = payload.get("displayName") or None
    row.bio = payload.get("bio") or None
    row.subscribers = payload.get("subscribers") or None
    row.photo_url = payload.get("photoUrl") or None
    row.latest_id = int(payload.get("latestId") or 0)
    # A conclusive answer clears the failure history: the backoff exists to
    # throttle retries of an unresolved handle, and this one is now resolved.
    row.attempts = 0
    row.last_error = None
    row.checked_at = now
    session.commit()
    session.refresh(row)
    return probe_to_camel(row)


def clear_probes(session: Session, handles: list[str]) -> list[str]:
    """Forget probes so the next sweep re-fetches them — the manual recheck.

    Deleting rather than flagging for refresh: a probe row *is* the cached
    answer, so removing it returns the handle to "never probed", which the sweep
    already knows how to handle. Unknown handles are skipped rather than 404ing,
    since the UI offers recheck on rows that may not have been probed yet.
    """
    removed: list[str] = []
    for raw in handles:
        handle = normalize_handle(raw)
        row = session.get(DiscoverHandleProbe, handle)
        if row is None:
            continue
        session.delete(row)
        removed.append(handle)
    session.commit()
    return removed
