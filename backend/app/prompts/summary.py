from app.prompts.templates import SYSTEM_PROMPT

RTL_LANGUAGES = {"Persian", "Arabic", "فارسی", "العربية"}


def rtl_instruction(language: str) -> str:
    if language in RTL_LANGUAGES:
        return (
            "IMPORTANT: Since this is a Right-to-Left (RTL) language, ensure the entire "
            "summary is formatted correctly for RTL reading."
        )
    return ""


def format_summary_prompt(
    *,
    channels: list[str],
    channels_text: str | None = None,
    language: str,
    posts_text: str,
) -> str:
    rendered_channels = (channels_text or "").strip() or ", ".join(channels)
    return SYSTEM_PROMPT.format(
        channels=rendered_channels,
        language=language,
        rtl_instruction=rtl_instruction(language),
        posts_text=posts_text,
    )
