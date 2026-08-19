"""Sync etag helpers (extracted from data routes)."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session, select

from app.models_tg import SyncMeta, utc_now


def touch_sync(session: Session, resource: str, *, commit: bool = True) -> None:
    """Move a resource's etag so clients know to refetch it.

    Pass `commit=False` when the caller is about to commit anyway, and place the
    call **immediately before** that commit. Two things come of it:

    * One fsync instead of two. Every caller in `sync_orchestrator` was
      `session.commit()` followed by this function committing a second time, and
      the sync path runs it per page as well as per channel: **181,879
      `UPDATE tg_sync_meta SET etag` in 10 hours on staging**, 19 minutes of
      database time, for a single-row table.
    * The etag moves in the same transaction as the change it announces. Split
      across two commits, a crash in between leaves the data updated and the
      etag stale — and a stale etag is not self-correcting, it tells every
      client that there is nothing to refetch.

    Immediately before, and not earlier: this takes a row lock on a table every
    concurrent sync worker writes, so anything between the call and the commit
    is time the others spend queueing.
    """
    meta = session.get(SyncMeta, resource)
    etag = str(uuid.uuid4())
    if meta:
        meta.etag = etag
        meta.updated_at = utc_now()
        session.add(meta)
    else:
        session.add(SyncMeta(resource=resource, etag=etag))
    if commit:
        session.commit()


def get_sync_meta(session: Session) -> dict[str, Any]:
    rows = session.exec(select(SyncMeta)).all()
    return {
        r.resource: {"etag": r.etag, "updatedAt": r.updated_at.isoformat()}
        for r in rows
    }
