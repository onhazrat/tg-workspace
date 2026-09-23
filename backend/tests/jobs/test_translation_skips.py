"""Translation skips Posts that need none (LANG-04, ADR-021).

The Operator Key paid to translate English Posts into English and to translate
the `[photo]` placeholder a captionless photo is stored as. Asserted through the
job runner with a fake Provider: what reaches `translate_batch` is what the
Operator pays for.

## Watched to fail

* drop the `NO_WORDS` filter → the photo reaches the Provider
* drop the same-code filter → the English Post reaches the Provider
* filter `UNDETERMINED` as well → the Finglish Post never does
* `IS DISTINCT FROM` for the `zxx` filter → the unread Post jumps the walk
* skip everything on an unmapped name → the Klingon test translates nothing
* add or rename a name on either side → the map guard, in both directions
"""

from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import save_settings_section
from app.jobs.translation_batch import TRANSLATION_LANGUAGE_CODES, run_translation_batch
from app.models_tg import Post
from tests.utils.tenancy import follow_channels

CHANNEL = "transchan"
CONSTANTS = Path(__file__).resolve().parents[3] / "frontend/src/constants.ts"

POSTS: dict[int, tuple[str, str | None]] = {
    1: ("Heavy rain flooded many streets in the capital", "en"),
    2: ("امروز باران شدیدی در تهران بارید", "fa"),
    3: ("[photo]", "zxx"),
    4: ("salam chetori khoobi", "und"),
    5: ("A Post stored before LANG-01", None),
}


def _seed(session: Session) -> None:
    follow_channels(session, CHANNEL)
    for post_id, (text, language) in POSTS.items():
        session.add(
            Post(
                channel_name=CHANNEL,
                post_id=post_id,
                text=text,
                timestamp=1_790_000_000_000 + post_id,
                language=language,
            )
        )
    session.commit()


def _translated_into(target: str) -> set[int]:
    """The Post ids the job handed the Provider."""
    with Session(engine) as session:
        save_settings_section(
            session,
            "translation",
            {
                "translationEnabled": True,
                "autoTranslate": True,
                "translationTargetLanguage": target,
            },
        )
    provider = AsyncMock()
    provider.translate_batch.return_value = []
    with (
        patch.object(settings, "GEMINI_API_KEY", "operator-key"),
        patch("app.jobs.translation_batch.get_provider", return_value=provider),
    ):
        asyncio.run(run_translation_batch())
    if not provider.translate_batch.await_count:
        return set()
    batch: list[dict[str, Any]] = provider.translate_batch.await_args.args[0]
    return {int(item["id"].rsplit("_", 1)[1]) for item in batch}


def test_same_language_and_no_words_never_reach_the_provider(db: Session) -> None:
    _seed(db)
    assert _translated_into("English") == {2, 4}


def test_an_unmapped_translation_language_skips_only_what_has_no_words(
    db: Session,
) -> None:
    """A name the map lacks disables the same-language skip, not every Post."""
    _seed(db)
    assert _translated_into("Klingon") == {1, 2, 4}


def _frontend_codes() -> dict[str, str]:
    source = CONSTANTS.read_text()
    block = re.search(r"LANGUAGE_CODES[^{]*\{(.*?)\}", source, re.DOTALL)
    assert block, f"LANGUAGE_CODES not found in {CONSTANTS}"
    return dict(re.findall(r"(\w+):\s*\"([\w-]+)\"", block.group(1)))


def test_the_backend_map_is_the_frontends_list_of_translation_languages() -> None:
    """Both directions: a name offered in the browser that the job cannot map
    silently translates English into English again, and a name only the backend
    knows is a code nobody can pick."""
    assert _frontend_codes() == TRANSLATION_LANGUAGE_CODES
