"""A Summary's Publication: planned into Parts, then sent (SUMTAB-09).

The publish panel previews `plan_publication` and the send delivers exactly
what it returns, so what a person previews is what their channel receives.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal, cast

from fastapi import HTTPException
from sqlmodel import Session, col, select

from app.ai.registry import default_model
from app.models_tg import BotCredential, ChatDestination, PublishLog, Summary
from app.schemas.scope import FrozenScope
from app.services.credentials import CHAT_DESTINATION_NOT_FOUND
from app.services.logs import upsert_publish_log
from app.services.network_settings import (
    load_network_settings,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.publication_parts import Part, build_parts, default_metadata
from app.services.publish import PartFailed, load_publishing_settings, send_parts
from app.services.sync_meta import touch_sync
from app.services.tenancy import assert_owner_on_write, may_act_on, scoped_select


@dataclass(frozen=True)
class Plan:
    parts: list[Part]
    #: The generated metadata, whatever the Summary saved in its place.
    default_metadata: str


def plan_publication(
    session: Session,
    summary: Summary,
    *,
    user_id: uuid.UUID,
    include_metadata: bool,
    metadata_in_first_part: bool,
) -> Plan:
    """The Parts a Publication of `summary` sends, in `user_id`'s settings.

    The metadata is the Summary's saved text when it has one, else generated
    in the Account's time zone.
    """
    prefs = load_publishing_settings(session, user_id)
    extra = summary.extra or {}
    generated = default_metadata(
        scope=FrozenScope.from_stored(summary.scope),
        model=summary.model or default_model(),
        post_count=extra.get("postCount") or summary.post_count or 0,
        time_zone=prefs.time_zone,
    )
    metadata = (extra.get("metadataText") or generated) if include_metadata else None
    parts = build_parts(
        summary.text or "",
        metadata,
        citation_style=prefs.citation_style,
        metadata_in_first_part=metadata_in_first_part,
    )
    return Plan(parts=parts, default_metadata=generated)


class DestinationNotFound(ValueError):
    """Absent or someone else's, answered alike so ids cannot be probed."""


@dataclass(frozen=True)
class Outcome:
    status: Literal["success", "failed"]
    error: str | None
    parts_sent: int
    parts_total: int


async def send_publication(
    session: Session,
    summary: Summary,
    *,
    user_id: uuid.UUID,
    bot_id: str,
    destination_id: str,
    include_metadata: bool,
    metadata_in_first_part: bool,
) -> Outcome:
    """Plan `summary` and send exactly those Parts, then file one publish log.

    A foreign destination raises `DestinationNotFound` and a foreign bot
    `BotCredentialNotFound`, both before any token is decrypted and before
    anything is logged. A Part Telegram refuses stops the send; the log row
    records it as failed with every planned Part's text.
    """
    dest = session.get(ChatDestination, destination_id)
    if not dest or not may_act_on(owner_id=dest.user_id, user_id=user_id):
        raise DestinationNotFound(CHAT_DESTINATION_NOT_FOUND)
    parts = plan_publication(
        session,
        summary,
        user_id=user_id,
        include_metadata=include_metadata,
        metadata_in_first_part=metadata_in_first_part,
    ).parts
    return await _deliver(
        session,
        summary_id=summary.id,
        user_id=user_id,
        log_id=str(uuid.uuid4()),
        bot_id=bot_id,
        chat_id=dest.chat_id,
        chat_name=dest.name,
        parts=[p.text for p in parts],
        already_sent=0,
        earlier_responses=[],
    )


@dataclass(frozen=True)
class Partial:
    """A Publication that stopped after some of its Parts went out (SUMTAB-10)."""

    id: str
    parts_sent: int
    parts_total: int


def _as_partial(log: PublishLog | None) -> Partial | None:
    """`log` as a Partial when it stopped with at least one Part out.

    The stored Parts and the count live in `full_request`; a row written
    before SUMTAB-10 has no count, so it is never offered for resuming.
    """
    request = log.full_request if log else None
    if log is None or not isinstance(request, dict):
        return None
    parts, sent = request.get("parts"), request.get("partsSent")
    if not isinstance(parts, list) or not isinstance(sent, int):
        return None
    if not 0 < sent < len(parts):
        return None
    return Partial(id=log.id, parts_sent=sent, parts_total=len(parts))


