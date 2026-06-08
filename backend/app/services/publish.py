"""Publish summary text to Telegram using encrypted bot credentials."""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.core.secrets import decrypt_token
from app.models_tg import BotCredential
from app.services.network import fetch_with_retry, parse_telegram_entities


async def publish_summary_text(
    session: Session,
    *,
    credential_id: str,
    chat_id: str,
    text: str,
    metadata_text: str | None = None,
    proxies: list[str] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
) -> dict[str, Any]:
    bot = session.get(BotCredential, credential_id)
    if not bot:
        raise ValueError("Bot credential not found")

    token = decrypt_token(bot.token_encrypted)
    target = f"https://api.telegram.org/bot{token}/sendMessage"
    results: list[Any] = []
    telemetry_logs: list[Any] = []

    async def send_chunk(chunk: str) -> None:
        parsed_text, entities = parse_telegram_entities(chunk)
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": parsed_text,
        }
        if entities:
            payload["entities"] = entities
        data, telem = await fetch_with_retry(
            target,
            retries=3,
            initial_delay_ms=2000,
            proxies=proxies or None,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            method="POST",
            json_body=payload,
        )
        if isinstance(data, str):
            import json

            data = json.loads(data)
        results.append(data)
        telemetry_logs.append(telem)

    if metadata_text:
        for i in range(0, len(metadata_text), 4000):
            await send_chunk(metadata_text[i : i + 4000])
    for i in range(0, len(text), 4000):
        await send_chunk(text[i : i + 4000])

    return {"success": True, "results": results, "telemetry": telemetry_logs}
