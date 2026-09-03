"""Export and import of a whole account, or of the whole deployment.

## Whose rows a document is about (tickets 31 and 28)

**One subject per request, and it is the request that names it.** Ticket 31 made
an import per-account: a row that already belongs to somebody else is refused
with that family's own 404, whichever way the tenancy flag points — see
`tenancy.assert_owner_on_write`, which is where that exception is argued.
`IMPORT_WRITES` below is the inventory: every table this module writes is either
checked or excused, with the reason written next to it.

Ticket 31 recorded a second design it did *not* take — let an Admin write across
accounts, since a restore that cannot restore is not a restore — and left the
decision for ticket 28 to re-take rather than inherit, because ticket 31's own
reason was that **an import could not express another account's ownership in the
first place**: every importer stamped the *caller's* id, and an export document
carries no owner at all.

**Ticket 28 re-takes it, and the reason it can is that the subject moved into
the request.** `GET /data/export?subject=X` and `POST /data/import?subject=X`
name an account, so a restore no longer has to guess: new rows are stamped with
the subject, which is the caller unless an Admin said otherwise. Nothing else
about ticket 31's rule moves — a row owned by a *third* account is still refused
with that family's 404, the document still names no owner anywhere, and the
default subject is still the caller. What changed is that "the Admin who ran the
restore" stopped being the only expressible answer.

An Admin importing for somebody else is a write on another person's behalf, and
ticket 27 already says what that must record: the route binds an `ActingOwner`
so every artifact restored carries the Admin in `acted_by_*` and shows it in
that account's History. A restore that silently claimed the User wrote the file
is the lie that column exists to stop.

The route's `Permission.DATA_ADMIN` gate (ticket 18) is not this answer. It
decides who may call import; it says nothing about whose rows the call lands on,
and an Admin restoring their own backup onto an id that has since been reused
cannot tell. Capability is not intent.

## What an export carries

`export_sections` is the document, in order, and the streamer, the pre-count and
the coverage guard all walk it. `EXPORT_OMISSIONS` is the other half: a table
`tenancy.SCOPES` classifies that a backup deliberately does not carry, with the
reason beside it.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any
from typing import cast as typing_cast

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func
from sqlmodel import Session, col, select

from app.core import acting_owner
from app.models_tg import (
    BotCredential,
    Channel,
    ChannelSettingGroup,
    ChatDestination,
    ChatSession,
    ChatSessionPayload,
    DiscoverReport,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    Summary,
    SummaryPayload,
    SyncLog,
    SyncLogPayload,
    TagRun,
    UserSetting,
    utc_now,
)
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
    load_groups_by_id,
    setting_group_to_camel,
)
from app.services.channels import SERVER_MANAGED_CHANNEL_FIELDS, apply_channel_fields
from app.services.chat_sessions import (
    CHAT_SESSION_NOT_FOUND,
    apply_chat_session_payload,
    chat_session_to_camel,
    refresh_chat_session_derived_columns,
)
from app.services.chat_sessions import PAYLOAD_COLUMNS as CHAT_PAYLOAD_COLUMNS
from app.services.credentials import (
    BOT_CREDENTIAL_NOT_FOUND,
    CHAT_DESTINATION_NOT_FOUND,
    encrypt_bot_token,
)
from app.services.discover_reports import (
    REPORT_NOT_FOUND,
    report_export_to_camel,
)
from app.services.follows import (
    ensure_follow_for_channel,
    follow_values_from_body,
    follows_for_user,
    get_follow,
    sync_follow_settings,
)
from app.services.logs import (
    LOG_MODELS,
    upsert_embedding_log,
    upsert_llm_log,
    upsert_network_log,
    upsert_publish_log,
    upsert_sync_log,
)
from app.services.posts import bulk_upsert_posts_impl
from app.services.serialization import (
    bot_to_camel,
    channel_to_camel,
    chat_dest_to_camel,
    embedding_log_to_camel,
    embedding_to_camel,
    llm_log_to_camel,
    network_log_to_camel,
    normalize_body,
    post_to_camel,
    publish_log_to_camel,
    sync_log_to_camel,
    to_snake,
    translation_to_camel,
)
from app.services.settings_registry import Home, home_for
from app.services.summaries import (
    HEAVY_SUMMARY_FIELDS,
    PAYLOAD_COLUMNS,
    SUMMARY_NOT_FOUND,
    apply_summary_payload,
    refresh_summary_derived_columns,
    summary_to_camel,
)
from app.services.sync_meta import touch_sync
from app.services.tag_runs import TAG_RUN_NOT_FOUND, tag_run_to_camel
from app.services.tenancy import (
    Scope,
    assert_owner_on_write,
    may_act_on,
    scope_of,
    subject_select,
    unscoped_select,
)
from app.services.user_settings import user_setting_to_camel, write_user_setting

logger = logging.getLogger(__name__)

#: Every table an import writes, and how ticket 31 answers for it. A section
#: added without an entry fails `test_every_import_write_is_covered_or_excused`,
#: which is the only moment when "whose rows are these?" is cheap to ask — the
#: same argument `tenancy.SCOPES` makes about the schema as a whole.
#:
#: The excused entries are not leftovers. Four of them are shared corpus the
#: seam already classifies as follow-scoped, one is a child guarded by its
#: parent, and two are log families that no account owns — an owner check over
#: those would refuse rows nobody could ever have owned, which is the failure
#: that looks most like the fix working.
IMPORT_WRITES: dict[type[Any], str] = {
    Summary: "Checked: user-owned artifact, refused with `Summary not found`.",
    BotCredential: (
        "Checked: user-owned, and the row carries a bot token. The clobber here "
        "rewrote another account's credential and took the row with it."
    ),
    ChatDestination: "Checked: user-owned, refused with `Chat destination not found`.",
    PublishLog: "Checked: personal log, refused with `publish log not found`.",
    LLMLog: "Checked: personal log, refused with `llm log not found`.",
    EmbeddingLog: "Checked: personal log, refused with `embedding log not found`.",
    SummaryPayload: (
        "Excused: written only through `apply_summary_payload` for a summary "
        "this module has already checked. Guarding the child as well would ask "
        "the same question twice and answer it from a row whose owner is a copy "
        "of its parent's."
    ),
    SyncLog: (
        "Excused: Channel telemetry (ticket 19). `upsert_sync_log` is handed a "
        "`user_id` and deliberately does not write it, so every row has a NULL "
        "owner as a matter of course and there is nothing to compare. The API "
        "door checks the *Follow* instead, and that check is create-only — "
        "which an import cannot adopt, because a restore has to be idempotent."
    ),
    SyncLogPayload: "Excused: takes its parent's scope, as `SummaryPayload` does.",
    NetworkLog: (
        "Checked, matching `create_logs`: reads of this family are Admin-only "
        "because it records proxy behaviour, but a write landing on an existing "
        "row is an overwrite either way. Ticket 20's retention sweep declines "
        "to treat the stamp as ownership for its own reason — nothing else "
        "would ever collect an ownerless row — and that is a different question "
        "from who may flatten one."
    ),
    Channel: (
        "Excused: follow-scoped. One scrape serves every follower, and this "
        "path writes the caller's Follow alongside it (ticket 04)."
    ),
    Post: "Excused: follow-scoped corpus, unique per `(channel_name, post_id)`.",
    PostEmbedding: "Excused: follow-scoped corpus, keyed to the Post.",
    PostTranslation: "Excused: follow-scoped corpus, keyed to the Post.",
    ChatSession: (
        "Checked: user-owned artifact, refused with `Chat session not found`. "
        "Ticket 28 put it on the export, and an exported family with no owner "
        "check on the way back is the hole ticket 31 closed for summaries."
    ),
    TagRun: "Checked: user-owned artifact, refused with `Tag run not found`.",
    DiscoverReport: "Checked: user-owned artifact, refused with `report not found`.",
    ChatSessionPayload: (
        "Excused: written only through `apply_chat_session_payload` for a chat "
        "this module has already checked, exactly as `SummaryPayload` is."
    ),
    UserSetting: (
        "Excused: the primary key is `(key, user_id)`, so the subject's id is "
        "half of the address and a write cannot reach another account's row at "
        "all. `write_user_setting` is still the one writer, and `require_home` "
        "there refuses a deployment-policy key that a document names."
    ),
    ChannelSettingGroup: (
        "Excused: never merged by an id the document supplies. "
        "`ensure_default_group` resolves the caller's own group by a derived id "
        "and creates it if absent, so there is no foreign row to land on. The "
        "document *does* supply an id for the Channel to point at, and ticket 35 "
        "made that read owner-checked — a foreign group is treated as absent and "
        "falls through to the default, rather than governing the caller's new "
        "channel by another account's policy row."
    ),
}

#: Tables this module causes rows in **without writing them** — it calls another
#: aggregate's writer, which is the one-writer rule working rather than an
#: omission. Keyed by name rather than by class on purpose: naming
#: `ChannelFollow` here would trip `test_channel_creation_paths.py`'s
#: one-writer guard, which matches the bare identifier anywhere outside
#: `follows.py` precisely so that a second writer cannot appear quietly. That
#: guard is right and this is the false positive its own comment predicts, so
#: the entry is a string.
#:
#: Both were missing from the inventory on the first cut and review found them.
#: An inventory with silent omissions is worth nothing, and "every table this
#: module writes" was already untrue the day it was written.
INDIRECT_WRITES: dict[str, str] = {
    "ChannelFollow": (
        "Written by `follows.sync_follow_settings` for the *caller*, because "
        "ticket 04 makes every Channel-creation path write a Follow. The row is "
        "keyed on the resolved caller, so an imported document cannot name "
        "somebody else's."
    ),
    "SyncMeta": (
        "Bumped per section by `touch_sync` at the end of the document. A cache "
        "etag, classified `Scope.CORPUS` by the seam for the same reason — "
        "there is no per-account row to land on."
    ),
}


def _assert_importable(
    existing: Any,
    user_id: uuid.UUID,
    *,
    detail: str,
    section: str,
) -> None:
    """Refuse an existing row that belongs to another account.

    Thin on purpose — the rule and its reasoning live in
    `tenancy.assert_owner_on_write`, so the import path and
    `credentials.migrate_bot_credentials` cannot come to disagree about what
    "already somebody else's" means. `None` is the upsert's create branch and is
    never a refusal: an absent id still creates, which is what keeps a restore a
    restore.

    The refusal is logged server-side with the section and id, because the
    response deliberately cannot say which row it was.

    Called before the mutation because it reads better there, not because
    anything turns on it: the whole document is one transaction and nothing
    commits on the way to the raise, so a check placed after the overwrite was
    watched passing every guard. Correctness here is the transaction's.
    """
    if existing is None:
        return

    try:
        assert_owner_on_write(existing.user_id, user_id, detail=detail)
    except HTTPException:
        # The refusal aborts the whole document, and the 404 body cannot name
        # the row without becoming the enumeration oracle it exists to close.
        # Server-side it can: without this, an Admin whose ten-thousand-row
        # restore fails learns only `{"detail": "Summary not found"}` and has
        # nothing to diff against, since one transaction means no partial
        # progress either.
        logger.warning(
            "import refused: %s row %r belongs to another account (caller %s)",
            section,
            getattr(existing, "id", "?"),
            user_id,
        )
        raise


def unwrap_import_body(body: dict[str, Any]) -> dict[str, Any]:
    if "data" in body and isinstance(body["data"], dict):
        inner = body["data"]
        if any(
            k in inner for k in ("channels", "posts", "summaries", "bot_credentials")
        ):
            return inner
    return body


def _import_channels(session: Session, items: list[Any], *, user_id: uuid.UUID) -> int:
    """Upsert exported channels, preserving server-managed state.

    `SERVER_MANAGED_CHANNEL_FIELDS` are stripped rather than trusted: an export
    carries sync bookkeeping (latest ids, next-run timestamps) that describes the
    *exporting* install, and importing it would make this install believe it had
    already fetched history it does not hold.

    A channel arriving without a valid setting group is placed in Restricted when
    the export marks it unavailable or frozen, and in the default group
    otherwise — never left group-less, which nothing downstream tolerates.
    """
    touched: list[tuple[Channel, dict[str, Any]]] = []
    for item in items:
        normalized = normalize_body(item)
        for field in SERVER_MANAGED_CHANNEL_FIELDS:
            normalized.pop(field, None)
        channel_id = normalized.get("id", item.get("id"))
        ch = session.get(Channel, channel_id)
        if ch:
            apply_channel_fields(ch, normalized, session=session)
            ch.updated_at = utc_now()
            # Only what this item actually carries — see
            # `sync_follow_settings` for why writing the full set on every
            # import would clobber a Follow that has legitimately diverged for
            # a field this item never mentions.
            follow_values = follow_values_from_body(normalized)
            # **An existing Channel does not imply an existing Follow.** A
            # restore into a deployment where another account scraped the handle
            # first lands here with nothing of this account's on the row, so
            # `sync_follow_settings` below would *create* the follow — and
            # `follow_values_from_body` deliberately never carries
            # `setting_group_id`, so it would create it group-less. That is the
            # state this function's own docstring says nothing downstream
            # tolerates: `run_auto_sync` skips such a channel silently and
            # `get_group_for_channel` answers 500 for it. `channels.upsert_channel`
            # took this same fix; the import door is the other half of it.
            existing_follow = get_follow(session, user_id=user_id, channel_id=ch.id)
            if existing_follow is None or existing_follow.setting_group_id is None:
                follow_values["setting_group_id"] = ensure_default_group(
                    session, user_id=user_id
                ).id
        else:
            setting_group_id = normalized.get("setting_group_id")
            group = (
                session.get(ChannelSettingGroup, setting_group_id)
                if setting_group_id
                else None
            )
            # A group the caller may not act on is treated as absent, not as a
            # refusal (ticket 35). `setting_group_id` here is an id the
            # *document* supplies, so without this an import attaches the
            # caller's new Channel to another account's policy row — the same
            # hole `bulk_assign_setting_group` had, reached through the import
            # door. Falling through to the default group rather than raising,
            # because the branch below already exists for exactly this shape and
            # an import is one transaction: refusing would abort a whole restore
            # over a field the document can simply be wrong about.
            if group is not None and not may_act_on(
                owner_id=group.user_id, user_id=user_id
            ):
                group = None
            if group is None:
                is_restricted = bool(
                    normalized.get("is_unavailable_on_web_view")
                    or normalized.get("is_frozen")
                )
                group = (
                    get_or_create_restricted_group(session, user_id=user_id)
                    if is_restricted
                    else ensure_default_group(session, user_id=user_id)
                )
            ch = Channel(
                id=channel_id,
                name=normalized.get("name", ""),
                display_name=normalized.get("display_name"),
                photo_url=normalized.get("photo_url"),
                bio=normalized.get("bio"),
                subscribers=normalized.get("subscribers"),
                photos=normalized.get("photos"),
                videos=normalized.get("videos"),
                files=normalized.get("files"),
                links=normalized.get("links"),
                last_updated=normalized.get("last_updated"),
                language=normalized.get("language"),
            )
            # A brand-new Channel has no existing Follow to leave alone, so its
            # first Follow takes every follow-owned field the document carries,
            # plus the group resolved above. Ticket 22 dropped these columns
            # from Channel, so the Follow is where an imported tag or start
            # time now lands — and the only place it can.
            follow_values = follow_values_from_body(normalized) | {
                "setting_group_id": group.id
            }
        session.add(ch)
        touched.append((ch, follow_values))

    # One flush for the batch, still inside the document's single transaction:
    # `sync_follow_settings` is a Core INSERT that executes immediately, so
    # the ORM adds above have to reach the database before the foreign key is
    # checked.
    session.flush()
    for channel, follow_values in touched:
        sync_follow_settings(session, channel, user_id=user_id, values=follow_values)
    return len(items)


#: Summary columns with their own field; everything else on an exported summary
#: is preserved in `extra`, which is why `Summary` is an open model.
#:
#: The corpus-sized fields and the two derived ones are excluded here as well:
#: they are routed to `tg_summary_payloads` and recomputed respectively, so
#: letting them fall into `extra` would put back exactly what the split took
#: out.
_SUMMARY_KNOWN_FIELDS = {
    "text",
    "channels",
    "startDate",
    "endDate",
    "language",
    "model",
    "postCount",
    "timestamp",
    *HEAVY_SUMMARY_FIELDS,
    "chatMessageCount",
    "promptExcerpt",
}


def _import_summaries(session: Session, items: list[Any], *, user_id: uuid.UUID) -> int:
    """Upsert exported summaries, keeping unknown keys in `extra`.

    Both camelCase and snake_case are accepted for the date and count fields:
    exports exist from before and after the migration, and an import that
    silently zeroed a summary's date range would be worse than rejecting it.

    Exports written before `z8a9b0c1d2e3` carry the corpus-sized fields inline
    alongside the small flags, exactly as exports written after it do — the
    split is a storage detail, and the document shape did not change. Either
    way they are routed to `tg_summary_payloads` here.
    """
    for item in items:
        sid = item.get("id")
        summary = session.get(Summary, sid)
        _assert_importable(
            summary, user_id, detail=SUMMARY_NOT_FOUND, section="summaries"
        )
        if summary:
            summary.text = item.get("text", summary.text)
            summary.channels = item.get("channels", summary.channels)
            summary.start_date = item.get(
                "startDate", item.get("start_date", summary.start_date)
            )
            summary.end_date = item.get(
                "endDate", item.get("end_date", summary.end_date)
            )
            summary.language = item.get("language", summary.language)
            summary.model = item.get("model", summary.model)
            summary.post_count = item.get(
                "postCount", item.get("post_count", summary.post_count)
            )
            summary.timestamp = item.get("timestamp", summary.timestamp)
            summary.extra = {
                k: v
                for k, v in item.items()
                if k not in _SUMMARY_KNOWN_FIELDS and k != "id"
            }
            summary.updated_at = utc_now()
        else:
            summary = Summary(
                id=sid,
                user_id=user_id,
                text=item.get("text", ""),
                channels=item.get("channels", []),
                start_date=item.get("startDate", item.get("start_date", 0)),
                end_date=item.get("endDate", item.get("end_date", 0)),
                language=item.get("language", "English"),
                model=item.get("model"),
                post_count=item.get("postCount", item.get("post_count")),
                timestamp=item.get("timestamp", 0),
                extra={k: v for k, v in item.items() if k not in _SUMMARY_KNOWN_FIELDS},
            )
        # Ticket 27: an import is a write door onto `tg_summaries` that is not
        # `upsert_summary`, and `POST /data/import` is reachable during an
        # elevation. Without this an Owner importing on somebody's behalf leaves
        # every new row claiming the User made it, and every updated row
        # carrying whoever touched it last — the exact lie the column exists to
        # stop. Summaries are the only one of the four artifact families this
        # importer writes; the guard in `test_view_as_elevation.py` asserts that
        # rather than trusting it.
        acting_owner.stamp(session, summary)
        session.add(summary)

        payload = apply_summary_payload(
            session,
            sid,
            user_id=summary.user_id,
            updates={
                column: item[key]
                for key, column in PAYLOAD_COLUMNS.items()
                if item.get(key) is not None
            },
            removals={
                column
                for key, column in PAYLOAD_COLUMNS.items()
                if key in item and item[key] is None
            },
        )
        refresh_summary_derived_columns(summary, payload)
    return len(items)


def _import_bot_credentials(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> int:
    """Upsert bot credentials, re-encrypting their tokens.

    A *new* credential with no token is skipped entirely rather than stored
    empty: a credential that cannot authenticate is not a credential, and a blank
    row would surface in the UI as a usable bot. An *existing* one keeps its
    stored token when the export omits it.
    """
    for item in items:
        normalized = normalize_body(item)
        bid = normalized.get("id", item.get("id"))
        token = normalized.get("token_encrypted") or normalized.get("token", "")
        encrypted = encrypt_bot_token(token) if token else ""
        bot = session.get(BotCredential, bid)
        _assert_importable(
            bot, user_id, detail=BOT_CREDENTIAL_NOT_FOUND, section="bot_credentials"
        )
        if bot:
            bot.name = normalized.get("name", bot.name)
            if encrypted:
                bot.token_encrypted = encrypted
            bot.username = normalized.get("username", bot.username)
            bot.photo_url = normalized.get("photo_url", bot.photo_url)
            bot.last_validated = normalized.get("last_validated", bot.last_validated)
            bot.updated_at = utc_now()
        else:
            if not encrypted:
                continue
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
    return len(items)


def _import_chat_destinations(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> int:
    for item in items:
        normalized = normalize_body(item)
        did = normalized.get("id", item.get("id"))
        dest = session.get(ChatDestination, did)
        _assert_importable(
            dest,
            user_id,
            detail=CHAT_DESTINATION_NOT_FOUND,
            section="chat_destinations",
        )
        if dest:
            dest.name = normalized.get("name", dest.name)
            dest.chat_id = normalized.get("chat_id", dest.chat_id)
            dest.updated_at = utc_now()
        else:
            dest = ChatDestination(
                id=did,
                user_id=user_id,
                name=normalized.get("name", did),
                chat_id=normalized.get("chat_id", ""),
            )
        session.add(dest)
    return len(items)


#: Log type -> the upsert that owns it. Keyed by the type rather than by the
#: export section so `LOG_MODELS` can supply both the section name and the model,
#: which is what lets the owner check below name a table without a second
#: hand-written mapping to keep in step. D1 genericised the API for these, and
#: the writes stay per-type because the five tables genuinely differ.
_LOG_IMPORTERS: tuple[tuple[str, Any], ...] = (
    ("publish", upsert_publish_log),
    ("sync", upsert_sync_log),
    ("llm", upsert_llm_log),
    ("embedding", upsert_embedding_log),
    ("network", upsert_network_log),
)


def _import_logs(
    session: Session, payload: dict[str, Any], *, user_id: uuid.UUID
) -> dict[str, int]:
    """Import the five log families, checking the owner of the four that have one.

    **Deliberately the same rule `create_logs` applies at the API door**:
    everything that is not follow-scoped is owner-checked, network logs
    included. The first cut of this used `PERSONAL_LOG_TYPES` and excused
    network on the reasoning that the family records proxy behaviour — which is
    true of *reads*, and is why they are Admin-only, but `create_logs` already
    settled the write question the other way: "a write landing on an existing
    row is an overwrite either way". Review caught the two doors disagreeing.
    Two rules for one question is the drift the seam exists to prevent, and
    `PERSONAL_LOG_TYPES` is a *retention* partition — borrowing it to answer a
    write-authority question was the category error underneath.

    **Sync logs are the one family skipped, and not by the same mechanism
    `create_logs` uses.** There the follow-scoped branch calls
    `_assert_may_write_channel_telemetry`, which is deliberately *create-only* —
    an id that already names a row is refused outright. An import is a restore
    and must be idempotent, so applying it here would refuse every re-import of
    an export containing sync logs. They carry no owner either (ticket 19), so
    there is nothing for `_assert_importable` to compare.

    The upserts assign `user_id` on their *existing* branch too, so an unchecked
    clobber here did not only rewrite another account's row — it took it.
    """
    counts: dict[str, int] = {}
    for log_type, upsert_fn in _LOG_IMPORTERS:
        model, section = LOG_MODELS[log_type]
        items = payload.get(section, [])
        for item in items:
            if scope_of(model) is not Scope.FOLLOW_SCOPED:
                log_id = normalize_body(item).get("id")
                if log_id:
                    _assert_importable(
                        session.get(model, log_id),
                        user_id,
                        detail=f"{log_type} log not found",
                        section=section,
                    )
            # Sync logs carry no owner (ticket 19), so ticket 22 dropped the
            # parameter with the column. Same asymmetry as `logs.create_logs`,
            # and named here for the same reason: better a visible branch than a
            # signature that accepts an id it discards.
            if log_type == "sync":
                upsert_sync_log(session, item)
            else:
                upsert_fn(session, item, user_id)
        if items:
            counts[section] = len(items)
    return counts


def _import_embeddings(session: Session, items: list[Any]) -> int:
    """`merge` rather than add: embeddings are corpus-level and keyed by
    `channel_name`/`post_id`, so re-importing must overwrite, not collide."""
    for item in items:
        normalized = normalize_body(item)
        session.merge(
            PostEmbedding(
                id=normalized.get("id", item.get("id")),
                channel_name=normalized.get("channel_name", ""),
                post_id=int(normalized.get("post_id", 0)),
                vector=normalized.get("vector", []),
                text=normalized.get("text", ""),
                provider=normalized.get("provider", "gemini"),
                model=normalized.get("model", ""),
                dimensions=normalized.get("dimensions", 0),
            )
        )
    return len(items)


def _import_translations(session: Session, items: list[Any]) -> int:
    for item in items:
        normalized = normalize_body(item)
        session.merge(
            PostTranslation(
                id=normalized.get("id", item.get("id")),
                channel_name=normalized.get("channel_name", ""),
                post_id=int(normalized.get("post_id", 0)),
                language=normalized.get("language", ""),
                translated_text=normalized.get("translated_text", ""),
                timestamp=normalized.get("timestamp", 0),
            )
        )
    return len(items)


#: Columns no imported row ever takes from the document, whatever the table.
#:
#: `id` and `user_id` are the row's identity and its subject, both decided by
#: the request rather than by the file. `extra` is where the *unknown* keys go,
#: so taking a literal `extra` from the document would let a crafted file
#: shadow a column. `acted_by_*` is ticket 27's attribution: it says who wrote
#: the row on this deployment, and a document cannot know that. `updated_at` is
#: when this install last touched it.
_NEVER_IMPORTED_COLUMNS = frozenset(
    {"id", "user_id", "extra", "acted_by_user_id", "acted_by_email", "updated_at"}
)


def _importable_columns(model: type[Any]) -> frozenset[str]:
    """The column names an imported row may set, read off the table itself.

    Derived rather than listed, for the reason `owner_backfill_inventory` is:
    a column added next quarter is carried by an export the moment it exists,
    and a hand-written set here would silently drop it on the way back in.
    """
    return (
        frozenset(c.key for c in typing_cast(Any, model).__table__.columns)
        - _NEVER_IMPORTED_COLUMNS
    )


def _import_artifact_rows(
    session: Session,
    items: list[Any],
    *,
    model: type[Any],
    detail: str,
    section: str,
    user_id: uuid.UUID,
    aliases: dict[str, str] | None = None,
    heavy: frozenset[str] = frozenset(),
) -> list[tuple[Any, dict[str, Any]]]:
    """Upsert one open artifact family, keeping unknown keys in `extra`.

    The three families ticket 28 added to the export are `Summary`'s siblings —
    same open `extra` column, same 404 detail rule, same attribution — so they
    get one importer rather than three near-copies. `_import_summaries` keeps
    its own because it is not quite this shape: its date fields accept both
    spellings for backups written either side of a migration, and its payload
    split predates the others.

    `aliases` exists for one real collision: `tag_run_to_camel` emits the row's
    millisecond clock as `updatedAt`, and `to_snake` turns that into
    `updated_at`, which is a *`datetime`* column on the same table. Without the
    alias an import writes an integer into a timestamp — the kind of failure a
    generic mapper produces and a hand-written one never would, so it is named
    here instead of trusted.

    **`updated_at_ms` therefore round-trips, and that is the intended answer
    for it.** It is the clock History sorts and renders, so a restored tag run
    keeps the moment it was made, exactly as `created_at` does. The `updated_at`
    column beside it does not round-trip: it is when *this* install last touched
    the row, and it is stamped below — on the tables that have one. `TagRun` has
    both and they mean different things; the other two families have only the
    second.

    `heavy` names fields that live in a companion payload table; they are
    recognised so they do not fall into `extra`, and left for the caller to
    route.

    Returns each row with the item it came from, because the payload write
    needs both and the caller owns the transaction.
    """
    aliases = aliases or {}
    table_columns = frozenset(c.key for c in typing_cast(Any, model).__table__.columns)
    columns = _importable_columns(model) - heavy
    written: list[tuple[Any, dict[str, Any]]] = []

    for item in items:
        row_id = item.get("id") or normalize_body(item).get("id")
        existing = session.get(model, row_id)
        _assert_importable(existing, user_id, detail=detail, section=section)

        row = existing if existing is not None else model(id=row_id, user_id=user_id)
        extra: dict[str, Any] = {}
        for key, value in item.items():
            if key == "id":
                continue
            name = aliases.get(key, to_snake(key))
            if name in columns:
                setattr(row, name, value)
            elif name not in heavy and name not in _NEVER_IMPORTED_COLUMNS:
                extra[key] = value
        row.extra = extra
        # Guarded because SQLModel takes the assignment whether or not the
        # column exists — it files an unmapped one on the instance and drops
        # it — so a family added here without an `updated_at` would read as
        # stamped and be silently unstamped. All three today have one; this is
        # about the fourth. It is the same failure the constructor-keyword half
        # of `test_superseded_columns.py` exists to catch, in the other
        # direction.
        if "updated_at" in table_columns:
            row.updated_at = utc_now()
        # Ticket 27, and ticket 28 gives it a second reason to be here: an
        # Admin importing *for* somebody binds themselves as the acting Owner,
        # so a restore says who uploaded it rather than claiming the account
        # wrote every row in the file.
        acting_owner.stamp(session, row)
        session.add(row)
        written.append((row, item))

    return written


def _import_chat_sessions(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> int:
    """Upsert chat sessions, routing the transcript to its companion table."""
    for row, item in _import_artifact_rows(
        session,
        items,
        model=ChatSession,
        detail=CHAT_SESSION_NOT_FOUND,
        section="chat_sessions",
        user_id=user_id,
        heavy=frozenset(CHAT_PAYLOAD_COLUMNS),
    ):
        # `chat_session_to_camel` always emits `messages`, as `[]` when there is
        # no payload row — so an empty list here is "this chat has no
        # transcript", not "leave the one it has alone". Writing it as an update
        # would give every transcript-less chat a payload row on every restore,
        # which is the empty-row accumulation `apply_chat_session_payload`
        # deletes rows to avoid. Absent means untouched; that is a document from
        # somewhere else, and it has nothing to say about the transcript.
        messages = item.get("messages")
        updates: dict[str, Any] = {}
        removals: set[str] = set()
        if isinstance(messages, list) and messages:
            updates = {"messages": messages}
        elif "messages" in item:
            removals = {"messages"}
        payload = apply_chat_session_payload(
            session,
            row.id,
            user_id=row.user_id,
            updates=updates,
            removals=removals,
        )
        # `message_count` is a column the list reads instead of opening the
        # payload table, so an import that skipped this would restore a
        # transcript the history view reports as empty.
        refresh_chat_session_derived_columns(row, payload)
    return len(items)


def _import_tag_runs(session: Session, items: list[Any], *, user_id: uuid.UUID) -> int:
    _import_artifact_rows(
        session,
        items,
        model=TagRun,
        detail=TAG_RUN_NOT_FOUND,
        section="tag_runs",
        user_id=user_id,
        aliases={"updatedAt": "updated_at_ms"},
    )
    return len(items)


def _import_discover_reports(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> int:
    _import_artifact_rows(
        session,
        items,
        model=DiscoverReport,
        detail=REPORT_NOT_FOUND,
        section="discover_reports",
        user_id=user_id,
    )
    return len(items)


def _import_user_settings(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> int:
    """Restore the subject's personal settings rows.

    Keys this deployment does not classify as personal are **skipped, loudly**
    rather than written or raised on. A document may legitimately carry a key a
    later version retired, and aborting a whole restore over one is worse than
    dropping it; writing it into `tg_user_settings` anyway would file a
    deployment-policy value where nothing will ever read it back.
    `write_user_setting` refuses that second one on its own, so this is the
    branch that keeps the refusal from ending the transaction.
    """
    written = 0
    for item in items:
        key = item.get("key")
        value = item.get("value")
        if not isinstance(key, str) or not isinstance(value, dict):
            continue
        try:
            home = home_for(key)
        except KeyError:
            home = None
        if home is not Home.USER:
            logger.warning("import skipped settings key %r: not a personal key", key)
            continue
        write_user_setting(session, key, value, user_id=user_id)
        written += 1
    return written


def _follow_handles_from_posts(
    session: Session, items: list[Any], *, user_id: uuid.UUID
) -> None:
    """Follow every handle the imported Posts name, creating Channels as needed.

    **Ticket 28's decision, and ticket 21 left it here.** A posts section names
    channels by handle and carries no Channel rows of its own, so a posts-only
    import used to write corpus nobody could read: enforcement scopes Posts by
    an `EXISTS` against `tg_channel_follows`, and there was no follow. The rows
    were there, the restore reported them, and the account saw nothing.

    A restore that leaves its own rows unreadable is not a restore, so an
    import follows the handles its document mentions. It goes through
    `ensure_follow_for_channel` like every other creation path (ticket 04),
    inside the document's single transaction — `create_followed_channel` opens
    its own `Session` and commits, which is why the shared helper is the
    follow writer here and not the whole function.

    `POST /data/posts/bulk` deliberately keeps the old behaviour. It is the
    scraper's raw ingest door, its caller already holds the Follow, and
    auto-following whatever a low-level bulk write happens to mention is a
    decision that belongs to the door that knows it is restoring a backup.
    """
    handles = {
        str(item.get("channelName") or item.get("channel_name") or "").strip()
        for item in items
    }
    handles.discard("")
    if not handles:
        return

    existing = {
        channel.name: channel
        for channel in session.exec(
            select(Channel).where(col(Channel.name).in_(sorted(handles)))
        ).all()
    }
    created: list[Channel] = []
    for handle in sorted(handles - set(existing)):
        # `Channel.id` is the handle by convention, and `name` is separately
        # writable through `PUT /data/channels/{id}` — so the id can already be
        # taken by a channel that has since been renamed. Inserting anyway is a
        # primary-key violation that aborts the whole restore over a rescue
        # this function is only attempting on the document's behalf. Skipped
        # with a warning instead: the Posts still import, they are simply not
        # reachable until somebody follows the handle, which is exactly where
        # this door stood before.
        if session.get(Channel, handle) is not None:
            logger.warning(
                "import did not follow %r: the channel id is taken by a "
                "channel with a different name",
                handle,
            )
            continue
        # No document row to take a display name or photo from — this handle
        # appears only as a post's `channelName`. The next sync fills the rest
        # in; what matters now is that the Channel exists to be followed.
        channel = Channel(id=handle, name=handle)
        session.add(channel)
        created.append(channel)
    if created:
        # `ensure_follow_for_channel` is a Core INSERT that executes
        # immediately, so the ORM adds have to reach the database before its
        # foreign key is checked — the same flush `_import_channels` makes.
        session.flush()

    now = int(utc_now().timestamp() * 1000)
    group_id = ensure_default_group(session, user_id=user_id).id
    for channel in [*existing.values(), *created]:
        ensure_follow_for_channel(
            session,
            channel,
            user_id=user_id,
            values={"setting_group_id": group_id, "followed_at": now},
        )


def import_data(
    session: Session, body: dict[str, Any], *, user_id: uuid.UUID
) -> dict[str, Any]:
    """Import an export document, section by section, for one account.

    One transaction for the whole document: a partial import would leave posts
    referencing channels that were never created. Each section reports how many
    rows it took, and only sections that were present get a count and an etag
    bump — importing a channels-only export must not invalidate the posts cache.

    That single transaction is also what makes a refusal clean: a row belonging
    to another account raises before anything commits, so the rest of the
    document goes with it rather than landing half-applied.

    `user_id` is **the account the document lands under** — the subject, which
    ticket 28 lets an Admin name and which is otherwise the caller. It is
    required rather than optional. It was `uuid.UUID | None` while it only
    stamped new rows; ticket 31 makes it decide whether an existing row may be
    rewritten, and "no caller" has no answer to that.
    """
    payload = unwrap_import_body(body)
    counts: dict[str, int] = {}

    if payload.get("channels"):
        counts["channels"] = _import_channels(
            session, payload["channels"], user_id=user_id
        )

    if payload.get("posts"):
        counts["posts"] = bulk_upsert_posts_impl(payload["posts"], session)
        _follow_handles_from_posts(session, payload["posts"], user_id=user_id)

    if payload.get("summaries"):
        counts["summaries"] = _import_summaries(
            session, payload["summaries"], user_id=user_id
        )

    if payload.get("chat_sessions"):
        counts["chat_sessions"] = _import_chat_sessions(
            session, payload["chat_sessions"], user_id=user_id
        )

    if payload.get("tag_runs"):
        counts["tag_runs"] = _import_tag_runs(
            session, payload["tag_runs"], user_id=user_id
        )

    if payload.get("discover_reports"):
        counts["discover_reports"] = _import_discover_reports(
            session, payload["discover_reports"], user_id=user_id
        )

    if payload.get("user_settings"):
        counts["user_settings"] = _import_user_settings(
            session, payload["user_settings"], user_id=user_id
        )

    if payload.get("bot_credentials"):
        counts["bot_credentials"] = _import_bot_credentials(
            session, payload["bot_credentials"], user_id=user_id
        )

    if payload.get("chat_destinations"):
        counts["chat_destinations"] = _import_chat_destinations(
            session, payload["chat_destinations"], user_id=user_id
        )

    counts.update(_import_logs(session, payload, user_id=user_id))

    if payload.get("embeddings"):
        counts["embeddings"] = _import_embeddings(session, payload["embeddings"])

    if payload.get("translations"):
        counts["translations"] = _import_translations(session, payload["translations"])

    session.commit()
    for key in counts:
        touch_sync(session, key)
    return {"imported": counts}


EXPORT_CHUNK_ROWS = 500


@dataclass(frozen=True)
class ExportSubject:
    """Whose rows an export document carries.

    Ticket 28's whole subject, in one value. `user_id is None` means *every*
    account, and it is a constructor away rather than a bare `None` a caller
    might have arrived at by accident — `tenancy.scoped_select` refuses an
    optional id for exactly this reason, that "no user" invites a meaning
    nobody chose. `everyone()` is a sentence; `ExportSubject(None)` is a
    default that slipped.
    """

    user_id: uuid.UUID | None

    @classmethod
    def account(cls, user_id: uuid.UUID) -> ExportSubject:
        return cls(user_id=user_id)

    @classmethod
    def everyone(cls) -> ExportSubject:
        return cls(user_id=None)

    @property
    def is_everyone(self) -> bool:
        return self.user_id is None


#: The 404 body for a subject nobody can be shown.
#:
#: One string for "no such account" and for "that is not a user id", because
#: telling them apart is an account oracle — the same argument
#: `tenancy.assert_owner` makes about a row, one level up. It lives beside the
#: subject rather than in the route so the guard asserting it can name it.
SUBJECT_NOT_FOUND = "User not found"


#: The literal a request spells to ask for every account.
#:
#: A word rather than an absent parameter, because the default has to be the
#: *safe* one: an export is the widest read in the deployment and crossing
#: accounts should be something somebody typed.
EVERYONE = "all"


@dataclass(frozen=True)
class ExportSection:
    """One key of the export document, and the query behind it.

    The streamer, the pre-count and the coverage guard all walk this list, so
    a section cannot appear in the body without being counted, and a table
    cannot join the schema without somebody deciding whether a backup carries
    it. Three readers of one inventory is the same shape `tenancy.SCOPES` uses
    on the schema itself.
    """

    key: str
    model: type[Any]
    #: Takes whatever the statement yields — an entity, or the tuple an outer
    #: join to a payload table produces.
    to_camel: Callable[[Any], dict[str, Any]]
    #: Overrides `select(model)`. A callable rather than a statement so the
    #: inventory can be a module-level constant without building queries at
    #: import time.
    build: Callable[[], Any] | None = None

    def statement(self) -> Any:
        return select(self.model) if self.build is None else self.build()


#: Sync logs keep their bodies in a companion table, so they stream over an
#: outer join — an export must stay complete, and a log whose payload has been
#: reclaimed still has to appear (with null bodies). Summaries and chat
#: sessions have the same split for the same reason.
def _sync_logs_statement() -> Any:
    return select(SyncLog, SyncLogPayload).join(
        SyncLogPayload,
        col(SyncLogPayload.sync_log_id) == col(SyncLog.id),
        isouter=True,
    )


def _summaries_statement() -> Any:
    return select(Summary, SummaryPayload).join(
        SummaryPayload,
        col(SummaryPayload.summary_id) == col(Summary.id),
        isouter=True,
    )


def _chat_sessions_statement() -> Any:
    return select(ChatSession, ChatSessionPayload).join(
        ChatSessionPayload,
        col(ChatSessionPayload.chat_session_id) == col(ChatSession.id),
        isouter=True,
    )


#: Tables the seam classifies that a backup deliberately does not carry, and
#: why. Checked against `tenancy.SCOPES` by
#: `test_admin_scoped_export.py::test_every_user_owned_table_is_exported_or_excused`,
#: which is the only cheap moment to ask "does this belong in a backup?" — the
#: same argument `IMPORT_WRITES` makes about the write door.
EXPORT_OMISSIONS: dict[str, str] = {
    "DiscoverIgnoredChannel": (
        "A dismissal is a judgement about a candidate, not an artifact "
        "(ticket 30). Restoring one would re-hide handles on a deployment "
        "where the account never dismissed them, and the row comes back by "
        "dismissing again."
    ),
    "SyncJob": (
        "A write-only progress trail, pruned by age and only in a terminal "
        "state. Restoring finished jobs would put rows back in a table whose "
        "retention already decided they were gone."
    ),
    "PostSyncState": (
        "Scrape bookkeeping about the shared corpus — the same reason "
        "`SERVER_MANAGED_CHANNEL_FIELDS` are stripped from an imported "
        "Channel: it describes the exporting install's walk, not the data."
    ),
    "QuotaUsage": (
        "The Request ledger. It is the record of what an account spent on a "
        "given day and nothing may edit it, so an import door onto it would "
        "be a way to rewrite the meter."
    ),
    "QuotaLimit": (
        "The allowance an Admin set for an account. Deployment policy about a "
        "person rather than data of theirs, and restoring one would carry "
        "another deployment's ceilings in."
    ),
    "ChannelFollow": (
        "Carried inside the `channels` section, not beside it: ticket 22 moved "
        "the six per-User fields onto the Follow and "
        "`channel_to_camel(follow=...)` puts them back on the channel object, "
        "which is the shape every export written since v2 has. A section of "
        "its own would be the same rows twice. Keyed by name here for the "
        "reason `INDIRECT_WRITES` is — naming the class would trip the "
        "sole-writer guard in `test_channel_creation_paths.py`."
    ),
    "SummaryPayload": "Carried by the `summaries` join, as its own row's bodies.",
    "ChatSessionPayload": "Carried by the `chat_sessions` join.",
    "SyncLogPayload": "Carried by the `sync_logs` join.",
    "DiscoverHandleProbe": (
        "Corpus, and a fact about a handle rather than about anybody — "
        "`tenancy.SCOPES` classifies it that way for the same reason."
    ),
    "SyncMeta": "Cache etags. Corpus, and meaningless in another install.",
}


def export_sections(
    session: Session, *, subject: ExportSubject, viewer_id: uuid.UUID
) -> tuple[ExportSection, ...]:
    """The document's sections, in order, for one export.

    Takes a `Session` because two of them serialise against a lookup the query
    cannot carry: a Channel's per-User fields live on the Follow (ticket 22)
    and its policy on the setting group, so both maps are read once here and
    closed over rather than re-read per row.

    Whose follows those are is the one place `viewer_id` and the subject can
    differ. For `subject=all` there is no single answer — every follower of a
    channel has their own tags and start id — so it stays the caller's, which
    is exactly what this endpoint did before it took a subject.
    """
    groups_by_id = load_groups_by_id(session)
    follow_owner = viewer_id if subject.is_everyone else subject.user_id
    assert follow_owner is not None  # `is_everyone` is the only None case
    follows = follows_for_user(session, user_id=follow_owner)

    def channel_row(channel: Channel) -> dict[str, Any]:
        follow = follows.get(channel.id)
        group = (
            groups_by_id.get(follow.setting_group_id)
            if follow is not None and follow.setting_group_id is not None
            else None
        )
        return channel_to_camel(channel, group=group, follow=follow)

    return (
        ExportSection("setting_groups", ChannelSettingGroup, setting_group_to_camel),
        ExportSection("channels", Channel, channel_row),
        ExportSection("posts", Post, post_to_camel),
        ExportSection(
            "summaries",
            Summary,
            lambda row: summary_to_camel(row[0], row[1]),
            _summaries_statement,
        ),
        ExportSection("bot_credentials", BotCredential, bot_to_camel),
        ExportSection("chat_destinations", ChatDestination, chat_dest_to_camel),
        ExportSection("publish_logs", PublishLog, publish_log_to_camel),
        ExportSection(
            "sync_logs",
            SyncLog,
            lambda row: sync_log_to_camel(row[0], row[1]),
            _sync_logs_statement,
        ),
        ExportSection("llm_logs", LLMLog, llm_log_to_camel),
        ExportSection("embedding_logs", EmbeddingLog, embedding_log_to_camel),
        ExportSection("network_logs", NetworkLog, network_log_to_camel),
        ExportSection("embeddings", PostEmbedding, embedding_to_camel),
        ExportSection("translations", PostTranslation, translation_to_camel),
        # Ticket 28: the other three artifact families and the personal
        # settings. Appended rather than interleaved so every key an existing
        # backup file has keeps its position in the document.
        ExportSection(
            "chat_sessions",
            ChatSession,
            lambda row: chat_session_to_camel(row[0], row[1]),
            _chat_sessions_statement,
        ),
        ExportSection("tag_runs", TagRun, tag_run_to_camel),
        ExportSection("discover_reports", DiscoverReport, report_export_to_camel),
        ExportSection("user_settings", UserSetting, user_setting_to_camel),
    )


def _for_subject(statement: Any, model: type[Any], subject: ExportSubject) -> Any:
    """Narrow one section's query to the subject, or say why it is not narrowed.

    `subject_select` rather than `scoped_select`, and the difference is the
    whole of decision 3: the account was named by the request, so the answer
    cannot depend on the tenancy flag — the seam names it, and `tenancy.py` is
    the only module allowed to. The follow-scoped tables get box 3 of
    the ticket out of this for nothing — the seam's `EXISTS` against
    `tg_channel_follows` *is* "the Posts of Channels the subject Follows".
    """
    if subject.is_everyone:
        return unscoped_select(
            statement,
            reason=(
                "`GET /data/export?subject=all` — the deployment-wide backup, "
                "asked for by name and gated on Permission.DATA_ADMIN. This is "
                "the one read in the application that is supposed to cross "
                "every account, which is why it has to be spelled out rather "
                "than reached by leaving a parameter off."
            ),
        )
    assert subject.user_id is not None
    return subject_select(statement, model, subject.user_id)


@dataclass(frozen=True)
class PreparedExport:
    """Everything an export needs, resolved once.

    The route reads `counts` for its header and hands the whole thing to the
    streamer, so the sections are built once rather than once per caller —
    `export_sections` reads the setting groups and the subject's follows, and
    doing that twice for one download was a review finding on the first cut.

    Frozen and holding no `Session`: it is the *plan*, and the queries run when
    the streamer is iterated.
    """

    subject: ExportSubject
    sections: tuple[ExportSection, ...]
    counts: dict[str, int]

    @property
    def total_rows(self) -> int:
        return sum(self.counts.values())


def prepare_export(
    session: Session, *, subject: ExportSubject, viewer_id: uuid.UUID
) -> PreparedExport:
    """Resolve the sections and count each one, before a byte is streamed.

    One `COUNT(*)` per section against the same narrowing the body uses, so the
    numbers cannot describe a different query from the one that streams.

    **What it costs, measured rather than assumed.** On staging's 4.78M-row
    corpus the whole pass is ~1s, essentially all of it `tg_posts`: 975ms
    unscoped and 987ms through the follow `EXISTS`. Every other table is
    single-digit milliseconds. So an export's time-to-first-byte goes from ~0
    to ~1s, on a download that then streams for minutes — which is the trade
    the count is worth making, and it is written down here because the next
    person to read this will otherwise have to re-derive it before they dare
    touch it.

    **A pre-count, not a manifest.** The counts and the body run in separate
    statements under READ COMMITTED, so a row written while a long export is
    streaming appears in the document and not in the number. Pinning them
    together would mean holding a REPEATABLE READ snapshot open for the whole
    transfer, which is the `idle in transaction` cost the scheduler already
    paid for once.
    """
    sections = export_sections(session, subject=subject, viewer_id=viewer_id)
    counts: dict[str, int] = {}
    for section in sections:
        statement = _for_subject(
            select(func.count()).select_from(section.model), section.model, subject
        )
        counts[section.key] = int(session.exec(statement).one())
    return PreparedExport(subject=subject, sections=sections, counts=counts)


def _stream_rows(
    session: Session,
    statement: Any,
    to_camel: Callable[[Any], dict[str, Any]],
) -> Iterator[str]:
    """Yield a section as JSON array items, one row at a time.

    Exports must stay complete, so they cannot be capped like the log viewers.
    Streaming with a server-side cursor keeps peak memory flat instead of
    materialising every row (tg_posts alone is millions of rows) up front.

    `to_camel` receives whatever the statement yields — an entity for most
    sections, a two-tuple for the three that outer-join a payload table.
    """
    statement = statement.execution_options(yield_per=EXPORT_CHUNK_ROWS)
    result = session.exec(statement)
    try:
        first = True
        for row in result:
            yield ("" if first else ",") + json.dumps(
                jsonable_encoder(to_camel(row)), separators=(",", ":")
            )
            first = False
    finally:
        # Release the cursor even if the client disconnects mid-export;
        # a dangling one keeps the read transaction (and its locks) open.
        result.close()


def stream_export_data(
    session: Session,
    *,
    subject: ExportSubject,
    viewer_id: uuid.UUID,
    prepared: PreparedExport | None = None,
) -> Iterator[str]:
    """Serialise one subject's export incrementally as JSON.

    `subject` is ticket 28: an account, or every account. `viewer_id` is who
    asked, and it decides only whose Follows dress the `channels` section when
    the subject is everybody — see `export_sections`.

    Ticket 22 is why a subject was needed at all beyond the tenancy argument:
    `tags`, `startId`, `startTime`, `followedAt` and `discoveredVia` moved off
    `Channel` onto `ChannelFollow`, so "this channel's tags" stopped having one
    answer and started having one per follower. Exporting the subject's own
    follows is what keeps a backup round-trippable — `_import_channels` writes
    an imported tag onto the follow of whoever the import is *for*, so the two
    ends now name the same account instead of both meaning "me".

    `prepared` is the plan the route already built for its header; passing it
    keeps the header and the document from disagreeing and keeps the section
    resolution to one pass. Omitted, this builds its own.
    """
    if prepared is None:
        prepared = prepare_export(session, subject=subject, viewer_id=viewer_id)
    try:
        yield from _stream_export_body(session, prepared)
    finally:
        # End the long read transaction so a big export cannot block DDL
        # or hold back autovacuum for its whole duration.
        session.rollback()


def _stream_export_body(session: Session, prepared: PreparedExport) -> Iterator[str]:
    yield '{"version":2,"timestamp":'
    yield str(int(utc_now().timestamp() * 1000))
    # The counts lead the document for the reason the header exists: a reader
    # streaming this file learns its size before the first row rather than by
    # reaching the end.
    yield ',"counts":'
    yield json.dumps(prepared.counts, separators=(",", ":"))
    yield ',"data":{'

    first = True
    for section in prepared.sections:
        yield ("" if first else ",") + f'"{section.key}":['
        first = False
        yield from _stream_rows(
            session,
            _for_subject(section.statement(), section.model, prepared.subject),
            section.to_camel,
        )
        yield "]"

    yield "}}"
