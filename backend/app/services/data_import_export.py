"""IndexedDB export import and full data export (extracted from data routes).

## Whose rows an import may write (ticket 31)

**Per-account.** A row that already belongs to somebody else is refused with that
family's own 404, exactly as its endpoint answers, and the refusal holds
whichever way the tenancy flag points — see `tenancy.assert_owner_on_write`,
which is where that exception is argued. `IMPORT_WRITES` below is the inventory:
every table this module writes is either checked or excused, with the reason
written next to it.

The ticket offered a second design — let an Admin write across accounts, since
export is Admin-only "for themselves *or for all users*" and a restore that
cannot restore is not a restore. It was not taken, and the reason is narrower
than a preference: **an import cannot express another account's ownership in the
first place.** Every importer here stamps a new row with the *caller's* id, and
an export document carries no owner at all. So a restore into an empty database
already files every account's rows under whoever ran it, and refusing to
overwrite a foreign *existing* row takes away nothing that worked. Ticket 28 is
where export and import learn to carry a subject; that is the ticket that gets
to re-take this decision, and
`tests/services/test_import_write_scoping.py::test_import_stamps_new_rows_with_the_caller_not_the_document`
is what makes it come back and do so rather than inherit it silently.

The route's `Permission.DATA_ADMIN` gate (ticket 18) is not this answer. It
decides who may call import; it says nothing about whose rows the call lands on,
and an Admin restoring their own backup onto an id that has since been reused
cannot tell. Capability is not intent.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Callable, Iterator
from typing import Any

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from sqlmodel import Session, col, select

from app.models_tg import (
    BotCredential,
    Channel,
    ChannelSettingGroup,
    ChatDestination,
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
    utc_now,
)
from app.services.channel_setting_groups import (
    ensure_default_group,
    get_or_create_restricted_group,
    load_groups_by_id,
    setting_group_to_camel,
)
from app.services.channel_tags import normalize_channel_tags
from app.services.channels import SERVER_MANAGED_CHANNEL_FIELDS, apply_channel_fields
from app.services.credentials import (
    BOT_CREDENTIAL_NOT_FOUND,
    CHAT_DESTINATION_NOT_FOUND,
    encrypt_bot_token,
)
from app.services.follows import MIRRORED_CHANNEL_FIELDS, sync_follow_settings
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
    translation_to_camel,
)
from app.services.summaries import (
    HEAVY_SUMMARY_FIELDS,
    PAYLOAD_COLUMNS,
    SUMMARY_NOT_FOUND,
    apply_summary_payload,
    refresh_summary_derived_columns,
    summary_to_camel,
)
from app.services.sync_meta import touch_sync
from app.services.tenancy import Scope, assert_owner_on_write, scope_of

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
    ChannelSettingGroup: (
        "Excused: never merged by an id the document supplies. "
        "`ensure_default_group` resolves the caller's own group by a derived id "
        "and creates it if absent, so there is no foreign row to land on."
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


def _import_channels(
    session: Session, items: list[Any], *, user_id: uuid.UUID | None
) -> int:
    """Upsert exported channels, preserving server-managed state.

    `SERVER_MANAGED_CHANNEL_FIELDS` are stripped rather than trusted: an export
    carries sync bookkeeping (latest ids, next-run timestamps) that describes the
    *exporting* install, and importing it would make this install believe it had
    already fetched history it does not hold.

    A channel arriving without a valid setting group is placed in Restricted when
    the export marks it unavailable or frozen, and in the default group
    otherwise — never left group-less, which nothing downstream tolerates.
    """
    touched: list[tuple[Channel, list[str]]] = []
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
            # `sync_follow_settings` for why mirroring the full set on every
            # import would clobber a Follow that has legitimately diverged
            # from the Channel for a field this item never mentions.
            touched_follow_fields = [
                field for field in MIRRORED_CHANNEL_FIELDS if field in normalized
            ]
        else:
            setting_group_id = normalized.get("setting_group_id")
            group = (
                session.get(ChannelSettingGroup, setting_group_id)
                if setting_group_id
                else None
            )
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
                user_id=user_id,
                name=normalized.get("name", ""),
                display_name=normalized.get("display_name"),
                photo_url=normalized.get("photo_url"),
                bio=normalized.get("bio"),
                subscribers=normalized.get("subscribers"),
                photos=normalized.get("photos"),
                videos=normalized.get("videos"),
                files=normalized.get("files"),
                links=normalized.get("links"),
                start_id=normalized.get("start_id"),
                start_time=normalized.get("start_time"),
                tags=normalize_channel_tags(normalized.get("tags", [])),
                last_updated=normalized.get("last_updated"),
                setting_group_id=group.id,
                language=normalized.get("language"),
                followed_at=normalized.get("followed_at"),
                discovered_via=normalized.get("discovered_via"),
            )
            # A brand-new Channel has no existing Follow to leave alone, so
            # its first Follow mirrors every field ticket 22 will drop from
            # Channel.
            touched_follow_fields = list(MIRRORED_CHANNEL_FIELDS)
        session.add(ch)
        touched.append((ch, touched_follow_fields))

    # One flush for the batch, still inside the document's single transaction:
    # `sync_follow_settings` is a Core INSERT that executes immediately, so
    # the ORM adds above have to reach the database before the foreign key is
    # checked.
    session.flush()
    for channel, touched_follow_fields in touched:
        sync_follow_settings(
            session, channel, user_id=user_id, fields=touched_follow_fields
        )
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


def import_data(
    session: Session, body: dict[str, Any], *, user_id: uuid.UUID
) -> dict[str, Any]:
    """Import an export document, section by section.

    One transaction for the whole document: a partial import would leave posts
    referencing channels that were never created. Each section reports how many
    rows it took, and only sections that were present get a count and an etag
    bump — importing a channels-only export must not invalidate the posts cache.

    That single transaction is also what makes a refusal clean: a row belonging
    to another account raises before anything commits, so the rest of the
    document goes with it rather than landing half-applied.

    `user_id` is required rather than optional. It was `uuid.UUID | None` while
    it only stamped new rows; ticket 31 makes it decide whether an existing row
    may be rewritten, and "no caller" has no answer to that.
    """
    payload = unwrap_import_body(body)
    counts: dict[str, int] = {}

    if payload.get("channels"):
        counts["channels"] = _import_channels(
            session, payload["channels"], user_id=user_id
        )

    if payload.get("posts"):
        counts["posts"] = bulk_upsert_posts_impl(payload["posts"], session)

    if payload.get("summaries"):
        counts["summaries"] = _import_summaries(
            session, payload["summaries"], user_id=user_id
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


def _stream_rows(
    session: Session,
    model: type[Any],
    to_camel: Callable[[Any], dict[str, Any]],
    *,
    statement: Any = None,
) -> Iterator[str]:
    """Yield a table as JSON array items, one row at a time.

    Exports must stay complete, so they cannot be capped like the log viewers.
    Streaming with a server-side cursor keeps peak memory flat instead of
    materialising every row (tg_posts alone is millions of rows) up front.

    `statement` overrides the default select-one-table query — sync logs pass a
    join so their payload rows stream alongside, and `to_camel` then receives
    whatever tuple that statement yields.
    """
    if statement is None:
        statement = select(model)
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


def stream_export_data(session: Session) -> Iterator[str]:
    """Serialise a full export incrementally as JSON.

    Emits the same document export_data() built in memory, so clients and the
    import path see no difference.
    """
    try:
        yield from _stream_export_body(session)
    finally:
        # End the long read transaction so a big export cannot block DDL
        # or hold back autovacuum for its whole duration.
        session.rollback()


def _stream_export_body(session: Session) -> Iterator[str]:
    groups_by_id = load_groups_by_id(session)

    yield '{"version":2,"timestamp":'
    yield str(int(utc_now().timestamp() * 1000))
    yield ',"data":{'

    # Small tables: already bounded, emit directly.
    yield '"setting_groups":'
    yield json.dumps(
        jsonable_encoder(
            [setting_group_to_camel(g) for g in groups_by_id.values()],
        ),
        separators=(",", ":"),
    )
    yield ',"channels":'
    yield json.dumps(
        jsonable_encoder(
            [
                channel_to_camel(c, group=groups_by_id.get(c.setting_group_id))
                for c in session.exec(select(Channel)).all()
            ],
        ),
        separators=(",", ":"),
    )

    # Sync logs keep their bodies in a companion table, so they stream over an
    # outer join — an export must stay complete, and a log whose payload has
    # been reclaimed still has to appear (with null bodies).
    sync_logs_statement = select(SyncLog, SyncLogPayload).join(
        SyncLogPayload,
        col(SyncLogPayload.sync_log_id) == col(SyncLog.id),
        isouter=True,
    )

    # Same shape for summaries: citedPosts/promptText/chatMessages live in
    # tg_summary_payloads, and a summary with none of them has no row there, so
    # the join has to be outer or those summaries would vanish from the export.
    summaries_statement = select(Summary, SummaryPayload).join(
        SummaryPayload,
        col(SummaryPayload.summary_id) == col(Summary.id),
        isouter=True,
    )

    # Large tables: stream row by row.
    for key, model, to_camel, statement in (
        ("posts", Post, post_to_camel, None),
        (
            "summaries",
            Summary,
            lambda row: summary_to_camel(row[0], row[1]),
            summaries_statement,
        ),
        ("bot_credentials", BotCredential, bot_to_camel, None),
        ("chat_destinations", ChatDestination, chat_dest_to_camel, None),
        ("publish_logs", PublishLog, publish_log_to_camel, None),
        (
            "sync_logs",
            SyncLog,
            lambda row: sync_log_to_camel(row[0], row[1]),
            sync_logs_statement,
        ),
        ("llm_logs", LLMLog, llm_log_to_camel, None),
        ("embedding_logs", EmbeddingLog, embedding_log_to_camel, None),
        ("network_logs", NetworkLog, network_log_to_camel, None),
        ("embeddings", PostEmbedding, embedding_to_camel, None),
        ("translations", PostTranslation, translation_to_camel, None),
    ):
        yield f',"{key}":['
        yield from _stream_rows(session, model, to_camel, statement=statement)
        yield "]"

    yield "}}"
