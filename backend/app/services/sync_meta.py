"""Sync etag helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlmodel import Session

from app.models_tg import SyncMeta


def touch_sync(session: Session, resource: str) -> None:
    meta = session.get(SyncMeta, resource)
    etag = str(uuid.uuid4())
    if meta:
        meta.etag = etag
        meta.updated_at = datetime.utcnow()
        session.add(meta)
    else:
        session.add(SyncMeta(resource=resource, etag=etag))
    session.commit()
