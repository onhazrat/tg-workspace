from app.prompts.summary import format_summary_prompt
from app.prompts.tagging import format_tag_prompt


def test_format_summary_prompt_uses_channels_text_when_present() -> None:
    prompt = format_summary_prompt(
        channels=["legacy_name"],
        channels_text="### rich_channel\nBio: sample",
        language="English",
        posts_text="- post",
    )
    assert "### rich_channel" in prompt
    assert "legacy_name" not in prompt


def test_format_tag_prompt_applies_add_defaults() -> None:
    prompt = format_tag_prompt(
        channels=["chan_a"],
        channels_text=None,
        posts_text="- post",
        all_tags="Politics",
        tag_mode="add",
    )
    assert "between 2 and 4 tags per channel" in prompt
    assert "Politics" in prompt


def test_format_tag_prompt_applies_remove_defaults() -> None:
    prompt = format_tag_prompt(
        channels=["chan_a"],
        channels_text=None,
        posts_text="- post",
        all_tags="Politics",
        tag_mode="remove",
    )
    assert "between 0 and 3 tags per channel" in prompt
