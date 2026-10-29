"""Which Request kinds an Operator has disabled on this deployment (RKD-01, ADR-040).

An **orchestrator**: it reads and stamps the `request_kinds` settings row
through `settings_store`, the row's only writer, and answers the one question
every gate asks, `is_kind_enabled`. The chokepoint (`network.fetch_with_retry`),
each entry point that starts work, and the lane consumer all read it, so a
switch means the same thing wherever work of its kind begins.

**A disabled kind is not a paused lane.** A paused lane still takes new work
and only holds it; a disabled kind refuses new work and holds what was already
queued. The consumer holds a lane for either reason, and the two stay separate
settings so resuming a lane never re-enables a kind.

The row is read at most every `RECHECK_SECONDS` per process, the consumer's
pause re-check interval, and a write through the Settings page forgets the
cached copy in the process that made it.
"""

from __future__ import annotations

import time
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.core.request_recording import (
    KIND_LABELS,
    SWITCHABLE_KINDS,
    RequestKind,
    RequestKindDisabled,
    kind_refusal,
)
from app.services.quota import Budget, budget_for_sync_mode
from app.services.settings_registry import REQUEST_KINDS_KEY
from app.services.settings_store import get_global_setting, replace_global_setting
from app.services.sync_lanes import DISCOVER_PROBE_LANE, DRAIN_ORDER, lane_budget

#: The `.env` value each switch defaults to when the row says nothing.
KIND_ENV: dict[RequestKind, str] = {
    RequestKind.AUTO: "JOBS_AUTO_REQUESTS_ENABLED_DEFAULT",
    RequestKind.BULK: "JOBS_BULK_REQUESTS_ENABLED_DEFAULT",
    RequestKind.SINGLE: "JOBS_SINGLE_REQUESTS_ENABLED_DEFAULT",
    RequestKind.FOLLOW: "JOBS_FOLLOW_REQUESTS_ENABLED_DEFAULT",
    RequestKind.PROBE: "JOBS_PROBE_REQUESTS_ENABLED_DEFAULT",
    RequestKind.HANDLE: "JOBS_HANDLE_REQUESTS_ENABLED_DEFAULT",
    RequestKind.BOT_API: "JOBS_BOT_API_REQUESTS_ENABLED_DEFAULT",
}

#: The kind of work a sync's Requests are (RQS-01). From the Budget, which
#: derives totally from the sync mode, so a new mode cannot reach the record
#: without first being given a Budget.
REQUEST_KIND_BY_BUDGET: dict[Budget, RequestKind] = {
    Budget.AUTO_SYNC: RequestKind.AUTO,
    Budget.MANUAL_BULK: RequestKind.BULK,
    Budget.MANUAL_SINGLE: RequestKind.SINGLE,
}

#: How stale this process's copy of the switches may be.
RECHECK_SECONDS = 5.0

#: The one status every route refuses a disabled kind with, set in `app.main`.
#: 409: the request is well formed and the caller may make it; the
#: deployment's state says no until an Operator enables the kind again.
KIND_DISABLED_STATUS = 409

_cached: tuple[float, dict[str, Any]] | None = None


def setting_id(kind: RequestKind) -> str:
    """The Setting that is `kind`'s switch."""
    return f"jobs.deployment.{kind.value}RequestsEnabled"


def disabled_at_field(kind: RequestKind) -> str:
    """The row's field holding when `kind` was disabled, as epoch ms."""
    return f"{kind.value}DisabledAt"


#: Every field the `request_kinds` row stores: a switch and its stamp per kind.
STORED_FIELDS: frozenset[str] = frozenset(
    field
    for kind in SWITCHABLE_KINDS
    for field in (kind.value, disabled_at_field(kind))
)


def kind_for_sync_mode(sync_mode: Any) -> RequestKind:
    return REQUEST_KIND_BY_BUDGET[budget_for_sync_mode(sync_mode)]


def kind_for_lane(lane: str) -> RequestKind:
    if lane == DISCOVER_PROBE_LANE:
        return RequestKind.PROBE
    return REQUEST_KIND_BY_BUDGET[lane_budget(lane)]


def _stored() -> dict[str, Any]:
    global _cached
    now = time.monotonic()
    if _cached is None or now - _cached[0] >= RECHECK_SECONDS:
        with Session(engine) as session:
            _cached = (now, get_global_setting(session, REQUEST_KINDS_KEY))
    return _cached[1]


def forget() -> None:
    """Drop this process's copy, so the next read sees the row."""
    global _cached
    _cached = None


def _enabled(stored: dict[str, Any], kind: RequestKind) -> bool:
    value = stored.get(kind.value)
    return bool(getattr(settings, KIND_ENV[kind]) if value is None else value)


def is_kind_enabled(kind: RequestKind) -> bool:
    """Whether work of `kind` may reach Telegram. `other` always may."""
    return kind is RequestKind.OTHER or _enabled(_stored(), kind)


def assert_kind_enabled(kind: RequestKind) -> None:
    """Refuse new work of a disabled kind, before anything is created."""
    if not is_kind_enabled(kind):
        raise RequestKindDisabled(kind)


def lanes_of(kind: RequestKind) -> list[str]:
    """The Queue lanes holding `kind`'s queued work, in drain order."""
    return [lane for lane in DRAIN_ORDER if kind_for_lane(lane) is kind]


def held_lanes() -> frozenset[str]:
    """The lanes the consumer holds because their kind is disabled."""
    stored = _stored()
    return frozenset(
        lane for lane in DRAIN_ORDER if not _enabled(stored, kind_for_lane(lane))
    )


def waiting_reason(sync_mode: Any, status: str) -> str | None:
    """Why a sync job is not moving, when its kind is disabled."""
    if status not in ("pending", "running"):
        return None
    kind = kind_for_sync_mode(sync_mode)
    return None if is_kind_enabled(kind) else kind_refusal(kind)


def switches() -> list[dict[str, Any]]:
    """Every switch for the runtime config, with what the UI derives from it.

    On or off, since when and its refusal, plus its Setting id and its lanes,
    so a new kind needs no frontend edit.
    """
    stored = _stored()
    return [
        {
            "kind": kind.value,
            "label": KIND_LABELS[kind],
            "settingId": setting_id(kind),
            "lanes": lanes_of(kind),
            "enabled": _enabled(stored, kind),
            "disabledSince": stored.get(disabled_at_field(kind)),
            "refusal": kind_refusal(kind),
        }
        for kind in SWITCHABLE_KINDS
    ]


def record_switch_time(session: Session, kind: RequestKind) -> None:
    """Stamp when `kind` went off, or clear its stamp when it came on.

    Run after `kind`'s switch is written, and for that kind alone. A kind that
    is off by `.env` and was never written has no stamp, since nobody can say
    since when.
    """
    stored = get_global_setting(session, REQUEST_KINDS_KEY)
    field = disabled_at_field(kind)
    if _enabled(stored, kind):
        stored.pop(field, None)
    else:
        stored.setdefault(field, int(time.time() * 1000))
    replace_global_setting(session, REQUEST_KINDS_KEY, stored)
    forget()
