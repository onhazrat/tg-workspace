"""Plain-text extraction from Telegram web-view HTML fragments.

Telegram reuses the ``tgme_widget_message_text`` class for **two** different
things inside one message widget: the post body, and the quoted excerpt of the
post being replied to. The reply excerpt comes *first* in DOM order, so a naive
``select_one(".tgme_widget_message_text")`` silently returns the parent post's
truncated text. ``message_body_element`` is the only supported way to reach the
body — do not select that class directly.
"""

from __future__ import annotations

from copy import copy
from typing import Any

from bs4 import Tag
from bs4.element import NavigableString

_REPLY_TEXT_CLASS = "js-message_reply_text"
_REPLY_BLOCK_CLASS = "tgme_widget_message_reply"


def attr_str(value: str | list[str] | None) -> str | None:
    """Normalize a bs4 attribute to a single string.

    bs4 returns a list for multi-valued attributes (``class``, ``rel``).
    """
    if value is None:
        return None
    if isinstance(value, list):
        return value[0] if value else None
    return value


def message_reply_block(el: Tag) -> Tag | None:
    """The reply-preview anchor of a message widget, if the post is a reply."""
    return el.select_one(f"a.{_REPLY_BLOCK_CLASS}")


def message_body_element(el: Tag) -> Tag | None:
    """The post's own text node, never the quoted excerpt of a replied-to post.

    Two independent guards, deliberately: the ``js-`` class is the fast path,
    and the ancestor check still holds if Telegram renames its ``js-`` hooks.
    """
    for node in el.select(".tgme_widget_message_text"):
        raw_classes = node.get("class")
        classes = raw_classes if isinstance(raw_classes, list) else [raw_classes or ""]
        if _REPLY_TEXT_CLASS in classes:
            continue
        if node.find_parent("a", class_=_REPLY_BLOCK_CLASS) is not None:
            continue
        return node
    return None


def extract_telegram_html_text(el: Tag | None) -> str:
    """Return plain text while preserving ``<br>`` line breaks and inline spacing.

    BeautifulSoup's ``get_text(strip=True)`` strips whitespace from each text
    fragment before concatenation, which removes newlines inserted from ``<br>``
    tags and collapses spaces around inline elements such as ``<b>`` and ``<a>``.
    """
    if el is None:
        return ""
    return _flattened(el).get_text(strip=False).strip()


def _flattened(el: Tag) -> Tag:
    """A copy with each ``<br>`` as a newline, the one flattening both readers share."""
    text_el = copy(el)
    for br in text_el.find_all("br"):
        br.replace_with("\n")
    return text_el


def _utf16_len(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def extract_link_spans(el: Tag | None) -> list[dict[str, Any]]:
    """One Link for every ``<a href>`` in a body, positioned over its text (LINK-01).

    The text is flattened exactly as ``extract_telegram_html_text`` flattens it,
    so the positions land on the words a Post stores. They count UTF-16 code
    units, the unit the browser slices in, and the href is kept verbatim
    (ADR-022).
    """
    if el is None:
        return []
    text_el = _flattened(el)

    # (start, end, href) per anchor, in document order, in code points of the
    # unstripped text. Anchors cannot nest, so each string has at most one.
    bounds: dict[int, tuple[int, int, str | None]] = {}
    chunks: list[str] = []
    pos = 0
    for string in text_el.strings:
        anchor = (
            string.find_parent("a", href=True)
            if isinstance(string, NavigableString)
            else None
        )
        if anchor is not None:
            first, _, href = bounds.get(
                id(anchor), (pos, pos, attr_str(anchor.get("href")))
            )
            bounds[id(anchor)] = (first, pos + len(string), href)
        chunks.append(string)
        pos += len(string)

    raw = "".join(chunks)
    text = raw.strip()
    lead = len(raw) - len(raw.lstrip())
    spans: list[dict[str, Any]] = []
    for start, end, href in bounds.values():
        start, end = max(start - lead, 0), min(end - lead, len(text))
        if href and end > start:
            spans.append(
                {
                    "offset": _utf16_len(text[:start]),
                    "length": _utf16_len(text[start:end]),
                    "url": href,
                }
            )
    return spans
