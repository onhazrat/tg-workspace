"""Publish summary text to Telegram using encrypted bot credentials."""

from __future__ import annotations

import uuid
from typing import Any

from sqlmodel import Session

from app.core.config import settings
from app.core.secrets import decrypt_token
from app.models_tg import BotCredential
from app.services.credentials import BOT_CREDENTIAL_NOT_FOUND
from app.services.network import fetch_with_retry, parse_telegram_entities
from app.services.tenancy import may_act_on


async def publish_summary_text(
    session: Session,
    *,
    acting_user_id: uuid.UUID | None,
    credential_id: str,
    chat_id: str,
    text: str,
    metadata_text: str | None = None,
    proxies: list[str] | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int = 10,
) -> dict[str, Any]:
    """Send `text` as the bot `credential_id` names, on behalf of one account.

    `acting_user_id` is whose send this is — the Summary's owner on the
    scheduled path, which has no `current_user` to ask. It has no default on
    purpose (ticket 32's lesson): an optional actor leaves every existing call
    site passing nothing and still passing its tests, which is a check that
    exists and is never applied.

    **The ownership check is here rather than only in `_auto_publish`** because
    this is the function that decrypts the token, and guarding the caller leaves
    the next caller unguarded — the shape of the two auth gates that disagreed
    about `/password-recovery` for months, and of the nine by-id writes ticket
    31 found still open after the import door was closed. It refuses before
    `decrypt_token`, not after: a refusal that arrives once the plaintext exists
    has already produced the thing the encryption is for.

    Ungated for a credential that names an owner, whichever way the tenancy flag
    points. Sending a message and decrypting a token are writes by ticket 31's
    measure, and a flag that defers *visibility* has no business deferring them
    — gated off, the scheduler goes on publishing as somebody else's bot until
    ticket 21 flips it.

    **A credential with no owner at all is the exception, and it is a real row**
    — an upgraded deployment's original operator bot carries `user_id IS NULL`.
    `may_act_on` lets any actor use it while the flag is off, because refusing
    would stop the only account a single-operator install has from publishing at
    all. So "the scheduler stops sending as another account's bot" holds for
    stamped rows today and for every row once ticket 21's backfill has run;
    saying otherwise here would be the one sentence a reader of this function
    trusts and should not.
    """
    bot = session.get(BotCredential, credential_id)
    if not bot or not may_act_on(owner_id=bot.user_id, user_id=acting_user_id):
        # The family's own string for an absent row, reused so a foreign
        # credential is indistinguishable from one that is not there. This path
        # has no status code, so the message is the whole of the answer, and
        # credential ids are client-chosen — a refusal that reads differently
        # is a working oracle for guessing them.
        raise ValueError(BOT_CREDENTIAL_NOT_FOUND)

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
            retries=settings.TELEGRAM_API_RETRIES,
            initial_delay_ms=settings.TELEGRAM_API_INITIAL_DELAY_MS,
            proxies=proxies or None,
            proxy_concurrency=proxy_concurrency,
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
