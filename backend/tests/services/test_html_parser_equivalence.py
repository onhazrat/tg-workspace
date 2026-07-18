"""Guard the lxml tree builder against the stdlib parser.

scraper.make_soup uses lxml for speed. These tests pin the property that
justified the switch: for well-formed and for truncated-but-complete post
markup, lxml and html.parser produce identical parse output.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from bs4 import BeautifulSoup

from app.services.scraper import (
    HTML_PARSER,
    _parse_channel_meta,
    _parse_posts_from_html,
)

FIXTURES = Path(__file__).parent.parent / "fixtures" / "live"
LIVE_HTML = sorted(p for p in FIXTURES.glob("*.html") if p.stat().st_size > 0)


def _parse(html: str, parser: str) -> tuple[list[dict], str | None, dict]:
    posts, next_url = _parse_posts_from_html(BeautifulSoup(html, parser), 0, set())
    meta = _parse_channel_meta(BeautifulSoup(html, parser), "testchan")
    return posts, next_url, meta


def test_lxml_is_the_active_parser() -> None:
    """lxml should be installed; a silent fallback would erase the speedup."""
    assert HTML_PARSER == "lxml"


@pytest.mark.skipif(not LIVE_HTML, reason="no live fixtures available")
@pytest.mark.parametrize("fixture", LIVE_HTML, ids=lambda p: p.name)
def test_parsers_agree_on_live_fixture(fixture: Path) -> None:
    html = fixture.read_text(encoding="utf-8", errors="replace")
    assert _parse(html, "html.parser") == _parse(html, "lxml")


@pytest.mark.skipif(not LIVE_HTML, reason="no live fixtures available")
@pytest.mark.parametrize("cut_pct", [10, 25, 50, 75, 90])
def test_parsers_agree_on_completed_posts_when_truncated(cut_pct: int) -> None:
    """A dropped connection truncates the response mid-element.

    The post severed by the cut may parse differently — neither parser can
    be authoritative on half an element — but every post that arrived whole
    must be identical.
    """
    html = (FIXTURES / "durov_522.html").read_text(encoding="utf-8")
    truncated = html[: len(html) * cut_pct // 100]

    posts_std, _, _ = _parse(truncated, "html.parser")
    posts_lxml, _, _ = _parse(truncated, "lxml")

    by_id_std = {p["id"]: p for p in posts_std}
    by_id_lxml = {p["id"]: p for p in posts_lxml}
    shared = set(by_id_std) & set(by_id_lxml)
    # The highest shared id is the one the cut may have landed inside.
    boundary = max(shared) if shared else None

    for post_id in sorted(shared - {boundary}):
        assert by_id_std[post_id] == by_id_lxml[post_id], (
            f"fully-received post {post_id} parsed differently at {cut_pct}% truncation"
        )
