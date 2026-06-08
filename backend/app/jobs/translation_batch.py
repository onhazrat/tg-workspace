"""Batch-translate posts missing translations (DECISION #7 — not hover)."""

from __future__ import annotations

import logging
import time
import uuid
from datetime import datetime

from sqlmodel import Session, col, select

from app.ai.registry import default_model, get_provider
from app.api.routes.data import _touch_sync
from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import load_translation_settings
from app.models_tg import Post, PostTranslation

logger = logging.getLogger(__name__)

BATCH_LIMIT = 20
MAX_BATCH_CHARS = 4000


def _posts_needing_translation(
    session: Session,
    language: str,
    limit: int,
) -> list[Post]:
    stmt = (
        select(Post)
        .outerjoin(
            PostTranslation,
            (Post.channel_name == PostTranslation.channel_name)
            & (Post.post_id == PostTranslation.post_id)
            & (PostTranslation.language == language),
        )
        .where(col(PostTranslation.id).is_(None))
        .order_by(Post.timestamp.desc())
        .limit(limit)
    )
    return list(session.exec(stmt).all())


async def run_translation_batch() -> dict:
    with Session(engine) as session:
        cfg = load_translation_settings(session)
        if not cfg.get("translationEnabled") or not cfg.get("autoTranslate"):
            return {"skipped": True, "reason": "translation_disabled"}

        target_language = str(cfg.get("translationTargetLanguage") or "English")
        model = str(cfg.get("translationModel") or default_model())

        posts = _posts_needing_translation(session, target_language, BATCH_LIMIT)
        if not posts:
            return {"skipped": True, "reason": "no_posts", "translated": 0}

        if not settings.GEMINI_API_KEY:
            raise ValueError("GEMINI_API_KEY not configured")

        selected: list[Post] = []
        char_count = 0
        for post in posts:
            text_len = len(post.text or "")
            if selected and char_count + text_len > MAX_BATCH_CHARS:
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
                existing.updated_at = datetime.utcnow()
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
            _touch_sync(session, "translations")

        return {"translated": upserted, "language": target_language}
