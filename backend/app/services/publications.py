"""A Summary's Publication: planned into Parts, then sent (SUMTAB-09).

The publish panel previews `plan_publication` and the send delivers exactly
what it returns, so what a person previews is what their channel receives.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlmodel import Session

from app.ai.registry import default_model
from app.models_tg import Summary
from app.schemas.scope import FrozenScope
from app.services.publication_parts import Part, build_parts, default_metadata
from app.services.publish import load_publishing_settings


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
