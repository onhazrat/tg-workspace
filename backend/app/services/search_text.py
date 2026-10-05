"""Text as the Directory search index reads it (DIR-04, ADR-027).

A pure transform shared by the two sides of the search: the writer that builds
an entry's search document and the read that turns what an Account typed into a
query. Both must normalise the same way, or a word indexed one way is searched
for another and never found.

Postgres does the stemming; what it cannot do is done here first, as Discourse
does before `to_tsvector`:

* **Persian letters fold to their Arabic forms** (ی to ي, ک to ك), and tatweel
  and harakat go, so two spellings of one Persian word are one token.
* **The zero-width non-joiner becomes a space.** Persian writes compounds with
  it, and Postgres's parser keeps it inside the token, so کتاب‌های would never
  match کتاب.
* **Chinese and Japanese runs become overlapping character pairs.** Postgres
  has no word splitter for them, so a whole run is one token and a word inside
  it is unfindable; pairs need no dictionary (Elasticsearch's `cjk_bigram`).

Snippets are cut here too, from the original text, so the reader sees what the
Channel wrote rather than the folded copy the index holds.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

#: Languages Postgres stems; every other Language is indexed with `simple`.
STEMMED: dict[str, str] = {
    "ru": "russian",
    "en": "english",
    "de": "german",
    "ar": "arabic",
}
#: Every configuration a row can be indexed under. A query term is tried under
#: each, because the rows it should match were stemmed in different ways.
CONFIGS: tuple[str, ...] = ("simple", *STEMMED.values())

#: What the index holds per entry (ADR-027): the newest samples, capped.
SAMPLES_INDEXED = 8
SAMPLE_CHARS = 12_000
#: The last word typed matches as a prefix from this many characters.
PREFIX_FROM = 3

_FOLD = str.maketrans(
    {
        "ی": "ي",  # Persian yeh -> Arabic yeh
        "ى": "ي",  # alef maksura -> Arabic yeh
        "ک": "ك",  # keheh -> Arabic kaf
        "ۀ": "ه",  # heh with yeh above -> heh
        "‌": " ",  # zero-width non-joiner
        "ـ": None,  # tatweel
    }
)
#: Harakat and the superscript alef: marks, not letters.
_MARKS = re.compile("[ً-ٰٟ]")
#: Han, Hiragana and Katakana.
_CJK_CHAR = "぀-ヿ㐀-䶿一-鿿豈-﫿"
_CJK_RUN = re.compile(f"[{_CJK_CHAR}]+")
_WORD = re.compile(r"\w+")


def ts_config(language: str | None) -> str:
    """The text search configuration a row in `language` is indexed with."""
    return STEMMED.get(language or "", "simple")


def _fold(text: str) -> str:
    return _MARKS.sub("", text.translate(_FOLD)).lower()


def _pairs(run: str) -> str:
    if len(run) < 2:
        return run
    return " ".join(run[i : i + 2] for i in range(len(run) - 1))


def normalise(text: str) -> str:
    """`text` as both the index and the query see it."""
    return _CJK_RUN.sub(lambda m: f" {_pairs(m.group())} ", _fold(text))


# ---- The document ---------------------------------------------------------------


@dataclass(frozen=True)
class SearchDocument:
    """One entry's search document, normalised, by weight."""

    config: str
    #: Handle and display name (weight A); also what the typo match reads.
    names: str
    bio: str
    posts: str


def document(
    *,
    handle: str,
    display_name: str | None,
    bio: str | None,
    language: str | None,
    posts: list[str],
) -> SearchDocument:
    """The document for one entry. `posts` is the samples' words, newest first."""
    joined = "\n".join(posts[:SAMPLES_INDEXED])[:SAMPLE_CHARS]
    return SearchDocument(
        config=ts_config(language),
        names=" ".join(normalise(f"{handle} {display_name or ''}").split()),
        bio=normalise(bio or ""),
        posts=normalise(joined),
    )


# ---- The query --------------------------------------------------------------------


def query_terms(text: str) -> list[str]:
    """The words of what was typed, normalised; a CJK run is its pairs."""
    return _WORD.findall(normalise(text))


def term_operand(term: str, *, last: bool, weights: str) -> str:
    """One term as a `to_tsquery` operand: quoted, prefixed when last and long."""
    prefix = "*" if last and len(term) >= PREFIX_FROM else ""
    label = f":{prefix}{weights}" if prefix or weights else ""
    return "'" + term.replace("'", "''") + "'" + label


_LEXEME = re.compile(r"'((?:[^']|'')*)'")


def lexemes(tsquery: str) -> set[str]:
    """The lexemes a `tsquery`'s text form names."""
    return {m.group(1).replace("''", "'") for m in _LEXEME.finditer(tsquery)}


# ---- Snippets -----------------------------------------------------------------------

#: How much text a snippet keeps around its first match.
SNIPPET_BEFORE = 60
SNIPPET_LENGTH = 240


@dataclass(frozen=True)
class SnippetPart:
    text: str
    hit: bool


def _hits(text: str, stems: set[str]) -> list[tuple[int, int]]:
    """Character spans of `text` that a stem matches.

    A word is a hit when its normalised form starts with a stem, which is how a
    stemmed lexeme reads against the word it came from. In a CJK run the pairs
    the query named are marked where they occur.
    """
    pairs = {s for s in stems if _CJK_RUN.fullmatch(s)}
    words = stems - pairs
    spans: list[tuple[int, int]] = []
    for match in _WORD.finditer(text):
        word = match.group()
        for run in _CJK_RUN.finditer(word):
            for pair in pairs:
                start = run.group().find(pair)
                while start >= 0:
                    begin = match.start() + run.start() + start
                    spans.append((begin, begin + len(pair)))
                    start = run.group().find(pair, start + 1)
        folded = _fold(word)
        if any(folded.startswith(stem) for stem in words if stem):
            spans.append(match.span())
    return sorted(spans)


def snippet(text: str, stems: set[str]) -> list[SnippetPart] | None:
    """The part of `text` around its first match, matches marked; `None` if none."""
    spans = _hits(text, stems)
    if not spans:
        return None
    start = max(0, spans[0][0] - SNIPPET_BEFORE)
    end = min(len(text), start + SNIPPET_LENGTH)
    # Snap to whitespace so a word is never cut in half.
    if start > 0:
        space = text.rfind(" ", 0, start)
        start = space + 1 if space >= 0 else 0
    if end < len(text):
        space = text.find(" ", end)
        end = space if space >= 0 else len(text)
    parts: list[SnippetPart] = []
    if start > 0:
        parts.append(SnippetPart("…", False))
    cursor = start
    for begin, finish in spans:
        begin, finish = max(begin, cursor), min(finish, end)
        if begin >= finish:
            continue
        if begin > cursor:
            parts.append(SnippetPart(text[cursor:begin], False))
        parts.append(SnippetPart(text[begin:finish], True))
        cursor = finish
    if cursor < end:
        parts.append(SnippetPart(text[cursor:end], False))
    if end < len(text):
        parts.append(SnippetPart("…", False))
    return parts
