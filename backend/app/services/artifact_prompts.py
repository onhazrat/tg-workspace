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

from sqlmodel import Session, col, select

from app.ai.models import ChatRequest, TagRequest
from app.models_tg import Channel, ChatSessionPayload, Summary, SummaryPayload
from app.prompts.summary import format_summary_prompt, rtl_instruction
from app.prompts.tagging import format_tag_prompt
from app.prompts.templates import CHAT_PROMPT, RAG_CHAT_PROMPT
from app.services.artifact_coverage import Coverage, posts_block, require_scope
from app.services.chat_sessions import chat_scope, own_chat_session
from app.services.settings_registry import AI_PREFS_KEY
from app.services.summaries import summary_scope
from app.services.tag_runs import own_tag_run, tag_run_scope
from app.services.tags import tags_by_handle
from app.services.telegram_web import normalize_handle
from app.services.user_settings import get_user_setting


def channels_block(session: Session, channels: list[str], *, user_id: uuid.UUID) -> str:
    """How a prompt names its Channels, by the Account's bio and tags setting.

    Built here, never in a browser, so the scheduler, which has no browser,
    describes a regeneration's Channels as Generate does (AC-03). Both
    switches off is the bare names; otherwise a `### name` section per
    Channel with its bio and the Account's own tags, each when it has any.
    """
    prefs = get_user_setting(session, AI_PREFS_KEY, user_id=user_id)
    include_bio = prefs.get("includeChannelBio") is True
    include_tags = prefs.get("includeChannelTags") is True
    if not channels or not (include_bio or include_tags):
        return ", ".join(channels)
    bios: dict[str, str] = {}
    if include_bio:
        rows = session.exec(
            select(Channel.name, Channel.bio).where(col(Channel.name).in_(channels))
        ).all()
        bios = {name: (bio or "").strip() for name, bio in rows}
    tags = (
        tags_by_handle(session, user_id=user_id, handles=channels)
        if include_tags
        else {}
    )
    sections = []
    for name in channels:
        lines = [f"### {name}"]
        if bios.get(name):
            lines.append(f"Bio: {bios[name]}")
        names = [tag["name"] for tag in tags.get(normalize_handle(name), [])]
        if names:
            lines.append(f"Current tags: {', '.join(names)}")
        sections.append("\n".join(lines))
    return "\n\n".join(sections)


def summary_prompt(
    session: Session,
    summary: Summary,
    payload: SummaryPayload | None,
) -> tuple[str, Coverage]:
    """The prompt a Summary's Covered Posts make, as Generate builds it.

    One builder for Generate, Retry, the scheduler and a copied prompt, so the
    same Summary gets the same prompt from all four. A 413 is a limit, and the
    caller records it as such. The `Coverage` says which Posts it read, for a
    regeneration's Scope to record, and how many were missing.
    """
    scope = require_scope(summary_scope(summary, payload))
    posts_text, coverage = posts_block(session, scope, user_id=summary.user_id)
    channels = list(scope.channels)
    prompt = format_summary_prompt(
        channels=channels,
        channels_text=channels_block(session, channels, user_id=summary.user_id),
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
    scope = chat_scope(chat, session.get(ChatSessionPayload, chat.id))
    if body.posts_text:
        posts_text, missing = body.posts_text, 0
    else:
        posts_text, coverage = posts_block(
            session, require_scope(scope), user_id=user_id
        )
        missing = coverage.missing
    channels = list(scope.channels) if scope is not None else []
    template = RAG_CHAT_PROMPT if body.rag_mode else CHAT_PROMPT
    system = template.format(
        channels=channels_block(session, channels, user_id=user_id),
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
    channels = list(scope.channels)
    prompt = format_tag_prompt(
        channels=channels,
        channels_text=channels_block(session, channels, user_id=user_id),
        posts_text=posts_text,
        all_tags=body.all_tags,
        tag_mode=body.tag_mode,
        tags_per_channel_min=body.tags_per_channel_min,
        tags_per_channel_max=body.tags_per_channel_max,
    )
    return prompt, coverage.missing
