"""Bot credentials and chat destination CRUD (extracted from data routes)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.secrets import encrypt_token, is_encrypted
from app.models_tg import BotCredential, ChatDestination
from app.services.serialization import bot_to_camel, chat_dest_to_camel, normalize_body
from app.services.sync_meta import touch_sync


def encrypt_bot_token(token: str) -> str:
    if not token:
        return ""
    if is_encrypted(token):
        return token
    return encrypt_token(token)


def list_bot_credentials(session: Session) -> list[dict[str, Any]]:
    return [bot_to_camel(b) for b in session.exec(select(BotCredential)).all()]


def upsert_bot_credential(
    session: Session,
    bot_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    normalized = normalize_body(body)
    token = normalized.get("token_encrypted") or normalized.get("token", "")
    encrypted = encrypt_bot_token(token) if token else ""
    bot = session.get(BotCredential, bot_id)
    if bot:
        bot.name = normalized.get("name", bot.name)
        if encrypted:
            bot.token_encrypted = encrypted
        bot.username = normalized.get("username", bot.username)
        bot.photo_url = normalized.get("photo_url", bot.photo_url)
        bot.last_validated = normalized.get("last_validated", bot.last_validated)
        bot.updated_at = datetime.utcnow()
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


def delete_bot_credential(session: Session, bot_id: str) -> dict[str, str]:
    bot = session.get(BotCredential, bot_id)
    if not bot:
        raise HTTPException(status_code=404, detail="Bot credential not found")
    session.delete(bot)
    session.commit()
    touch_sync(session, "bot_credentials")
    return {"status": "deleted"}


def migrate_bot_credentials(
    session: Session, body: list[dict[str, Any]], *, user_id: uuid.UUID | None
) -> dict[str, Any]:
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
            bot.name = normalized.get("name", bot.name)
            bot.token_encrypted = encrypted
            bot.username = normalized.get("username", bot.username)
            bot.photo_url = normalized.get("photo_url", bot.photo_url)
            bot.last_validated = normalized.get("last_validated", bot.last_validated)
            bot.updated_at = datetime.utcnow()
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


def list_chat_destinations(session: Session) -> list[dict[str, Any]]:
    return [chat_dest_to_camel(d) for d in session.exec(select(ChatDestination)).all()]


def upsert_chat_destination(
    session: Session,
    dest_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID | None,
) -> dict[str, Any]:
    normalized = normalize_body(body)
    dest = session.get(ChatDestination, dest_id)
    if dest:
        dest.name = normalized.get("name", dest.name)
        dest.chat_id = normalized.get("chat_id", dest.chat_id)
        dest.updated_at = datetime.utcnow()
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


def delete_chat_destination(session: Session, dest_id: str) -> dict[str, str]:
    dest = session.get(ChatDestination, dest_id)
    if not dest:
        raise HTTPException(status_code=404, detail="Chat destination not found")
    session.delete(dest)
    session.commit()
    touch_sync(session, "chat_destinations")
    return {"status": "deleted"}
