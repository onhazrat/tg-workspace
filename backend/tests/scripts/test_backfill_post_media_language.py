"""The media backfill re-reads the Language of a Post it rewrites (LANG-01).

The script replaces a Post's text and media outside the write path. A row read
as `zxx` from its old placeholder would otherwise keep that answer for good,
because the Language walk visits only unread rows.

## Watched to fail

* drop the re-read from `_process_post` → the Post stays `zxx`
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Post
from app.services.posts import bulk_upsert_posts_impl
from tests.utils.tg_html import body_html

_SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "scripts"
if str(_SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS_DIR))

import backfill_post_media  # noqa: E402

CHANNEL = "mediabackfillchan"
PERSIAN = "امروز باران شدیدی در تهران بارید و بسیاری از خیابان‌ها را آب گرفت"


def test_a_rewritten_post_is_read_again(monkeypatch: pytest.MonkeyPatch) -> None:
    with Session(engine) as session:
        bulk_upsert_posts_impl(
            [
                {
                    "channelName": CHANNEL,
                    "id": 7,
                    "text": "[Media/No Text Content]",
                    "timestamp": 1_790_000_000_000,
                }
            ],
            session,
        )
        session.commit()
        post = session.exec(select(Post).where(Post.channel_name == CHANNEL)).one()
        assert post.language == "zxx"

    async def page(channel_name: str, post_id: int) -> str:
        return (
            f'<div class="tgme_widget_message" data-post="{channel_name}/{post_id}">'
            f"{body_html(PERSIAN)}</div>"
        )

    monkeypatch.setattr(backfill_post_media, "_fetch_post_html", page)
    result = asyncio.run(
        backfill_post_media._process_post(
            post, dry_run=False, cache_thumbs=False, sleep_seconds=0, max_size_mb=0
        )
    )

    assert result["updated"]
    with Session(engine) as session:
        row = session.exec(select(Post).where(Post.channel_name == CHANNEL)).one()
        assert (row.text, row.language) == (PERSIAN, "fa")
