"""CRUD and sync APIs for TG Summarizer data."""

from datetime import datetime
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

from app.api.deps import CurrentUser, SessionDep
from app.jobs.settings import (
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
)
from app.models_tg import AppSetting
from app.schemas.data import BulkReresolveStartIdsRequest, BulkResetSyncRequest
from app.services.bulk_channels import (
    bulk_reresolve_start_ids,
    bulk_reset_and_queue_sync,
)
from app.services.channels import (
    delete_channel as delete_channel_impl,
)
from app.services.channels import (
    get_channel_stats as get_channel_stats_impl,
)
from app.services.channels import (
    list_channels as list_channels_impl,
)
from app.services.channels import (
    upsert_channel as upsert_channel_impl,
)
from app.services.credentials import (
    delete_bot_credential as delete_bot_credential_impl,
)
from app.services.credentials import (
    delete_chat_destination as delete_chat_destination_impl,
)
from app.services.credentials import (
    list_bot_credentials as list_bot_credentials_impl,
)
from app.services.credentials import (
    list_chat_destinations as list_chat_destinations_impl,
)
from app.services.credentials import (
    migrate_bot_credentials as migrate_bot_credentials_impl,
)
from app.services.credentials import (
    upsert_bot_credential as upsert_bot_credential_impl,
)
from app.services.credentials import (
    upsert_chat_destination as upsert_chat_destination_impl,
)
from app.services.data_import_export import export_data as export_data_impl
from app.services.data_import_export import import_data as import_data_impl
from app.services.data_vectors import (
    list_embeddings as list_embeddings_impl,
)
from app.services.data_vectors import (
    list_translations as list_translations_impl,
)
from app.services.data_vectors import (
    upsert_embeddings as upsert_embeddings_impl,
)
from app.services.data_vectors import (
    upsert_translations as upsert_translations_impl,
)
from app.services.logs import (
    LOG_MODELS,
    clear_logs,
    create_logs,
    delete_log_by_id,
    delete_old_logs,
    list_embedding_logs,
    list_llm_logs,
    list_network_logs,
    list_publish_logs,
    list_sync_logs,
)
from app.services.network_settings import (
    get_network_setting_row,
    merge_network_put,
    network_settings_payload,
)
from app.services.operator import get_operator_user_id
from app.services.posts import bulk_upsert_posts
from app.services.posts import list_posts as list_posts_impl
from app.services.settings_store import get_app_setting, put_app_setting
from app.services.stats import get_db_stats
from app.services.summaries import (
    delete_summary as delete_summary_impl,
)
from app.services.summaries import (
    list_summaries as list_summaries_impl,
)
from app.services.summaries import (
    upsert_summary as upsert_summary_impl,
)
from app.services.sync_meta import get_sync_meta, touch_sync

_SETTING_LOADERS = {
    "jobs": load_jobs_settings,
    "sync": load_sync_settings,
    "retention": load_retention_settings,
    "translation": load_translation_settings,
}

router = APIRouter(prefix="/data", tags=["data"])


@router.get("/sync-meta")
def get_sync_meta_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return get_sync_meta(session)


@router.get("/channels")
def list_channels(
    session: SessionDep,
    _current_user: CurrentUser,
    include_stats: bool = Query(False, alias="includeStats"),
) -> list[dict[str, Any]]:
    return list_channels_impl(session, include_stats=include_stats)


