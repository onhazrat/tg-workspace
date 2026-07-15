"""Shared persistence for Discover / auto-follow channel creation."""

from __future__ import annotations

import time
import uuid
from typing import Any

from sqlmodel import Session, col, select

from app.core.db import engine
from app.models_tg import Channel
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
)
from app.services.logs import upsert_network_log
from app.services.network_settings import redact_proxy_url
from app.services.sync_meta import touch_sync
from app.services.sync_schedule import compute_next_regular_sync_at_from_last_updated


def _save_network_telemetry(
    session: Session,
    url: str,
    telemetry: Any,
    *,
    user_id: uuid.UUID | None,
    status_code: int = 200,
) -> None:
    logs = telemetry if isinstance(telemetry, list) else [telemetry]
    for t in logs:
        if not t:
            continue
        attempts = t.get("attempts") or []
        proxy_used = attempts[-1].get("proxyUrl") if attempts else None
        upsert_network_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "url": url,
                "method": "GET",
                "status": "success" if t.get("success") else "failed",
                "statusCode": status_code,
                "duration": t.get("totalDuration", 0),
                "timestamp": int(time.time() * 1000),
                "source": "Scraper",
                "proxyUsed": redact_proxy_url(proxy_used),
                "attempts": len(attempts) if attempts else 1,
                "telemetry": t,
            },
            user_id,
        )


def normalize_channel_name(raw: str) -> str:
    return raw.strip().replace("@", "").split("/")[-1]


def channel_name_exists(session: Session, name: str) -> bool:
    return (
        session.exec(select(Channel).where(col(Channel.name) == name)).first()
        is not None
    )


def channel_exists(name: str) -> bool:
    with Session(engine) as session:
        return channel_name_exists(session, name)


def create_followed_channel(
    clean: str,
    *,
    display_name: str,
    photo_url: str | None,
    is_unavailable: bool,
    discovered_via: dict[str, Any] | None,
    user_id: uuid.UUID | None,
    effective_start_time: int,
    telemetry_url: str | None = None,
    telemetry: Any = None,
) -> bool:
    """Create a newly followed channel. Returns False if it already exists."""
    with Session(engine) as session:
        if channel_name_exists(session, clean):
            return False
        if telemetry_url and telemetry:
            _save_network_telemetry(session, telemetry_url, telemetry, user_id=user_id)
        now = int(time.time() * 1000)
        if is_unavailable:
            group = get_or_create_restricted_group(session, user_id=user_id)
        else:
            group = ensure_default_group(session, user_id=user_id)
        session.add(
            Channel(
                id=clean,
                name=clean,
                display_name=display_name,
                photo_url=photo_url,
                start_time=effective_start_time,
                last_updated=now,
                followed_at=now,
                tags=[],
                setting_group_id=group.id,
                discovered_via=discovered_via,
                next_regular_sync_at=(
                    compute_next_regular_sync_at_from_last_updated(
                        now,
                        group.auto_sync_interval_minutes,
                        now,
                    )
                    if group.regular_sync_enabled
                    else None
                ),
                next_dynamic_sync_at=None,
                user_id=user_id,
            )
        )
        session.commit()
        touch_sync(session, "channels")
        return True
