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
from datetime import UTC, datetime, tzinfo
from typing import Any, Literal, cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.schemas.scope import FrozenScope
from app.services.network import TELEGRAM_MARKUP, parse_telegram_entities, utf16_len
from app.services.telegram_web import telegram_channel_post_url, telegram_web_base_url

#: Telegram's `sendMessage` text limit, after entity parsing.
TELEGRAM_MESSAGE_LIMIT = 4096

PartKind = Literal["metadata", "summary"]

#: How a Citation reads once published (SUMTAB-08): `[chan #id]` as written,
#: `(chan, chan)` by Channel name, or `[1][2]` numbered. Every form links the Post.
CitationStyle = Literal["asWritten", "channelName", "numbered"]
CITATION_STYLES: tuple[CitationStyle, ...] = ("asWritten", "channelName", "numbered")


@dataclass(frozen=True)
class PublishingSettings:
    """The Account's `publishing` settings row, a default for anything unusable."""

    citation_style: CitationStyle = "asWritten"
    link_previews: bool = False
    #: An IANA zone name; empty until the browser fills it the first time.
    time_zone: str = ""

    @classmethod
    def from_stored(cls, value: dict[str, Any]) -> PublishingSettings:
        style = value.get("citationStyle")
        zone = value.get("timeZone")
        return cls(
            citation_style=cast(CitationStyle, style)
            if style in CITATION_STYLES
            else "asWritten",
            link_previews=value.get("linkPreviews") is True,
            time_zone=zone if isinstance(zone, str) else "",
        )


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


def build_parts(
    text: str,
    metadata: str | None = None,
    *,
    citation_style: CitationStyle = "asWritten",
) -> list[Part]:
    """The Parts a publish sends, in order: the metadata's own, then the Summary's.

    Numbered Citations share one numbering, counted from the metadata into the
    prose, so `[3]` means one Post wherever it appears.
    """
    numbers: dict[tuple[str, int], int] = {}

    def prepare(t: str) -> str:
        return _cite(format_for_telegram(t), citation_style, numbers)

    parts = _cut(prepare(metadata), "metadata") if metadata else []
    return parts + _cut(prepare(text), "summary")


def default_metadata(
    *, scope: FrozenScope | None, model: str, post_count: int, time_zone: str
) -> str:
    """The generated metadata block, the only generator of it (SUMTAB-08).

    The window is written in the Account's zone and names it, so readers know
    which moment it was; an empty or unknown zone is UTC. A Summary with no
    frozen Scope says "not recorded" rather than reporting the epoch (AW-07).
    """
    channels = list(scope.channels) if scope else []
    time_range = _time_range(scope.start, scope.end, time_zone) if scope else None
    return (
        f"📊 *Analysis Metadata*\n"
        f"🕒 *Time Range:* {time_range or 'not recorded'}\n"
        f"📡 *Channels Used:* {len(channels)}\n"
        f"📋 *Channel List:* {', '.join(f'@{c}' for c in channels)}\n"
        f"🤖 *AI Model:* {model}\n"
        f"📝 *Posts Analyzed:* {post_count}"
    )


def _time_range(start_ms: int, end_ms: int, time_zone: str) -> str:
    """`Oct 7, 2026, 9:27 AM – 12:27 PM (Asia/Tehran, GMT+3:30) · 3h`."""
    zone: tzinfo
    try:
        zone, name = ZoneInfo(time_zone), time_zone
    except ValueError, ZoneInfoNotFoundError:
        zone, name = UTC, "UTC"
    start = datetime.fromtimestamp(start_ms / 1000, zone)
    end = datetime.fromtimestamp(end_ms / 1000, zone)
    shown_end = _clock(end) if end.date() == start.date() else _moment(end)
    return (
        f"{_moment(start)} – {shown_end} ({name}, {_gmt(start)})"
        f" · {_duration(end_ms - start_ms)}"
    )


def _moment(dt: datetime) -> str:
    return f"{dt:%b} {dt.day}, {dt.year}, {_clock(dt)}"


def _clock(dt: datetime) -> str:
    return f"{dt.hour % 12 or 12}:{dt:%M} {'AM' if dt.hour < 12 else 'PM'}"


def _gmt(dt: datetime) -> str:
    offset = dt.utcoffset()
    minutes = int(offset.total_seconds()) // 60 if offset else 0
    if not minutes:
        return "GMT"
    h, m = divmod(abs(minutes), 60)
    return f"GMT{'+' if minutes > 0 else '-'}{h}" + (f":{m:02d}" if m else "")


def _duration(ms: int) -> str:
    days, rest = divmod(round(ms / 60_000), 24 * 60)
    hours, minutes = divmod(rest, 60)
    units = ((days, "d"), (hours, "h"), (minutes, "m"))
    return " ".join(f"{n}{u}" for n, u in units if n) or "0m"


#: The parser's own Citation pattern, so a restyled one is what it would link.
_CITATION = re.compile(r"\[([a-zA-Z0-9_]+)\s+#(\d+)\]")
#: Citations side by side, separated by nothing but spaces or commas.
_CITATION_RUN = re.compile(rf"{_CITATION.pattern}(?:[ ,]*{_CITATION.pattern})*")


def _cite(text: str, style: CitationStyle, numbers: dict[tuple[str, int], int]) -> str:
    if style == "numbered":

        def number(m: re.Match[str]) -> str:
            post = (m[1], int(m[2]))
            n = numbers.setdefault(post, len(numbers) + 1)
            return f"[[{n}]]({telegram_channel_post_url(*post)})"

        return _CITATION.sub(number, text)
    if style == "channelName":

        def names(m: re.Match[str]) -> str:
            links = (
                f"[{c}]({telegram_channel_post_url(c, int(i))})"
                for c, i in _CITATION.findall(m[0])
            )
            return f"({', '.join(links)})"

        return _CITATION_RUN.sub(names, text)
    return text


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
