"""Batch-translate posts missing translations (DECISION #7 — not hover)."""

from __future__ import annotations

import logging
import time
from typing import Any

from sqlmodel import Session, col, select

from app.ai.registry import default_model, get_provider
from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import load_translation_settings
from app.models_tg import Post, PostTranslation, utc_now
from app.services.follows import followed_channel_names
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)


def _posts_needing_translation(
    session: Session,
    language: str,
    limit: int,
) -> list[Post]:
    """Posts on any followed Channel that still lack a translation.

    **Not scoped to an account, and that is the answer rather than an
    omission** (ticket 21). `PostTranslation` is `FOLLOW_SCOPED` in `SCOPES`:
    a translation is corpus, produced once and served to every follower of the
    Channel, exactly like the Post it translates. Translating per account would
    mean paying a provider twice for the same text to store two identical rows.

    This used to select `Channel.user_id == operator OR NULL` through
    `channel_names_for_operator`, which is the Mode-A shape ticket 21 removes.
    The honest replacement is the union: every Channel somebody follows. A
    Channel nobody follows is excluded because it is retention's queue (ticket
    05) — spending provider quota translating posts that are about to be
    collected is the one case worth filtering out.
    """
    channel_names = followed_channel_names(session)
    if not channel_names:
        return []
    stmt = (
        select(Post)
        .outerjoin(
            PostTranslation,
            (col(Post.channel_name) == col(PostTranslation.channel_name))
            & (col(Post.post_id) == col(PostTranslation.post_id))
            & (col(PostTranslation.language) == language),
        )
        .where(col(PostTranslation.id).is_(None))
        .where(col(Post.channel_name).in_(channel_names))
        .where(col(Post.is_anchor) == False)  # noqa: E712
        .order_by(col(Post.timestamp).desc())
        .limit(limit)
    )
    return list(session.exec(stmt).all())


async def run_translation_batch() -> dict[str, Any]:
    with Session(engine) as session:
        cfg = load_translation_settings(session)
        if not cfg.get("translationEnabled") or not cfg.get("autoTranslate"):
            return {"skipped": True, "reason": "translation_disabled"}

        target_language = str(cfg.get("translationTargetLanguage") or "English")
        model = str(cfg.get("translationModel") or default_model())

        posts = _posts_needing_translation(
            session,
            target_language,
            settings.TRANSLATION_BATCH_LIMIT,
        )
        if not posts:
            return {"skipped": True, "reason": "no_posts", "translated": 0}

        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not configured")

        selected: list[Post] = []
        char_count = 0
        for post in posts:
            text_len = len(post.text or "")
            if (
                selected
                and char_count + text_len > settings.TRANSLATION_BATCH_MAX_CHARS
            ):
                break
            selected.append(post)
            char_count += text_len

        provider = get_provider("gemini")
        batch_input = [
            {"id": f"{p.channel_name}_{p.post_id}", "text": p.text or ""}
            for p in selected
        ]
        translations = await provider.translate_batch(
            batch_input,
            target_language=target_language,
            model=model,
        )
        result_map = {t["id"]: t["translation"] for t in translations}
        now = int(time.time() * 1000)
        upserted = 0
        for post in selected:
            key = f"{post.channel_name}_{post.post_id}"
            translated = result_map.get(key)
            if not translated:
                continue
            tid = f"{post.channel_name}_{post.post_id}_{target_language}"
            existing = session.get(PostTranslation, tid)
            if existing:
                existing.translated_text = translated
                existing.timestamp = now
                existing.updated_at = utc_now()
                session.add(existing)
            else:
                session.add(
                    PostTranslation(
                        id=tid,
                        channel_name=post.channel_name,
                        post_id=post.post_id,
                        language=target_language,
                        translated_text=translated,
                        timestamp=now,
                    )
                )
            upserted += 1

        session.commit()
        if upserted:
            touch_sync(session, "translations")

        return {"translated": upserted, "language": target_language}
