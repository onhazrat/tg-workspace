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
from app.services.ai_keys import Purpose, resolve_ai_key
from app.services.follows import followed_channel_names
from app.services.language import NO_WORDS
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)

#: The Translation language setting is a name; a Post's Language is a code. This
#: is the frontend's `LANGUAGE_CODES`, held equal to it by
#: `tests/jobs/test_translation_skips.py`.
TRANSLATION_LANGUAGE_CODES = {
    "English": "en",
    "Persian": "fa",
    "Spanish": "es",
    "French": "fr",
    "German": "de",
    "Chinese": "zh",
    "Japanese": "ja",
    "Russian": "ru",
    "Portuguese": "pt",
    "Italian": "it",
    "Arabic": "ar",
}


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

    Only Posts that have been read, and none that need no translation (LANG-04):
    no words, or already in the Translation language. `und` stays, because that
    is where Finglish and short Posts land. A name missing from
    `TRANSLATION_LANGUAGE_CODES` keeps the same-language Posts rather than
    skipping everything. Filtered in SQL so skipped Posts never fill the batch.
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
        # `<>` is NULL for an unread Post, so this also makes unread Posts wait.
        .where(col(Post.language) != NO_WORDS)
        .order_by(col(Post.timestamp).desc())
        .limit(limit)
    )
    code = TRANSLATION_LANGUAGE_CODES.get(language)
    if code:
        stmt = stmt.where(col(Post.language) != code)
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

        # `TRANSLATE` on the Operator Key. This job has no Account at all —
        # it reads deployment settings and writes `tg_post_translations`, one
        # shared row per Post — so there is nobody whose Key could plausibly
        # pay for it (ADR-016).
        ai_key = resolve_ai_key(session, user_id=None, purpose=Purpose.TRANSLATE)
        provider = get_provider(
            provider=ai_key.provider,
            api_key=ai_key.api_key,
            base_url=ai_key.base_url,
        )
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
