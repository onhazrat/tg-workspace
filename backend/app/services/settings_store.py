"""Generic AppSetting read/write helpers."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.models_tg import AppSetting


def get_app_setting(session: Session, key: str) -> dict[str, Any]:
    row = session.get(AppSetting, key)
    if not row:
        return {"key": key, "value": {}}
    return {"key": key, "value": row.value}


def put_app_setting(
    session: Session,
    key: str,
    body: dict[str, Any],
    *,
    user_id: UUID,
) -> dict[str, Any]:
    row = session.get(AppSetting, key)
    merged = {**(row.value if row else {}), **body}
    if row:
        row.value = merged
        row.updated_at = datetime.utcnow()
    else:
        row = AppSetting(key=key, value=merged, user_id=user_id)
    session.add(row)
    session.commit()
    return {"key": key, "value": row.value}
