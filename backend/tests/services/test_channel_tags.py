from app.services.channel_tags import get_tag_names, normalize_channel_tags


def test_normalize_channel_tags_supports_legacy_strings() -> None:
    assert normalize_channel_tags(["Tech"]) == [
        {"name": "Tech", "source": "manual", "assignedAt": 0}
    ]


def test_normalize_channel_tags_supports_structured_entries() -> None:
    assert normalize_channel_tags(
        [
            {"name": "Tech", "source": "ai", "assignedAt": 9},
            {"name": "tech", "source": "manual", "assignedAt": 2},
        ]
    ) == [{"name": "Tech", "source": "ai", "assignedAt": 9}]


def test_get_tag_names_returns_plain_names() -> None:
    assert get_tag_names(["one", {"name": "two", "source": "ai", "assignedAt": 1}]) == [
        "one",
        "two",
    ]
