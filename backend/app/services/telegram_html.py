"""Plain-text extraction from Telegram web-view HTML fragments."""

from __future__ import annotations

from copy import copy

from bs4 import Tag


def extract_telegram_html_text(el: Tag | None) -> str:
    """Return plain text while preserving ``<br>`` line breaks and inline spacing.

    BeautifulSoup's ``get_text(strip=True)`` strips whitespace from each text
    fragment before concatenation, which removes newlines inserted from ``<br>``
    tags and collapses spaces around inline elements such as ``<b>`` and ``<a>``.
    """
    if el is None:
        return ""
    text_el = copy(el)
    for br in text_el.find_all("br"):
        br.replace_with("\n")
    return text_el.get_text(strip=False).strip()