def latest_partial(
    session: Session, summary_id: str, *, user_id: uuid.UUID
) -> Partial | None:
    """The Summary's latest Publication, when that one is partial.

    Only the latest: a Publication sent since means the publisher moved on.
    """
    latest = session.exec(
        scoped_select(
            select(PublishLog)
            .where(col(PublishLog.summary_id) == summary_id)
            .order_by(col(PublishLog.timestamp).desc())
            .limit(1),
            PublishLog,
            user_id,
        )
    ).first()
    return _as_partial(latest)


async def _deliver(
    session: Session,
    *,
    summary_id: str,
    user_id: uuid.UUID,
    log_id: str,
    bot_id: str,
    chat_id: str,
    chat_name: str,
    parts: list[str],
    already_sent: int,
    earlier_responses: list[Any],
) -> Outcome:
    """Send `parts[already_sent:]` and file them as publish log `log_id`.

    The row records every Part's text, how many have gone out in all, and
    the failure that stopped it; a resume overwrites the same row.
    """
    network = load_network_settings(session)
    responses = list(earlier_responses)
    try:
        result = await send_parts(
            session,
            acting_user_id=user_id,
            credential_id=bot_id,
            chat_id=chat_id,
            parts=parts[already_sent:],
            proxies=resolve_proxies(network),
            proxy_concurrency=resolve_proxy_concurrency(network),
            tor_auto_rotate=bool(network.get("torAutoRotate")),
            tor_rotation_threshold=int(network.get("torRotationThreshold") or 10),
        )
        outcome = Outcome("success", None, len(parts), len(parts))
        responses += result["results"]
    except PartFailed as exc:
        outcome = Outcome("failed", str(exc), already_sent + exc.sent, len(parts))
    bot = session.get(BotCredential, bot_id)
    upsert_publish_log(
        session,
        {
            "id": log_id,
            "summary_id": summary_id,
            "bot_id": bot_id,
            "bot_name": bot.name if bot else bot_id,
            "chat_id": chat_id,
            "chat_name": chat_name,
            "status": outcome.status,
            "error": outcome.error,
            "timestamp": int(time.time() * 1000),
            "full_request": {"parts": parts, "partsSent": outcome.parts_sent},
            "full_response": responses or None,
            "text_sent": "\n\n".join(parts),
        },
        user_id,
    )
    session.commit()
    touch_sync(session, "publish_logs")
    return outcome


PUBLICATION_NOT_FOUND = "Publication not found"


async def resume_publication(
    session: Session,
    summary: Summary,
    *,
    user_id: uuid.UUID,
    publication_id: str,
) -> Outcome:
    """Send a partial Publication's remaining stored Parts, never re-planned.

    Goes to the bot and chat the Publication started with and overwrites its
    own publish-log row. Someone else's Publication, or one of another
    Summary, answers as an absent one; a Publication with nothing left to
    finish is a 409.
    """
    log = session.get(PublishLog, publication_id)
    if log is None or log.summary_id != summary.id:
        raise HTTPException(status_code=404, detail=PUBLICATION_NOT_FOUND)
    assert_owner_on_write(log.user_id, user_id, detail=PUBLICATION_NOT_FOUND)
    partial = _as_partial(log)
    if partial is None:
        raise HTTPException(status_code=409, detail="Publication is not partial")
    request = cast(dict[str, Any], log.full_request)
    earlier = log.full_response if isinstance(log.full_response, list) else []
    return await _deliver(
        session,
        summary_id=summary.id,
        user_id=user_id,
        log_id=log.id,
        bot_id=log.bot_id,
        chat_id=log.chat_id,
        chat_name=log.chat_name,
        parts=[str(text) for text in request["parts"]],
        already_sent=partial.parts_sent,
        earlier_responses=earlier,
    )
