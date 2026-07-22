"""`format_posts_for_prompt` must stay byte-identical to the frontend.

The golden string here is the same one asserted in the frontend unit test
(`frontend/src/lib/posts/post-view.test.ts` — "formatPostsForPrompt is
byte-identical to the golden reference"). If one side changes, both fail.
"""

from __future__ import annotations

from app.prompts.posts import estimate_tokens, format_posts_for_prompt


def test_matches_frontend_golden_reference() -> None:
    posts = [
        {
            "channelName": "alpha",
            "id": 1,
            "date": "2024-01-01T00:00:00.000Z",
            "text": "First post body",
        },
        {
            "channelName": "durov",
            "id": 522,
            "date": "2024-01-01T00:00:00.000Z",
            "text": "[photo]",
            "media": {
                "kinds": ["photo"],
                "views": "2.23M",
                "isMediaOnly": True,
                "thumbApiPath": "/api/v1/telegram/post-thumb/durov/522",
            },
        },
    ]
    expected = "\n".join(
        [
            "[alpha] ID: 1",
            "Date: 2024-01-01T00:00:00.000Z",
            "Content: First post body",
            "",
            "---",
            "",
            "[durov] ID: 522",
            "Date: 2024-01-01T00:00:00.000Z",
            "Media: photo | Views: 2.23M",
            "Content: [photo]",
        ]
    )
    assert format_posts_for_prompt(posts) == expected


def test_media_hints_full_line() -> None:
    posts = [
        {
            "channelName": "c",
            "id": 5,
            "date": "d",
            "text": "Album caption",
            "media": {
                "kinds": ["photo", "grouped"],
                "durationSec": 83,
                "groupedCount": 4,
                "linkPreview": {
                    "title": "Example",
                    "description": "Summary text",
                    "siteName": "example.com",
                },
            },
        }
    ]
    text = format_posts_for_prompt(posts)
    assert (
        "Media: photo, grouped | Duration: 1:23 | Album: 4 items"
        " | Link preview: Example — Summary text (example.com)" in text
    )


def test_no_media_omits_hint_line() -> None:
    posts = [{"channelName": "c", "id": 1, "date": "d", "text": "plain"}]
    assert format_posts_for_prompt(posts) == "[c] ID: 1\nDate: d\nContent: plain"


def test_empty_posts_is_empty_string() -> None:
    assert format_posts_for_prompt([]) == ""


def test_estimate_tokens_is_chars_over_four() -> None:
    assert estimate_tokens("x" * 40) == 10
