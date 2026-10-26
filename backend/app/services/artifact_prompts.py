"""The prompt each Artifact family gets, read from its Covered Posts (ADR-038).

A read model. One builder per family, for every door that asks: Generate,
Retry and the scheduler (through `start_attempt`) and a copied prompt for a
Summary, every turn of a Chat, a Tag run's prompt and its stream. Each reads
its Artifact through the family's by-id read guard, so a foreign or absent id
is that family's 404, and its posts block through `artifact_coverage`, which
never names an Artifact table itself.
"""

from __future__ import annotations

import uuid

from sqlmodel import Session

from app.ai.models import ChatRequest, TagRequest
from app.models_tg import ChatSessionPayload, Summary, SummaryPayload
from app.prompts.summary import format_summary_prompt, rtl_instruction
from app.prompts.tagging import format_tag_prompt
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT
from app.services.artifact_coverage import Coverage, posts_block, require_scope
from app.services.chat_sessions import chat_scope, own_chat_session
from app.services.summaries import summary_scope
from app.services.tag_runs import own_tag_run, tag_run_scope


def summary_prompt(
    session: Session,
    summary: Summary,
    payload: SummaryPayload | None,
    *,
    channels_text: str = "",
) -> tuple[str, Coverage]:
    """The prompt a Summary's Covered Posts make, as Generate builds it.

    One builder for Generate, Retry, the scheduler and a copied prompt, so the
    same Summary gets the same prompt from all four. A 413 is a limit, and the
    caller records it as such. The `Coverage` says which Posts it read, for a
    regeneration's Scope to record, and how many were missing.
    """
    scope = require_scope(summary_scope(summary, payload))
    posts_text, coverage = posts_block(session, scope, user_id=summary.user_id)
    prompt = format_summary_prompt(
        channels=list(scope.channels),
        channels_text=channels_text,
        language=summary.language,
        posts_text=posts_text,
    )
    return prompt, coverage


def chat_system_prompt(
    session: Session, body: ChatRequest, *, user_id: uuid.UUID
) -> tuple[str, int]:
    """A Chat turn's system prompt, and how many Covered Posts it left out.

    Each turn reads the Chat's own Covered Posts, so changing the Posts tab
    leaves an open Chat about the Posts it started from. Semantic mode's
    ranked `postsText` wins: the server cannot reproduce a meaning search.
    """
    chat = own_chat_session(session, body.chat_id, user_id=user_id)
    channels: list[str] = []
    if body.posts_text:
        posts_text, missing = body.posts_text, 0
    else:
        scope = require_scope(
            chat_scope(chat, session.get(ChatSessionPayload, chat.id))
        )
        posts_text, coverage = posts_block(session, scope, user_id=user_id)
        channels, missing = list(scope.channels), coverage.missing
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=body.channels_text.strip() or ", ".join(channels),
        language=body.language,
        rtl_instruction=rtl_instruction(body.language),
        posts_text=posts_text,
    )
    return system, missing


def tag_prompt(
    session: Session, body: TagRequest, *, user_id: uuid.UUID
) -> tuple[str, int]:
    """A Tag run's prompt from its Covered Posts by Channel, and how many were missing."""
    run = own_tag_run(session, body.tag_run_id, user_id=user_id)
    scope = require_scope(tag_run_scope(run))
    posts_text, coverage = posts_block(session, scope, user_id=user_id, layout="tag")
    prompt = format_tag_prompt(
        channels=list(scope.channels),
        channels_text=body.channels_text,
        posts_text=posts_text,
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )
    return prompt, coverage.missing
