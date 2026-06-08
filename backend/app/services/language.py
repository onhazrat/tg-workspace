"""Lightweight language detection from post text samples."""

from __future__ import annotations

from typing import Any

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
    return _ISO639_3_TO_NAME.get(iso3, code)
