"""Bot credentials and chat destination CRUD (extracted from data routes)."""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.secrets import encrypt_token, is_encrypted
from app.models_tg import BotCredential, ChatDestination, utc_now
from app.services.serialization import bot_to_camel, chat_dest_to_camel, normalize_body
from app.services.sync_meta import touch_sync
from app.services.tenancy import assert_owner_on_write, scoped_select

#: The 404 each family answers for a row that is not there. Named rather
#: than repeated so the owner checks below refuse a foreign row with the
#: identical string — a distinguishable refusal moves the enumeration oracle
#: into the body, which is the argument `assert_owner` makes at length.
BOT_CREDENTIAL_NOT_FOUND = "Bot credential not found"
CHAT_DESTINATION_NOT_FOUND = "Chat destination not found"


def encrypt_bot_token(token: str) -> str:
    if not token:
        return ""
    if is_encrypted(token):
        return token
    return encrypt_token(token)


def list_bot_credentials(
    session: Session, *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Return the credentials `user_id` may see.

    This was a bare `select(BotCredential)` until ticket 32, while every write
    on the same family had passed a `user_id` since ticket 31 — one family
    answering two different questions about whose rows these are depending on
    the verb.

    **What leaked was the id, not the token.** `bot_to_camel` returns
    `hasToken`, never `token_encrypted`, so be precise about the harm: this list
    handed every account the other accounts' credential ids, names and bot
    usernames. The ids are the part that matters, because they are
    client-chosen through `PUT /data/bot-credentials/{bot_id}` and the
    auto-publish path in `jobs/auto_summary.py` resolves `publishBotId` by id
    with **no owner check at all** — so it will decrypt and send as another
    account's bot. Scoping this read takes those ids out of the UI; it does not
    take them out of reach, and overstating it here would point the next reader
    away from the door that is still open.

    `user_id` has no default for the reason `scoped_select` takes none: this
    function took `(session)` alone, so an optional owner would leave every
    existing caller passing nothing and still passing tests.
    """
    statement = scoped_select(select(BotCredential), BotCredential, user_id)
    return [bot_to_camel(b) for b in session.exec(statement).all()]


def upsert_bot_credential(
    session: Session,
    bot_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Create a credential, or merge into the caller's existing one.

    `user_id` was only the stamp on a new row; ticket 31 makes it the authority
    as well, so it is required rather than optional — "no caller" has no answer
    to whether an existing row may be rewritten. The only caller is the route,
    which has always had a real one.
    """
    normalized = normalize_body(body)
    token = normalized.get("token_encrypted") or normalized.get("token", "")
    encrypted = encrypt_bot_token(token) if token else ""
    bot = session.get(BotCredential, bot_id)
    if bot:
        assert_owner_on_write(bot.user_id, user_id, detail=BOT_CREDENTIAL_NOT_FOUND)
        bot.name = normalized.get("name", bot.name)
        if encrypted:
            bot.token_encrypted = encrypted
        bot.username = normalized.get("username", bot.username)
        bot.photo_url = normalized.get("photo_url", bot.photo_url)
        bot.last_validated = normalized.get("last_validated", bot.last_validated)
        bot.updated_at = utc_now()
    else:
        if not encrypted:
            raise HTTPException(
                status_code=400, detail="token is required for new bot credentials"
            )
        bot = BotCredential(
            id=bot_id,
            user_id=user_id,
            name=normalized.get("name", bot_id),
            token_encrypted=encrypted,
            username=normalized.get("username"),
            photo_url=normalized.get("photo_url"),
            last_validated=normalized.get("last_validated"),
        )
    session.add(bot)
    session.commit()
    session.refresh(bot)
    touch_sync(session, "bot_credentials")
    return bot_to_camel(bot)


def delete_bot_credential(
    session: Session, bot_id: str, *, user_id: uuid.UUID
) -> dict[str, str]:
    bot = session.get(BotCredential, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail=BOT_CREDENTIAL_NOT_FOUND)
    assert_owner_on_write(bot.user_id, user_id, detail=BOT_CREDENTIAL_NOT_FOUND)
    session.delete(bot)
    session.commit()
    touch_sync(session, "bot_credentials")
    return {"status": "deleted"}


def migrate_bot_credentials(
    session: Session, body: list[dict[str, Any]], *, user_id: uuid.UUID
) -> dict[str, Any]:
    """Bulk-import exported credentials, re-encrypting their tokens.

    An import by another name, and covered by ticket 31 for that reason: a list
    of exported rows merged by id, exactly as `_import_bot_credentials` does it,
    and unlike `POST /data/import` this door is not even Admin-gated. Closing
    one and leaving the other open is the "reaches the same tables by a
    different door" mistake ticket 31 exists to correct.

    `user_id` is required rather than optional. It was `uuid.UUID | None` while
    it was only a stamp on new rows; now that it decides whether an existing row
    may be rewritten, "no caller" has no answer, and inventing one is the NULL
    fallback the settings carve dissolved.
    """
    migrated: list[str] = []
    for item in body:
        normalized = normalize_body(item)
        bid = normalized.get("id", item.get("id"))
        if not bid:
            continue
        token = normalized.get("token_encrypted") or normalized.get("token", "")
        if not token:
            continue
        encrypted = encrypt_bot_token(token)
        bot = session.get(BotCredential, bid)
        if bot:
            assert_owner_on_write(bot.user_id, user_id, detail=BOT_CREDENTIAL_NOT_FOUND)
            bot.name = normalized.get("name", bot.name)
            bot.token_encrypted = encrypted
            bot.username = normalized.get("username", bot.username)
            bot.photo_url = normalized.get("photo_url", bot.photo_url)
            bot.last_validated = normalized.get("last_validated", bot.last_validated)
            bot.updated_at = utc_now()
        else:
            bot = BotCredential(
                id=bid,
                user_id=user_id,
                name=normalized.get("name", bid),
                token_encrypted=encrypted,
                username=normalized.get("username"),
                photo_url=normalized.get("photo_url"),
                last_validated=normalized.get("last_validated"),
            )
        session.add(bot)
        migrated.append(bid)
    session.commit()
    touch_sync(session, "bot_credentials")
    return {"migrated": len(migrated), "ids": migrated}


def list_chat_destinations(
    session: Session, *, user_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Return the destinations `user_id` may see.

    Same adoption as `list_bot_credentials`, and it belongs in the same change
    for the twin-module reason: these two are the same list twice over, and a
    fix applied to one of a pair is half a fix.
    """
    statement = scoped_select(select(ChatDestination), ChatDestination, user_id)
    return [chat_dest_to_camel(d) for d in session.exec(statement).all()]


def upsert_chat_destination(
    session: Session,
    dest_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """Create a destination, or merge into the caller's existing one.

    Same required `user_id` as `upsert_bot_credential`, for the same reason.
    """
    normalized = normalize_body(body)
    dest = session.get(ChatDestination, dest_id)
    if dest:
        assert_owner_on_write(dest.user_id, user_id, detail=CHAT_DESTINATION_NOT_FOUND)
        dest.name = normalized.get("name", dest.name)
        dest.chat_id = normalized.get("chat_id", dest.chat_id)
        dest.updated_at = utc_now()
    else:
        dest = ChatDestination(
            id=dest_id,
            user_id=user_id,
            name=normalized.get("name", dest_id),
            chat_id=normalized.get("chat_id", ""),
        )
    session.add(dest)
    session.commit()
    session.refresh(dest)
    touch_sync(session, "chat_destinations")
    return chat_dest_to_camel(dest)


def delete_chat_destination(
    session: Session, dest_id: str, *, user_id: uuid.UUID
) -> dict[str, str]:
    dest = session.get(ChatDestination, dest_id)
    if not dest:
        raise HTTPException(status_code=404, detail=CHAT_DESTINATION_NOT_FOUND)
    assert_owner_on_write(dest.user_id, user_id, detail=CHAT_DESTINATION_NOT_FOUND)
    session.delete(dest)
    session.commit()
    touch_sync(session, "chat_destinations")
    return {"status": "deleted"}
