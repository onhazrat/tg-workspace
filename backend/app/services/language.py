"""A Post's Language, read from its own words (LANG-01, ADR-021).

`read_language` is the one answer to "what Language is this text in": an ISO 639
code as fastText labels it (`fa`, `en`, `ckb`), `NO_WORDS` when there is nothing
to read, or `UNDETERMINED` when there are words it cannot place. `own_words`
is the one answer to "what did this Post actually say", shared with the
Directory statistics so a captionless photo means the same thing in both.

`detect_language_from_posts` below is the retired channel-level detector, still
called by sync finalisation until LANG-02 deletes both.
"""

from __future__ import annotations

import functools
import re
import unicodedata
from typing import Any, Protocol

from fast_langdetect import LangDetectConfig, LangDetector

from app.services.post_media_parser import LEGACY_MEDIA_PLACEHOLDER

#: A Post with no words: a captionless photo, a sticker, an emoji. BCP 47's
#: "no linguistic content", as Elasticsearch's language identifier answers it.
NO_WORDS = "zxx"
#: Words the detector cannot place: too few of them, or no confident answer.
#: Finglish lands here or, worse, on a confident wrong code (ADR-021).
UNDETERMINED = "und"

#: Below this many letters a Post is `UNDETERMINED` without asking the model.
#: One global value rather than one per language (ADR-021): the corpus is a
#: handful of high-resource languages and nobody tunes this from `.env`.
# ponytail: counts characters, so a full Chinese or Japanese sentence under 20
# characters is `und`; weight dense scripts if a CJK Channel ever matters.
MIN_LETTERS = 20
#: The model's top score must reach this, or the Post is `UNDETERMINED`. On the
#: ADR-021 benchmark it kept fastText's mistakes on two-word Posts to 41 of 1,143.
MIN_SCORE = 0.5

_URL = re.compile(r"https?://\S+|www\.\S+|\bt\.me/\S+", re.IGNORECASE)
_MENTION = re.compile(r"@\w+")
_HASHTAG = re.compile(r"#(\w+)")
#: Persian writes compound words with a zero-width non-joiner; dropping it
#: would split them into fragments the model has seen less often.
_JOINERS = frozenset("‌‍")


class HasWords(Protocol):
    """What both `Post` and `DirectorySample` carry that `own_words` reads."""

    text: str
    media: dict[str, Any] | None


def own_words(post: HasWords) -> str | None:
    """The Post's own words, or `None` when it had none.

    A Post with no media block never had a caption to synthesise over, so its
    `text` is what was written, unless it is the placeholder the parser wrote
    for a post it could read nothing from before media was stored. A Post
    *with* one carries its caption there if it had one at all:
    `parse_widget_media` sets the field unconditionally, but
    `PostMedia.to_storage_dict` dumps with `exclude_none=True`, so a Post with
    no caption reaches storage with no `caption` key. An absent key therefore
    means the stored `text` is a synthesised placeholder (`[photo]`), and this
    reads it as no words rather than as ASCII ones. The key has been stored
    since media storage itself, so no older media row lacks it.

    The `isinstance` below is what makes that safe rather than merely likely — a
    row written before that dump rule, or by a future caller that keeps nulls,
    still answers "no caption" instead of returning `None` as a string.
    """
    if post.media is None:
        text = post.text
        return text if text and text != LEGACY_MEDIA_PLACEHOLDER else None
    caption = post.media.get("caption")
    return caption if isinstance(caption, str) and caption else None


def _letters_only(words: str) -> str:
    """Words with links, @mentions and hashtag markers gone, letters kept."""
    words = _URL.sub(" ", words)
    words = _MENTION.sub(" ", words)
    words = _HASHTAG.sub(lambda m: m.group(1).replace("_", " "), words)
    kept = (
        ch
        if ch.isalpha() or ch in _JOINERS or unicodedata.category(ch)[0] == "M"
        else " "
        for ch in words
    )
    return " ".join("".join(kept).split())


@functools.cache
def _detector() -> LangDetector:
    # `lite` is bundled in the wheel, so nothing is downloaded at runtime; the
    # library's `auto` would try the full model's download first. Its default
    # input limit truncates to 80 characters and logs every time it does; `None`
    # reads the whole Post, which fastText does in linear time.
    return LangDetector(LangDetectConfig(model="lite", max_input_length=None))


def read_language(words: str | None) -> str:
    """The Language of a Post's own words: a code, `NO_WORDS` or `UNDETERMINED`."""
    if not words:
        return NO_WORDS
    letters = _letters_only(words)
    # Counted rather than tested for emptiness: an emoji's variation selector
    # and a keycap's enclosing mark are combining marks, and a family emoji is
    # glued with a joiner, so "❤️❤️" leaves marks behind and no letters.
    letter_count = sum(ch.isalpha() for ch in letters)
    if letter_count == 0:
        return NO_WORDS
    if letter_count < MIN_LETTERS:
        return UNDETERMINED
    best = _detector().detect(letters, k=1)[0]
    if float(best["score"]) < MIN_SCORE:
        return UNDETERMINED
    return str(best["lang"])


_ISO639_3_TO_NAME: dict[str, str] = {
    "eng": "English",
    "fas": "Persian",
    "ara": "Arabic",
    "rus": "Russian",
    "ukr": "Ukrainian",
    "deu": "German",
    "fra": "French",
    "spa": "Spanish",
    "ita": "Italian",
    "tur": "Turkish",
    "heb": "Hebrew",
    "urd": "Urdu",
    "zho": "Chinese",
    "jpn": "Japanese",
    "kor": "Korean",
    "por": "Portuguese",
    "nld": "Dutch",
    "pol": "Polish",
}


def _sample_text(posts: list[dict[str, Any]], limit: int = 20) -> str:
    parts: list[str] = []
    for post in posts[:limit]:
        text = (post.get("text") or "").strip()
        if text:
            parts.append(text)
    return " ".join(parts)


def detect_language_from_posts(posts: list[dict[str, Any]]) -> str | None:
    """Detect language from recent posts; mirrors frontend franc-min behavior."""
    sample = _sample_text(posts)
    if len(sample) < 20:
        return None

    try:
        from langdetect import DetectorFactory, detect

        DetectorFactory.seed = 0
        code = detect(sample)
    except Exception:
        return None

    if not code or code == "und":
        return None

    # langdetect returns ISO 639-1; map common codes to display names
    iso3_map = {
        "en": "eng",
        "fa": "fas",
        "ar": "ara",
        "ru": "rus",
        "uk": "ukr",
        "de": "deu",
        "fr": "fra",
        "es": "spa",
        "it": "ita",
        "tr": "tur",
        "he": "heb",
        "ur": "urd",
        "zh-cn": "zho",
        "zh-tw": "zho",
        "ja": "jpn",
        "ko": "kor",
        "pt": "por",
        "nl": "nld",
        "pl": "pol",
    }
    iso3 = iso3_map.get(code, code)
    name = _ISO639_3_TO_NAME.get(iso3, code)
    return str(name)
