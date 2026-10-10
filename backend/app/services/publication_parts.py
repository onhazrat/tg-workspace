"""Cut a Publication into Parts, and fix what Telegram's parser would mangle.

The only place cutting and formatting for a publish happen (SUMTAB-07). Every
send goes through `publish_summary_text`, which sends exactly these Parts: the
Summary tab, the scheduler and the free-text quick message alike.

**Rewrites, before cutting.** `parse_telegram_entities` reads `* **Label:**` as
an empty italic then an italic label, so the bullet and the bold both vanish; a
metadata label `*Time Range:*` arrives italic; and `@news_ir, @foo_bar` pairs
its underscores into an italic and drops them. So a line-start `* `/`- ` becomes
`• `, a single-asterisk label after a leading emoji or word becomes bold, and an
@handle containing `_` becomes a link whose text is the handle, which the parser
leaves alone.

**Cutting**, validated by the prototype on real Summaries: paragraphs on blank
lines; a piece too long for one Part split at lines, then sentence ends, then
whitespace, then hard; a heading glued to what follows it so no Part ends on
one; whole pieces packed greedily, each keeping the separator that joined it.
The limit is Telegram's, measured on the text **after** entity parsing in
UTF-16 units, because that is the text Telegram counts.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from app.services.network import TELEGRAM_MARKUP, parse_telegram_entities, utf16_len
from app.services.telegram_web import telegram_web_base_url

#: Telegram's `sendMessage` text limit, after entity parsing.
TELEGRAM_MESSAGE_LIMIT = 4096

PartKind = Literal["metadata", "summary"]


@dataclass(frozen=True)
class Part:
    kind: PartKind
    #: The markdown that goes through `parse_telegram_entities` on its way out.
    text: str
    #: UTF-16 length after entity parsing, the number Telegram holds to the limit.
    length: int
    #: The cut ending this Part fell inside a word or a formatting pair.
    cut_inside: bool


_BULLET = re.compile(r"^(\s*)[*-] ", re.MULTILINE)
_LABEL = re.compile(r"^(\S+ )\*([^*\s][^*\n]*:)\*(?!\*)", re.MULTILINE)
_HANDLE = re.compile(r"(^|[^\w/\[])@([A-Za-z0-9][A-Za-z0-9_]*_[A-Za-z0-9_]*)")
_HEADING = re.compile(r"^(\*\*[^*\n]+\*\*|#{1,6} .+)$")
#: Finer and finer places to cut, each keeping what it cut on as a separator.
_SPLITS = (
    re.compile(r"(\n+)"),
    re.compile(r"(?<=[.!?؟…])(\s+)"),
    re.compile(r"(\s+)"),
)


def format_for_telegram(text: str) -> str:
    """The three rewrites, so the parser sends what the author meant."""
    base = telegram_web_base_url()
    text = _BULLET.sub(r"\1• ", text)
    text = _LABEL.sub(r"\1**\2**", text)
    return _HANDLE.sub(lambda m: f"{m[1]}[@{m[2]}]({base}/{m[2]})", text)


def build_parts(text: str, metadata: str | None = None) -> list[Part]:
    """The Parts a publish sends, in order: the metadata's own, then the Summary's."""
    parts = _cut(format_for_telegram(metadata), "metadata") if metadata else []
    return parts + _cut(format_for_telegram(text), "summary")


@dataclass(frozen=True)
class _Unit:
    text: str
    sep: str


def _measure(text: str) -> int:
    return utf16_len(parse_telegram_entities(text)[0])


def _join(units: list[_Unit]) -> str:
    return units[0].text + "".join(u.sep + u.text for u in units[1:])


def _cut(text: str, kind: PartKind) -> list[Part]:
    paragraphs = [p for p in re.split(r"\n{2,}", text.strip()) if p.strip()]
    units = _glue_headings(
        [u for i, p in enumerate(paragraphs) for u in _fit(p, "\n\n" if i else "")]
    )
    groups = _pack(units)
    full = _join(units)
    parts: list[Part] = []
    end = 0
    for k, group in enumerate(groups):
        part_text = _join(group)
        end += (len(group[0].sep) if k else 0) + len(part_text)
        following = groups[k + 1][0] if k + 1 < len(groups) else None
        parts.append(
            Part(
                kind=kind,
                text=part_text,
                length=_measure(part_text),
                cut_inside=following is not None
                and (following.sep == "" or _inside_markup(full, end)),
            )
        )
    return parts


def _fit(text: str, sep: str, level: int = 0) -> list[_Unit]:
    if _measure(text) <= TELEGRAM_MESSAGE_LIMIT:
        return [_Unit(text, sep)]
    if level == len(_SPLITS):
        return _hard_cut(text, sep)
    bits = _SPLITS[level].split(text)
    pieces, seps = bits[0::2], [sep, *bits[1::2]]
    return [
        u
        for piece, s in zip(pieces, seps, strict=True)
        for u in _fit(piece, s, level + 1)
    ]


def _hard_cut(text: str, sep: str) -> list[_Unit]:
    """A single word longer than a Part: cut by UTF-16 units, the only cut inside a word."""
    chunks: list[str] = []
    start = size = 0
    for i, ch in enumerate(text):
        width = 2 if ord(ch) > 0xFFFF else 1
        if size + width > TELEGRAM_MESSAGE_LIMIT:
            chunks.append(text[start:i])
            start, size = i, 0
        size += width
    chunks.append(text[start:])
    return [_Unit(c, sep if k == 0 else "") for k, c in enumerate(chunks)]


def _glue_headings(units: list[_Unit]) -> list[_Unit]:
    """A unit ending in a heading line takes the next one with it, when both fit."""
    out: list[_Unit] = []
    for unit in units:
        prev = out[-1] if out else None
        if (
            prev is not None
            and _HEADING.match(prev.text.rsplit("\n", 1)[-1].strip())
            and _measure(prev.text + unit.sep + unit.text) <= TELEGRAM_MESSAGE_LIMIT
        ):
            out[-1] = _Unit(prev.text + unit.sep + unit.text, prev.sep)
        else:
            out.append(unit)
    return out


def _pack(units: list[_Unit]) -> list[list[_Unit]]:
    groups: list[list[_Unit]] = []
    for unit in units:
        if groups and _measure(_join([*groups[-1], unit])) <= TELEGRAM_MESSAGE_LIMIT:
            groups[-1].append(unit)
        else:
            groups.append([unit])
    return groups


def _inside_markup(text: str, at: int) -> bool:
    return any(m.start() < at < m.end() for m in TELEGRAM_MARKUP.finditer(text))
