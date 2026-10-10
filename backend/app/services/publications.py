"""A Summary's Publication: planned into Parts, then sent (SUMTAB-09).

The publish panel previews `plan_publication` and the send delivers exactly
what it returns, so what a person previews is what their channel receives.
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from typing import Any, Literal

from sqlmodel import Session

from app.ai.registry import default_model
from app.models_tg import BotCredential, ChatDestination, Summary
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
from app.services.tenancy import may_act_on


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
    chat_id, chat_name = dest.chat_id, dest.name
    parts = plan_publication(
        session,
        summary,
        user_id=user_id,
        include_metadata=include_metadata,
        metadata_in_first_part=metadata_in_first_part,
    ).parts
    network = load_network_settings(session)
    response: Any = None
    try:
        result = await send_parts(
            session,
            acting_user_id=user_id,
            credential_id=bot_id,
            chat_id=chat_id,
            parts=parts,
            proxies=resolve_proxies(network),
            proxy_concurrency=resolve_proxy_concurrency(network),
            tor_auto_rotate=bool(network.get("torAutoRotate")),
            tor_rotation_threshold=int(network.get("torRotationThreshold") or 10),
        )
        outcome = Outcome("success", None, len(parts), len(parts))
        response = result["results"]
    except PartFailed as exc:
        outcome = Outcome("failed", str(exc), exc.sent, len(parts))
    bot = session.get(BotCredential, bot_id)
    upsert_publish_log(
        session,
        {
            "id": str(uuid.uuid4()),
            "summary_id": summary.id,
            "bot_id": bot_id,
            "bot_name": bot.name if bot else bot_id,
            "chat_id": chat_id,
            "chat_name": chat_name,
            "status": outcome.status,
            "error": outcome.error,
            "timestamp": int(time.time() * 1000),
            "full_request": {"parts": [p.text for p in parts]},
            "full_response": response,
            "text_sent": "\n\n".join(p.text for p in parts),
        },
        user_id,
    )
    session.commit()
    touch_sync(session, "publish_logs")
    return outcome
