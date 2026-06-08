from pathlib import Path

from app.services.scraper import _parse_posts_from_html

FIXTURE = Path(__file__).parent.parent / "fixtures" / "sample_channel.html"


def test_parse_posts_from_html_fixture() -> None:
    html = FIXTURE.read_text()
    seen: set[int] = set()
    posts, next_url = _parse_posts_from_html(html, start_id=100, seen=seen)
    assert len(posts) >= 2
    assert posts[0]["id"] == 100
    assert "Hello" in posts[0]["text"]
    assert posts[1]["id"] == 101
    assert posts[1].get("forwardedFromName") == "Source Channel"