@router.put("/channels/{channel_id}")
def upsert_channel(
    channel_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_channel_impl(session, channel_id, body, user_id=_current_user.id)


@router.post("/channels/bulk-reresolve-start-ids")
async def bulk_reresolve_start_ids_endpoint(
    session: SessionDep,
    _current_user: CurrentUser,
    body: BulkReresolveStartIdsRequest = Body(
        default_factory=BulkReresolveStartIdsRequest
    ),
) -> dict[str, Any]:
    operator_id = _current_user.id or get_operator_user_id(session)
    result = await bulk_reresolve_start_ids(
        session,
        operator_id=operator_id,
        dry_run=body.dry_run,
        limit=body.limit,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return {
        "updated": result.updated,
        "skipped": result.skipped,
        "wouldUpdate": result.would_update,
        "errors": result.errors,
        "deprecated": result.deprecated,
        "message": result.message,
    }


@router.post("/channels/bulk-reset-sync")
async def bulk_reset_sync_endpoint(
    session: SessionDep,
    _current_user: CurrentUser,
    body: BulkResetSyncRequest = Body(...),
) -> dict[str, Any]:
    if not body.confirm:
        raise HTTPException(
            status_code=400,
            detail="Set confirm=true to clear posts and queue sync for selected channels.",
        )
    operator_id = _current_user.id or get_operator_user_id(session)
    result = await bulk_reset_and_queue_sync(
        session,
        operator_id=operator_id,
        channel_ids=body.channel_ids,
        auto_follow_only=body.auto_follow_only,
    )
    return {
        "channelsReset": result.channels_reset,
        "postsDeleted": result.posts_deleted,
        "jobId": result.job_id,
        "errors": result.errors,
    }


@router.delete("/channels/{channel_id}")
def delete_channel(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_channel_impl(session, channel_id)


@router.get("/channels/{channel_id}/stats")
def get_channel_stats(
    channel_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return get_channel_stats_impl(session, channel_id)


@router.get("/posts")
def list_posts(
    session: SessionDep,
    _current_user: CurrentUser,
    channel_names: str | None = Query(None, alias="channelNames"),
    channel_name: str | None = Query(None, alias="channelName"),
    start_date: int | None = Query(None, alias="startDate"),
    end_date: int | None = Query(None, alias="endDate"),
) -> list[dict[str, Any]]:
    names: list[str] = []
    if channel_names:
        names = [n.strip() for n in channel_names.split(",") if n.strip()]
    elif channel_name:
        names = [channel_name]
    return list_posts_impl(
        session,
        channel_names=names or None,
        start_date=start_date,
        end_date=end_date,
    )


@router.post("/posts/bulk")
def bulk_upsert_posts_route(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return bulk_upsert_posts(session, body)


@router.get("/summaries")
def list_summaries(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_summaries_impl(session)


@router.put("/summaries/{summary_id}")
def upsert_summary(
    summary_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = upsert_summary_impl(session, summary_id, body, user_id=_current_user.id)
    touch_sync(session, "summaries")
    return result


@router.delete("/summaries/{summary_id}")
def delete_summary(
    summary_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    delete_summary_impl(session, summary_id)
    touch_sync(session, "summaries")
    return {"status": "deleted"}


@router.get("/bot-credentials")
def list_bot_credentials(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_bot_credentials_impl(session)


@router.put("/bot-credentials/{bot_id}")
def upsert_bot_credential(
    bot_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_bot_credential_impl(session, bot_id, body, user_id=_current_user.id)


@router.delete("/bot-credentials/{bot_id}")
def delete_bot_credential(
    bot_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_bot_credential_impl(session, bot_id)


@router.post("/bot-credentials/migrate")
def migrate_bot_credentials(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return migrate_bot_credentials_impl(session, body, user_id=_current_user.id)


@router.get("/chat-destinations")
def list_chat_destinations(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_chat_destinations_impl(session)


@router.put("/chat-destinations/{dest_id}")
def upsert_chat_destination(
    dest_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return upsert_chat_destination_impl(
        session, dest_id, body, user_id=_current_user.id
    )


@router.delete("/chat-destinations/{dest_id}")
def delete_chat_destination(
    dest_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, str]:
    return delete_chat_destination_impl(session, dest_id)


@router.get("/embeddings")
def list_embeddings(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_embeddings_impl(session)


@router.post("/embeddings")
def upsert_embeddings(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return upsert_embeddings_impl(session, body)


@router.get("/translations")
def list_translations(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_translations_impl(session)


@router.post("/translations")
def upsert_translations(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return upsert_translations_impl(session, body)


@router.get("/publish-logs")
def list_publish_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_publish_logs(session)


@router.post("/publish-logs")
def create_publish_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "publish", body, user_id=_current_user.id)


@router.get("/sync-logs")
def list_sync_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_sync_logs(session)


@router.post("/sync-logs")
def create_sync_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "sync", body, user_id=_current_user.id)


@router.get("/llm-logs")
def list_llm_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_llm_logs(session)


@router.post("/llm-logs")
def create_llm_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "llm", body, user_id=_current_user.id)


@router.get("/embedding-logs")
def list_embedding_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any] | list[dict[str, Any]]:
    return list_embedding_logs(session)


@router.post("/embedding-logs")
def create_embedding_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "embedding", body, user_id=_current_user.id)


@router.get("/network-logs")
def list_network_logs_route(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[dict[str, Any]]:
    return list_network_logs(session)


@router.post("/network-logs")
def create_network_logs(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, int]:
    return create_logs(session, "network", body, user_id=_current_user.id)


@router.get("/stats")
def db_stats(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return get_db_stats(session, operator_id=_current_user.id)


@router.delete("/logs")
def purge_logs(
    session: SessionDep,
    _current_user: CurrentUser,
    older_than_days: int | None = Query(default=None, alias="olderThanDays"),
    log_type: str | None = Query(default=None, alias="type"),
    log_id: str | None = Query(default=None, alias="logId"),
    clear_all: bool = Query(default=False, alias="clearAll"),
) -> dict[str, Any]:
    if older_than_days is not None and older_than_days > 0:
        deleted = delete_old_logs(
            session, older_than_days, operator_id=_current_user.id
        )
        for resource in {LOG_MODELS[k][1] for k in deleted if deleted[k]}:
            touch_sync(session, resource)
        return {"deleted": deleted, "total": sum(deleted.values())}

    if log_type is None:
        raise HTTPException(
            status_code=400,
            detail="Provide olderThanDays, or type with logId/clearAll",
        )
    if log_type not in LOG_MODELS:
        raise HTTPException(status_code=400, detail=f"Unknown log type: {log_type}")

    resource = LOG_MODELS[log_type][1]
    if log_id:
        if not delete_log_by_id(session, log_type, log_id):
            raise HTTPException(status_code=404, detail="Log entry not found")
        touch_sync(session, resource)
        return {"deleted": 1}

    if clear_all:
        count = clear_logs(session, log_type)
        if count:
            touch_sync(session, resource)
        return {"deleted": count}

    raise HTTPException(
        status_code=400,
        detail="Provide logId or clearAll=true with type",
    )


@router.get("/settings/network")
def get_network_settings(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    value = network_settings_payload(
        row.value if row else None,
        owner_user_id=row.user_id if row else _current_user.id,
    )
    return {"key": "network", "value": value}


@router.put("/settings/network")
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    if row:
        row.value = merged
        row.user_id = _current_user.id
        row.updated_at = datetime.utcnow()
    else:
        row = AppSetting(key="network", value=merged, user_id=_current_user.id)
    session.add(row)
    session.commit()
    touch_sync(session, "settings")
    return {
        "key": "network",
        "value": network_settings_payload(merged, owner_user_id=_current_user.id),
    }


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    loader = _SETTING_LOADERS.get(key)
    if loader is not None:
        return {"key": key, "value": loader(session)}
    return get_app_setting(session, key)


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    result = put_app_setting(session, key, body, user_id=_current_user.id)
    touch_sync(session, "settings")
    return result


@router.post("/import")
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return import_data_impl(session, body, user_id=_current_user.id)


@router.get("/export")
def export_data(
    session: SessionDep,
    _current_user: CurrentUser,
) -> dict[str, Any]:
    return export_data_impl(session)
