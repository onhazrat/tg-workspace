"""Server-side channel sync orchestration (backward pagination)."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal

import httpx
from sqlmodel import Session, col, func, select

from app.core.config import settings
from app.core.db import engine
from app.core.request_meter import metered
from app.jobs.settings import (
    compute_scrape_cutoff_ms,
    load_media_settings,
    load_retention_policy,
    load_sync_settings,
)
from app.models_tg import Channel, Post, utc_now
from app.services.async_db import run_db
from app.services.channel_photos import resolve_cached_photo_url
from app.services.channel_setting_groups import (
    SyncOperationMode,
    bulk_assign_setting_group,
    channel_allows_sync_operation,
    get_group_for_channel,
    get_or_create_frozen_group,
    is_restricted_group,
    move_channel_from_restricted_to_default,
    move_channel_to_restricted_group,
)
from app.services.channels import _velocity_from_timestamps, update_channel_coverage
from app.services.followed_channels import (
    create_followed_channel,
    normalize_channel_name,
)
from app.services.language import detect_language_from_posts
from app.services.logs import upsert_network_log, upsert_sync_log
from app.services.network import rotate_tor_identity
from app.services.network_settings import (
    compute_proxy_pool_capacity,
    load_network_settings,
    redact_proxy_url,
    resolve_proxies,
    resolve_proxy_concurrency,
)
from app.services.post_sync_state import (
    record_gaps_from_page,
    record_gaps_to_existing_post,
)
from app.services.post_thumbnails import (
    cache_post_thumb,
    enforce_thumb_cache_size_limit_throttled,
)
from app.services.posts import bulk_upsert_posts_impl
from app.services.quota import charge_sync_job
from app.services.scraper import get_channel_info, scrape_channel_page
from app.services.scraper_jobs import (
    ChannelSyncState,
    SyncJobState,
    acquire_channel,
    deactivate_job,
    persist_job,
    touch_job,
)
from app.services.sync_meta import touch_sync
from app.services.sync_schedule import (
    apply_failure_backoff,
    compute_next_dynamic_sync_at_from_last_updated,
    compute_next_regular_sync_at_from_last_updated,
)
from app.services.telegram_web import (
    TelegramWebViewUnavailable,
    telegram_web_view_channel_url,
)

logger = logging.getLogger(__name__)


def _is_scheduler_auto_sync_source(source: str) -> bool:
    # Import lazily to avoid module import cycles at startup.
    from app.jobs.auto_sync import CHECK_SOURCE

    return source == CHECK_SOURCE


class SyncScrapeError(Exception):
    def __init__(
        self,
        message: str,
        *,
        is_rate_limited: bool = False,
        is_unavailable: bool = False,
        full_request: Any = None,
        full_response: Any = None,
    ) -> None:
        super().__init__(message)
        self.is_rate_limited = is_rate_limited
        self.is_unavailable = is_unavailable
        self.full_request = full_request
        self.full_response = full_response


def _save_network_telemetry(
    session: Session,
    url: str,
    telemetry: Any,
    *,
    user_id: uuid.UUID | None,
    status_code: int = 200,
) -> None:
    logs = telemetry if isinstance(telemetry, list) else [telemetry]
    for t in logs:
        if not t:
            continue
        attempts = t.get("attempts") or []
        proxy_used = attempts[-1].get("proxyUrl") if attempts else None
        upsert_network_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "url": url,
                "method": "GET",
                "status": "success" if t.get("success") else "failed",
                "statusCode": status_code,
                "duration": t.get("totalDuration", 0),
                "timestamp": int(time.time() * 1000),
                "source": "Scraper",
                "proxyUsed": redact_proxy_url(proxy_used),
                "attempts": len(attempts) if attempts else 1,
                "telemetry": t,
            },
            user_id,
        )


def _posts_to_save(
    channel_name: str, posts: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in posts:
        ts = p.get("timestamp")
        if not ts and p.get("date"):
            try:
                dt = datetime.fromisoformat(p["date"].replace("Z", "+00:00"))
                ts = int(dt.timestamp() * 1000)
            except ValueError:
                ts = int(time.time() * 1000)
        out.append(
            {
                "id": p["id"],
                "channelName": channel_name,
                "text": p.get("text", ""),
                "date": p.get("date", ""),
                "timestamp": ts or int(time.time() * 1000),
                "forwardedFrom": p.get("forwardedFrom"),
                "forwardedFromName": p.get("forwardedFromName"),
                "media": p.get("media"),
                "links": p.get("links"),
                "replyToPostId": p.get("replyToPostId"),
                "replyTo": p.get("replyTo"),
            }
        )
    return out


def _existing_post_ids(
    session: Session, channel_name: str, post_ids: list[int]
) -> set[int]:
    if not post_ids:
        return set()
    rows = session.exec(
        select(Post.post_id).where(
            Post.channel_name == channel_name,
            col(Post.post_id).in_(post_ids),
        )
    ).all()
    return set(rows)


async def _scrape_page_with_retry(
    channel_name: str,
    *,
    before_id: int | None,
    known_latest_id: int,
    known_display_name: str | None,
    known_photo_url: str | None,
    proxies: list[str],
    tor_auto_rotate: bool,
    tor_rotation_threshold: int,
    tor_control_enabled: bool,
    tor_control_port: int,
    proxy_concurrency: tuple[int, dict[str, int]],
) -> dict[str, Any]:
    request_body = {
        "url": telegram_web_view_channel_url(channel_name)
        if before_id is None
        else telegram_web_view_channel_url(channel_name, before_id=before_id),
        "beforeId": before_id,
        "knownLatestId": known_latest_id if known_latest_id > 0 else None,
    }

    retry_count = 0
    while True:
        try:
            response = await scrape_channel_page(
                channel_name,
                before_id=before_id,
                known_latest_id=known_latest_id if known_latest_id > 0 else None,
                known_display_name=known_display_name if known_latest_id > 0 else None,
                known_photo_url=known_photo_url if known_latest_id > 0 else None,
                proxies=proxies or None,
                tor_auto_rotate=tor_auto_rotate,
                tor_rotation_threshold=tor_rotation_threshold,
                proxy_concurrency=proxy_concurrency,
            )
            response["fullRequest"] = request_body
            return response
        except Exception as exc:  # noqa: BLE001
            is_rate_limit = (
                isinstance(exc, httpx.HTTPStatusError)
                and exc.response.status_code == 429
            )
            is_network = isinstance(exc, (httpx.HTTPError, ConnectionError, OSError))
            is_unavailable = isinstance(exc, TelegramWebViewUnavailable)

            if is_unavailable:
                raise SyncScrapeError(
                    str(exc),
                    is_unavailable=True,
                    full_request=request_body,
                    full_response={"error": str(exc)},
                ) from exc

            if retry_count < settings.SYNC_MAX_RETRIES and (
                is_rate_limit or is_network
            ):
                if is_rate_limit and tor_control_enabled and proxies:
                    try:
                        await rotate_tor_identity(tor_control_port)
                    except Exception as tor_exc:  # noqa: BLE001
                        logger.error("TOR NEWNYM failed: %s", tor_exc)
                retry_count += 1
                backoff_ms = (2**retry_count) * settings.SYNC_RETRY_BACKOFF_BASE_MS
                logger.info(
                    "Retrying scrape for @%s in %sms (attempt %s/%s)",
                    channel_name,
                    backoff_ms,
                    retry_count,
                    settings.SYNC_MAX_RETRIES,
                )
                await asyncio.sleep(backoff_ms / 1000)
                continue

            raise SyncScrapeError(
                str(exc),
                is_rate_limited=is_rate_limit,
                full_request=request_body,
                full_response={"error": str(exc)},
            ) from exc


# All sync DB work runs in thread-pool workers via run_db(); Session(engine)
# blocks here are sync-only helpers — never held across await I/O in async paths.


def _channel_name_exists(channel_name: str) -> bool:
    with Session(engine) as session:
        return (
            session.exec(
                select(Channel).where(col(Channel.name) == channel_name)
            ).first()
            is not None
        )


async def _maybe_add_forwarded_channel(
    forwarded_name: str,
    *,
    discovered_via: dict[str, Any],
    proxies: list[str],
    tor_auto_rotate: bool,
    tor_rotation_threshold: int,
    user_id: uuid.UUID | None,
    effective_start_time: int,
    proxy_concurrency: tuple[int, dict[str, int]],
) -> None:
    clean = normalize_channel_name(forwarded_name)
    if not clean:
        return
    if await run_db(_channel_name_exists, clean):
        return

    display_name = clean
    photo_url = None
    is_unavailable = False
    telemetry = None
    try:
        info = await get_channel_info(
            clean,
            proxies=proxies or None,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
            proxy_concurrency=proxy_concurrency,
        )
        display_name = info.get("displayName") or clean
        photo_url = info.get("photoUrl")
        is_unavailable = bool(info.get("isUnavailableOnWebView"))
        telemetry = info.get("telemetry")
    except Exception as exc:  # noqa: BLE001
        logger.warning("Auto-follow channel info failed for @%s: %s", clean, exc)

    await run_db(
        create_followed_channel,
        clean,
        display_name=display_name,
        photo_url=photo_url,
        is_unavailable=is_unavailable,
        discovered_via=discovered_via,
        user_id=user_id,
        effective_start_time=effective_start_time,
        telemetry_url=telegram_web_view_channel_url(clean),
        telemetry=telemetry,
    )


@dataclass
class _ChannelSyncCtx:
    channel_id: str
    channel_name: str
    display_name: str | None
    photo_url: str | None
    language: str | None
    auto_follow: bool
    proxies: list[str]
    proxy_concurrency: tuple[int, dict[str, int]]
    tor_auto_rotate: bool
    tor_rotation_threshold: int
    tor_control_enabled: bool
    tor_control_port: int
    retrieval_pass: str
    needs_backfill: bool
    min_stored_post_id: int | None
    scrape_cutoff_ms: int
    effective_start_time: int
    media_settings: dict[str, Any] = field(default_factory=dict)


async def _cache_scraped_post_thumbs(
    channel_name: str,
    posts: list[dict[str, Any]],
    media_settings: dict[str, Any],
    *,
    proxies: list[str] | None = None,
    proxy_concurrency: tuple[int, dict[str, int]] | None = None,
    tor_auto_rotate: bool = False,
    tor_rotation_threshold: int | None = None,
) -> None:
    if not media_settings.get("thumbCacheEnabled", True):
        return
    if not media_settings.get("thumbCacheOnSync", True):
        return

    tasks: list[Any] = []
    for post in posts:
        thumb_url = post.get("_thumbSourceUrl")
        post_id = post.get("id")
        if thumb_url and isinstance(post_id, int):
            # Same proxy lane as the page fetch that produced this URL.
            tasks.append(
                cache_post_thumb(
                    channel_name,
                    post_id,
                    thumb_url,
                    proxies=proxies,
                    proxy_concurrency=proxy_concurrency,
                    tor_auto_rotate=tor_auto_rotate,
                    tor_rotation_threshold=tor_rotation_threshold,
                )
            )
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)

    max_mb = int(media_settings.get("thumbCacheMaxSizeMb") or 2048)
    if max_mb > 0:
        await asyncio.to_thread(enforce_thumb_cache_size_limit_throttled, max_mb)


@dataclass
class _PageApplyResult:
    stop_sync: bool
    break_incremental: bool
    next_before_id: int | None
    posts_saved: int
    latest_id: int
    display_name: str | None
    photo_url: str | None
    forwards: list[dict[str, Any]] = field(default_factory=list)
    sync_failed: bool = False
    sync_error: str | None = None
    # The backward walk paginated past the channel's first post: there is no
    # older history to fetch, whatever the cutoff says.
    reached_channel_start: bool = False


def _prepare_channel_sync(
    channel_id: str,
    user_id: uuid.UUID | None,
    *,
    sync_mode: SyncOperationMode,
) -> tuple[Literal["ok", "missing", "denied"], _ChannelSyncCtx | None, str | None]:
    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        if not channel:
            return "missing", None, None
        group = get_group_for_channel(session, channel)
        if sync_mode != "auto" and not channel_allows_sync_operation(
            group,
            sync_mode,
        ):
            return (
                "denied",
                None,
                (f"Sync not allowed for group '{group.name}' (mode={sync_mode})"),
            )

        effective_user_id = user_id or channel.user_id
        network = load_network_settings(session, effective_user_id)
        # The owner matters here: `compute_scrape_cutoff_ms` below reads
        # `globalStartTimeMode`/`Value`, which ticket 06 made per-User. Passing
        # none would silently scrape from the default cutoff rather than the one
        # this follower asked for.
        sync_settings = load_sync_settings(session, user_id=effective_user_id)
        retention_settings = load_retention_policy(session)
        media_settings = load_media_settings(session)
        scrape_cutoff_ms = compute_scrape_cutoff_ms(sync_settings, retention_settings)
        has_existing_posts = (
            session.exec(
                select(Post.post_id).where(Post.channel_name == channel.name).limit(1)
            ).first()
            is not None
        )
        min_stored_post_id: int | None = None
        if has_existing_posts:
            min_row = session.exec(
                select(func.min(Post.post_id)).where(Post.channel_name == channel.name)
            ).one()
            if min_row is not None:
                min_stored_post_id = int(min_row)

        needs_backfill = has_existing_posts and not channel.history_complete_to_cutoff

        proxy_default, proxy_overrides = resolve_proxy_concurrency(network)
        return (
            "ok",
            _ChannelSyncCtx(
                channel_id=channel.id,
                channel_name=channel.name,
                display_name=channel.display_name,
                photo_url=channel.photo_url,
                language=channel.language,
                auto_follow=bool(group.auto_follow_forwarded),
                proxies=resolve_proxies(network),
                proxy_concurrency=(proxy_default, proxy_overrides),
                tor_auto_rotate=bool(network.get("torAutoRotate")),
                tor_rotation_threshold=int(network.get("torRotationThreshold") or 10),
                tor_control_enabled=bool(network.get("torControlEnabled")),
                tor_control_port=int(
                    network.get("torControlPort")
                    or network.get("torControlPortDefault")
                    or settings.TOR_CONTROL_PORT
                ),
                retrieval_pass="incremental" if has_existing_posts else "initial",
                needs_backfill=needs_backfill,
                min_stored_post_id=min_stored_post_id,
                scrape_cutoff_ms=scrape_cutoff_ms,
                effective_start_time=scrape_cutoff_ms,
                media_settings=media_settings,
            ),
            None,
        )


def _freeze_channel_for_chat_id_problem(
    session: Session,
    channel: Channel,
    *,
    error: str,
    response: dict[str, Any],
    job_source: str,
    user_id: uuid.UUID | None,
    channel_owner_id: uuid.UUID | None,
) -> None:
    """Park a channel in the Frozen group and record why.

    Shared by both chat-id failures below. Freezing rather than deleting or
    silently continuing is the point: a chat-id problem means we may be about to
    write another channel's posts into this one, and that is not something to
    resolve automatically.
    """
    freeze_group = get_or_create_frozen_group(session, user_id=channel_owner_id)
    bulk_assign_setting_group(
        session,
        channel_ids=[channel.id],
        setting_group_id=freeze_group.id,
        operator_id=channel_owner_id,
    )
    upsert_sync_log(
        session,
        {
            "id": str(uuid.uuid4()),
            "channelName": channel.name,
            "status": "failed",
            "postsCount": 0,
            "error": error,
            "timestamp": int(time.time() * 1000),
            "source": job_source,
            "fullRequest": response.get("fullRequest"),
            "fullResponse": response,
        },
        user_id,
    )
    touch_sync(session, "channels", commit=False)
    touch_sync(session, "sync_logs", commit=False)
    session.commit()


def _reconcile_telegram_chat_id(
    session: Session,
    channel: Channel,
    scraped_chat_id: int | None,
    *,
    response: dict[str, Any],
    job_source: str,
    user_id: uuid.UUID | None,
) -> str | None:
    """Bind or verify the channel's Telegram chat id.

    Handles are re-usable; chat ids are not. Three cases:

    * **Not yet known** — adopt the scraped id, unless another of this operator's
      channels already claims it. That collision means two handles resolve to one
      chat, so both are suspect and this one is frozen.
    * **Known and matching** — nothing to do.
    * **Known and different** — the handle now points at a different chat.
      Continuing would file the new chat's posts under the old channel's history,
      so the channel is frozen and the sync stops.

    Returns the error string when the sync must stop, `None` otherwise.
    """
    if scraped_chat_id is None:
        return None

    channel_owner_id = user_id or channel.user_id

    if channel.telegram_chat_id is None:
        duplicate_stmt = select(Channel).where(
            Channel.id != channel.id,
            Channel.telegram_chat_id == scraped_chat_id,
        )
        if channel_owner_id is None:
            duplicate_stmt = duplicate_stmt.where(col(Channel.user_id).is_(None))
        else:
            duplicate_stmt = duplicate_stmt.where(Channel.user_id == channel_owner_id)
        duplicate_channel = session.exec(duplicate_stmt).first()

        if duplicate_channel is None:
            channel.telegram_chat_id = scraped_chat_id
            session.add(channel)
            return None

        _freeze_channel_for_chat_id_problem(
            session,
            channel,
            error=(
                "Sync chat ID conflict: scraped "
                f"{scraped_chat_id} for @{channel.name}, already used by "
                f"@{duplicate_channel.name}. Channel moved to Frozen group."
            ),
            response=response,
            job_source=job_source,
            user_id=user_id,
            channel_owner_id=channel_owner_id,
        )
        # Deliberately not a stop: the conflict is logged and the channel frozen,
        # but this page is still applied. Matches the behaviour before H1.
        return None

    if channel.telegram_chat_id == scraped_chat_id:
        return None

    mismatch_error = (
        "Sync chat ID mismatch: stored "
        f"{channel.telegram_chat_id}, scraped {scraped_chat_id} for "
        f"@{channel.name}. Channel moved to Frozen group."
    )
    _freeze_channel_for_chat_id_problem(
        session,
        channel,
        error=mismatch_error,
        response=response,
        job_source=job_source,
        user_id=user_id,
        channel_owner_id=channel_owner_id,
    )
    return mismatch_error


#: Scrape-response field -> `Channel` column, for the metadata refresh.
_CHANNEL_META_FIELDS: tuple[tuple[str, str], ...] = (
    ("displayName", "display_name"),
    ("photoUrl", "photo_url"),
    ("bio", "bio"),
    ("subscribers", "subscribers"),
    ("photos", "photos"),
    ("videos", "videos"),
    ("files", "files"),
    ("links", "links"),
)


def _refresh_channel_meta(
    channel: Channel, response: dict[str, Any], result: _PageApplyResult
) -> None:
    """Copy the page's channel metadata onto the row.

    Only truthy values overwrite: a page that omits a counter must not blank a
    value we already have.
    """
    for field_name, attr in _CHANNEL_META_FIELDS:
        val = response.get(field_name)
        if val and getattr(channel, attr) != val:
            setattr(channel, attr, val)
        if field_name == "displayName" and val:
            result.display_name = val
        if field_name == "photoUrl" and val:
            result.photo_url = val


def _collect_new_forwards(
    session: Session, channel: Channel, posts_to_save: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Forwarded-from handles on this page that we do not already follow.

    Returned rather than followed here: auto-follow is a decision for the caller,
    and creating channels mid-page would change the set this very loop reads.
    """
    known_names = {c.name.lower() for c in session.exec(select(Channel)).all()}
    found: list[dict[str, Any]] = []
    for p in posts_to_save:
        fwd = p.get("forwardedFrom")
        if not fwd:
            continue
        clean_fwd = fwd.strip().replace("@", "").split("/")[-1]
        if clean_fwd and clean_fwd.lower() not in known_names:
            known_names.add(clean_fwd.lower())
            found.append(
                {
                    "name": clean_fwd,
                    "discoveredVia": {
                        "channelName": channel.name,
                        "postId": p["id"],
                        "timestamp": p["timestamp"],
                    },
                }
            )
    return found


def _decide_next_page(
    response: dict[str, Any], before_id: int | None, result: _PageApplyResult
) -> None:
    """Set the next `before_id`, or stop.

    Stops when the response offers no next id, and also when it offers one that
    is not strictly older than the current cursor — that would page forwards or
    stand still, which is how a backward walk turns into an infinite loop.
    """
    next_before = response.get("nextBeforeId")
    if next_before is None:
        result.stop_sync = True
    elif before_id is not None and next_before >= before_id:
        result.stop_sync = True
    else:
        result.next_before_id = next_before


def _persist_page_posts(
    session: Session,
    ctx: _ChannelSyncCtx,
    channel: Channel,
    posts: list[dict[str, Any]],
    page_ids: list[int],
    result: _PageApplyResult,
    *,
    job_id: str,
    job_source: str,
    user_id: uuid.UUID | None,
    session_seen_ids: set[int],
) -> None:
    """Save the page's new posts, and decide whether an incremental pass is done.

    Posts we already hold are dropped rather than re-upserted: on the
    `incremental` and `backfill` passes the overlap is the *expected* case, and
    rewriting those rows would churn `retrieval_*` provenance for no gain.

    Meeting stored posts on an incremental pass is the normal stop condition —
    we have caught up. Any genuinely new ids on that same page sit *above* the
    stored history, so the span between them and the newest stored post is
    recorded as a gap before stopping; otherwise a channel that gained posts
    while we were away would leave a hole nothing ever revisits.
    """
    existing_on_page = _existing_post_ids(session, channel.name, page_ids)
    new_on_page = [pid for pid in page_ids if pid not in existing_on_page]

    if ctx.retrieval_pass == "incremental" and existing_on_page:
        if new_on_page:
            record_gaps_to_existing_post(
                session,
                channel.name,
                new_on_page,
                min(existing_on_page),
                job_id=job_id,
                user_id=user_id,
                session_seen_ids=session_seen_ids,
            )
        result.stop_sync = True
        result.break_incremental = True

    posts_to_save = _posts_to_save(channel.name, posts)
    if ctx.retrieval_pass in ("incremental", "backfill") and existing_on_page:
        posts_to_save = [p for p in posts_to_save if p["id"] not in existing_on_page]

    if not posts_to_save:
        return

    bulk_upsert_posts_impl(
        posts_to_save,
        session,
        retrieval_job_id=job_id,
        retrieval_pass=ctx.retrieval_pass,
        retrieval_source=job_source,
    )
    touch_sync(session, "posts", commit=False)
    session.commit()
    result.posts_saved = len(posts_to_save)

    if ctx.auto_follow:
        result.forwards.extend(_collect_new_forwards(session, channel, posts_to_save))


def _apply_scrape_page(
    ctx: _ChannelSyncCtx,
    response: dict[str, Any],
    *,
    job_id: str,
    job_source: str,
    user_id: uuid.UUID | None,
    session_seen_ids: set[int],
    before_id: int | None,
) -> _PageApplyResult:
    """Apply one scraped page to the database.

    The stages, in order: record telemetry, reconcile the chat id, refresh
    channel metadata, record gaps, persist new posts, collect auto-follow
    candidates, and decide whether to fetch another page. Each is its own
    function above; this one is the sequence and the early exits.
    """
    result = _PageApplyResult(
        stop_sync=False,
        break_incremental=False,
        next_before_id=None,
        posts_saved=0,
        latest_id=0,
        display_name=ctx.display_name,
        photo_url=ctx.photo_url,
    )

    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        if not channel:
            result.stop_sync = True
            return result

        scrape_url = response.get("fullRequest", {}).get("url", "")
        if response.get("telemetry"):
            _save_network_telemetry(
                session,
                scrape_url,
                response["telemetry"],
                user_id=user_id,
            )
            touch_sync(session, "network_logs", commit=False)
            session.commit()

        posts = response.get("posts") or []
        latest_id = int(response.get("latestId") or 0)
        scraped_chat_id_raw = response.get("telegramChatId")
        scraped_chat_id = (
            int(scraped_chat_id_raw) if isinstance(scraped_chat_id_raw, int) else None
        )
        result.latest_id = latest_id

        chat_id_error = _reconcile_telegram_chat_id(
            session,
            channel,
            scraped_chat_id,
            response=response,
            job_source=job_source,
            user_id=user_id,
        )
        if chat_id_error is not None:
            result.stop_sync = True
            result.sync_failed = True
            result.sync_error = chat_id_error
            return result

        _refresh_channel_meta(channel, response, result)

        page_ids = [p["id"] for p in posts]
        record_gaps_from_page(
            session,
            channel.name,
            page_ids,
            job_id=job_id,
            user_id=user_id,
            session_seen_ids=session_seen_ids,
        )

        if not posts:
            result.stop_sync = True
            # An empty page while walking backward means we paginated past the
            # channel's first post. `before_id is not None` keeps a private or
            # empty channel -- whose very first page is blank -- from claiming
            # it reached its own start.
            if ctx.retrieval_pass in ("initial", "backfill") and before_id is not None:
                result.reached_channel_start = True
            session.commit()
            return result

        _persist_page_posts(
            session,
            ctx,
            channel,
            posts,
            page_ids,
            result,
            job_id=job_id,
            job_source=job_source,
            user_id=user_id,
            session_seen_ids=session_seen_ids,
        )

        if result.break_incremental:
            session.commit()
            return result

        oldest_ts = min((p.get("timestamp") or 0 for p in posts), default=0)
        if (
            ctx.retrieval_pass in ("initial", "backfill")
            and ctx.scrape_cutoff_ms > 0
            and oldest_ts < ctx.scrape_cutoff_ms
        ):
            result.stop_sync = True
            session.commit()
            return result

        _decide_next_page(response, before_id, result)

        session.commit()
        return result


def _finalize_channel_success(
    ctx: _ChannelSyncCtx,
    *,
    job: SyncJobState,
    user_id: uuid.UUID | None,
    total_new_posts: int,
    final_latest_id: int,
    requests_log: list[Any],
    responses_log: list[Any],
    reached_channel_start: bool = False,
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        if not channel:
            return

        group = get_group_for_channel(session, channel)
        was_restricted = is_restricted_group(group)
        update_channel_coverage(
            session,
            channel,
            ctx.scrape_cutoff_ms,
            reached_channel_start=reached_channel_start,
        )

        detected_language = channel.language or ctx.language
        if not detected_language:
            recent = session.exec(
                select(Post)
                .where(Post.channel_name == channel.name)
                .order_by(col(Post.post_id).desc())
                .limit(20)
            ).all()
            if recent:
                lang = detect_language_from_posts(
                    [
                        {
                            "text": p.text,
                            "id": p.post_id,
                            "channelName": p.channel_name,
                            "timestamp": p.timestamp,
                        }
                        for p in recent
                    ]
                )
                if lang:
                    detected_language = lang

        now = int(time.time() * 1000)
        channel.last_updated = now
        channel.language = detected_language
        if group.regular_sync_enabled:
            channel.next_regular_sync_at = (
                compute_next_regular_sync_at_from_last_updated(
                    channel.last_updated,
                    group.auto_sync_interval_minutes,
                    now,
                )
            )
        else:
            channel.next_regular_sync_at = None

        if group.dynamic_sync_enabled:
            recent_timestamps = list(
                session.exec(
                    select(Post.timestamp)
                    .where(Post.channel_name == channel.name, Post.timestamp > 0)
                    .order_by(col(Post.timestamp).desc())
                    .limit(100)
                ).all()
            )
            recent_timestamps.sort()
            has_posts = bool(recent_timestamps)
            velocity = _velocity_from_timestamps(recent_timestamps)
            if not has_posts:
                channel.next_dynamic_sync_at = None
            elif velocity > 0:
                channel.next_dynamic_sync_at = (
                    compute_next_dynamic_sync_at_from_last_updated(
                        channel.last_updated,
                        group.dynamic_sync_expected_posts,
                        velocity,
                        now,
                    )
                )
        else:
            channel.next_dynamic_sync_at = None

        channel.updated_at = utc_now()
        session.add(channel)
        if was_restricted:
            move_channel_from_restricted_to_default(
                session,
                channel,
                user_id=user_id or channel.user_id,
            )
        touch_sync(session, "channels", commit=False)
        session.commit()

        upsert_sync_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "channelName": channel.name,
                "status": "success",
                "postsCount": total_new_posts,
                "newLatestId": final_latest_id or None,
                "timestamp": now,
                "source": job.source,
                "fullRequest": requests_log,
                "fullResponse": responses_log,
            },
            user_id,
        )
        touch_sync(session, "sync_logs", commit=False)
        session.commit()


def _finalize_channel_scrape_error(
    ctx: _ChannelSyncCtx,
    exc: SyncScrapeError,
    *,
    job: SyncJobState,
    user_id: uuid.UUID | None,
    total_new_posts: int,
    requests_log: list[Any],
    responses_log: list[Any],
    due_reason: str | None,
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        if not channel:
            return

        if exc.is_unavailable:
            move_channel_to_restricted_group(
                session,
                channel,
                user_id=user_id or channel.user_id,
            )
            touch_sync(session, "channels", commit=False)
            session.commit()

        if _is_scheduler_auto_sync_source(job.source) and due_reason:
            sync_settings = load_sync_settings(session)
            apply_failure_backoff(
                channel,
                int(time.time() * 1000),
                due_reason,
                int(sync_settings.get("syncFailureBackoffMinutes") or 5),
            )
            channel.updated_at = utc_now()
            session.add(channel)
            touch_sync(session, "channels", commit=False)
            session.commit()

        upsert_sync_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "channelName": channel.name,
                "status": "failed",
                "postsCount": total_new_posts,
                "error": str(exc),
                "timestamp": int(time.time() * 1000),
                "source": job.source,
                "fullRequest": requests_log,
                "fullResponse": responses_log,
            },
            user_id,
        )
        touch_sync(session, "sync_logs", commit=False)
        session.commit()


def _finalize_channel_error(
    ctx: _ChannelSyncCtx,
    error: str,
    *,
    job: SyncJobState,
    user_id: uuid.UUID | None,
    total_new_posts: int,
    requests_log: list[Any],
    responses_log: list[Any],
    due_reason: str | None,
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        channel_name = channel.name if channel else ctx.channel_name
        if channel and _is_scheduler_auto_sync_source(job.source) and due_reason:
            sync_settings = load_sync_settings(session)
            apply_failure_backoff(
                channel,
                int(time.time() * 1000),
                due_reason,
                int(sync_settings.get("syncFailureBackoffMinutes") or 5),
            )
            channel.updated_at = utc_now()
            session.add(channel)
            touch_sync(session, "channels", commit=False)
            session.commit()
        upsert_sync_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "channelName": channel_name,
                "status": "failed",
                "postsCount": total_new_posts,
                "error": error,
                "timestamp": int(time.time() * 1000),
                "source": job.source,
                "fullRequest": requests_log,
                "fullResponse": responses_log,
            },
            user_id,
        )
        touch_sync(session, "sync_logs", commit=False)
        session.commit()


@dataclass
class _ChannelWalk:
    """Accumulated state of one channel's backward walk.

    Owned by `sync_single_channel` and mutated by `_walk_channel_pages`, so the
    error handlers can still read `requests_log` / `responses_log` when the walk
    raises part-way through — which is precisely when those logs matter.
    """

    total_new_posts: int = 0
    final_latest_id: int = 0
    reached_channel_start: bool = False
    requests_log: list[Any] = field(default_factory=list)
    responses_log: list[Any] = field(default_factory=list)
    #: Set when a page reports a chat-id mismatch: the sync stops and the
    #: channel is reported failed, without going through success finalisation.
    failed_error: str | None = None


async def _fetch_one_page(
    ctx: _ChannelSyncCtx,
    *,
    before_id: int | None,
    known_latest_id: int,
) -> dict[str, Any]:
    """Scrape one page and resolve the media it references.

    Photo and thumbnail caching happen here rather than in `_apply_scrape_page`
    because they are network work, and that function runs on the database thread.
    """
    response = await _scrape_page_with_retry(
        ctx.channel_name,
        before_id=before_id,
        known_latest_id=known_latest_id,
        known_display_name=ctx.display_name,
        known_photo_url=ctx.photo_url,
        proxies=ctx.proxies,
        tor_auto_rotate=ctx.tor_auto_rotate,
        tor_rotation_threshold=ctx.tor_rotation_threshold,
        tor_control_enabled=ctx.tor_control_enabled,
        tor_control_port=ctx.tor_control_port,
        proxy_concurrency=ctx.proxy_concurrency,
    )

    response["photoUrl"] = await resolve_cached_photo_url(
        ctx.channel_id,
        response.get("photoUrl") or None,
    )

    await _cache_scraped_post_thumbs(
        ctx.channel_name,
        response.get("posts") or [],
        ctx.media_settings,
        proxies=ctx.proxies,
        proxy_concurrency=ctx.proxy_concurrency,
        tor_auto_rotate=ctx.tor_auto_rotate,
        tor_rotation_threshold=ctx.tor_rotation_threshold,
    )
    return response


async def _walk_channel_pages(
    job: SyncJobState,
    ch_state: ChannelSyncState,
    ctx: _ChannelSyncCtx,
    walk: _ChannelWalk,
    *,
    user_id: uuid.UUID | None,
) -> None:
    """Page backwards through a channel until a stop condition fires.

    Stops on: the scraper reporting no next page, the per-channel iteration cap,
    job cancellation, an incremental pass meeting posts we already hold, the
    scrape cutoff, or a chat-id mismatch.

    The `needs_backfill` transition appears twice on purpose. An incremental pass
    can finish either by *meeting* stored posts (`break_incremental`) or by
    simply running out of new ones (`stop_sync`), and a channel with a gap below
    its stored history has to switch to the backfill pass in both cases.
    """
    known_latest_id = 0
    before_id: int | None = None
    iterations = 0
    stop_sync = False
    in_backfill = False
    session_seen_ids: set[int] = set()

    def enter_backfill() -> int | None:
        nonlocal in_backfill
        in_backfill = True
        ctx.retrieval_pass = "backfill"
        return ctx.min_stored_post_id

    while not stop_sync and not job.cancel_event.is_set():
        if iterations >= settings.SCRAPER_ITERATION_LIMIT:
            break
        iterations += 1

        response = await _fetch_one_page(
            ctx, before_id=before_id, known_latest_id=known_latest_id
        )

        if response.get("fullRequest"):
            walk.requests_log.append(response["fullRequest"])
        walk.responses_log.append(response)

        page_result = await run_db(
            _apply_scrape_page,
            ctx,
            response,
            job_id=job.job_id,
            job_source=job.source,
            user_id=user_id,
            session_seen_ids=session_seen_ids,
            before_id=before_id,
        )

        if page_result.reached_channel_start:
            walk.reached_channel_start = True
        if page_result.latest_id:
            walk.final_latest_id = page_result.latest_id
            known_latest_id = page_result.latest_id
        if page_result.display_name:
            ctx.display_name = page_result.display_name
        if page_result.photo_url:
            ctx.photo_url = page_result.photo_url

        if page_result.posts_saved:
            walk.total_new_posts += page_result.posts_saved
            ch_state.posts_fetched = walk.total_new_posts
            await touch_job(job, ch_state)

            for fwd in page_result.forwards:
                await _maybe_add_forwarded_channel(
                    fwd["name"],
                    discovered_via=fwd["discoveredVia"],
                    proxies=ctx.proxies,
                    tor_auto_rotate=ctx.tor_auto_rotate,
                    tor_rotation_threshold=ctx.tor_rotation_threshold,
                    user_id=user_id,
                    effective_start_time=ctx.effective_start_time,
                    proxy_concurrency=ctx.proxy_concurrency,
                )

        if page_result.break_incremental:
            if ctx.needs_backfill and not in_backfill:
                before_id = enter_backfill()
                continue
            break

        stop_sync = page_result.stop_sync
        if page_result.sync_failed:
            walk.failed_error = page_result.sync_error
            return
        if stop_sync and ctx.needs_backfill and not in_backfill:
            before_id = enter_backfill()
            stop_sync = False
            continue

        before_id = page_result.next_before_id


async def sync_single_channel(
    job: SyncJobState,
    ch_state: ChannelSyncState,
    *,
    user_id: uuid.UUID | None,
) -> None:
    """Sync one channel: guard, prepare, walk its pages, finalise.

    Everything specific to *how* pages are walked lives in
    `_walk_channel_pages`; this function owns the channel lock, the cancellation
    checks, and deciding which of the three finalisers runs.
    """
    if job.cancel_event.is_set():
        ch_state.status = "cancelled"
        await touch_job(job, ch_state)
        return

    lock = acquire_channel(ch_state.channel_name)
    async with lock:
        if job.cancel_event.is_set():
            ch_state.status = "cancelled"
            await touch_job(job, ch_state)
            return

        ch_state.status = "running"
        await touch_job(job, ch_state)

        prep_status, ctx, deny_reason = await run_db(
            _prepare_channel_sync,
            ch_state.channel_id,
            user_id,
            sync_mode=job.sync_mode,
        )
        if prep_status == "missing":
            ch_state.status = "failed"
            ch_state.error = "Channel not found"
            await touch_job(job, ch_state)
            return
        if prep_status == "denied" or ctx is None:
            ch_state.status = "skipped"
            ch_state.error = deny_reason or "Sync not allowed for this channel"
            await touch_job(job, ch_state)
            return

        walk = _ChannelWalk()
        due_reason = (
            ch_state.metadata.get("dueReason")
            if isinstance(ch_state.metadata, dict)
            else None
        )

        try:
            await _walk_channel_pages(job, ch_state, ctx, walk, user_id=user_id)

            if walk.failed_error is not None:
                ch_state.status = "failed"
                ch_state.error = walk.failed_error
                ch_state.posts_fetched = walk.total_new_posts
                await touch_job(job, ch_state)
                return

            await run_db(
                _finalize_channel_success,
                ctx,
                job=job,
                user_id=user_id,
                total_new_posts=walk.total_new_posts,
                final_latest_id=walk.final_latest_id,
                requests_log=walk.requests_log,
                responses_log=walk.responses_log,
                reached_channel_start=walk.reached_channel_start,
            )
            ch_state.status = "success"
            ch_state.new_latest_id = walk.final_latest_id or None
            await touch_job(job, ch_state)

        except SyncScrapeError as exc:
            await run_db(
                _finalize_channel_scrape_error,
                ctx,
                exc,
                job=job,
                user_id=user_id,
                total_new_posts=walk.total_new_posts,
                requests_log=walk.requests_log,
                responses_log=walk.responses_log,
                due_reason=due_reason,
            )
            ch_state.status = "failed"
            ch_state.error = str(exc)
            ch_state.posts_fetched = walk.total_new_posts
            await touch_job(job, ch_state)

        except Exception as exc:  # noqa: BLE001
            logger.exception("Sync failed for @%s", ch_state.channel_name)
            await run_db(
                _finalize_channel_error,
                ctx,
                str(exc),
                job=job,
                user_id=user_id,
                total_new_posts=walk.total_new_posts,
                requests_log=walk.requests_log,
                responses_log=walk.responses_log,
                due_reason=due_reason,
            )
            ch_state.status = "failed"
            ch_state.error = str(exc)
            ch_state.posts_fetched = walk.total_new_posts
            await touch_job(job, ch_state)


def _load_sync_job_concurrency(user_id: uuid.UUID | None) -> tuple[int, int | None]:
    with Session(engine) as session:
        sync_settings = load_sync_settings(session)
        network = load_network_settings(session, user_id)
        configured = max(
            1,
            int(
                sync_settings.get("syncConcurrency")
                or settings.SYNC_CONCURRENCY_DEFAULT
            ),
        )
        proxies = resolve_proxies(network)
        if not proxies:
            return configured, None
        default_slots, overrides = resolve_proxy_concurrency(network)
        capacity = compute_proxy_pool_capacity(proxies, default_slots, overrides)
        return min(configured, capacity), capacity


async def run_sync_job(job: SyncJobState, user_id: uuid.UUID | None) -> None:
    """Sync every Channel in the job, then charge what it spent (ticket 08).

    The meter is opened here and read once at the end — decision 19's "account
    at completion", charging the Requests the job actually made rather than the
    guess an enqueue-time charge would have to use. `asyncio` copies the context
    into the per-channel tasks below, so every fetch underneath finds this
    meter, and a second job running beside this one increments its own.

    A cancelled job is still charged for what it spent before the cancel. Those
    Requests were made, and Telegram answered them.

    The charge is the last thing that happens and cannot fail the job:
    `charge_sync_job` swallows and logs its own errors, because an accounting
    write nobody reads yet must not turn a completed sync into a failed one.
    """
    with metered() as meter:
        job.status = "running"
        await touch_job(job)
        concurrency, _proxy_capacity = await run_db(_load_sync_job_concurrency, user_id)

        sem = asyncio.Semaphore(concurrency)

        async def _run_one(ch_state: ChannelSyncState) -> None:
            async with sem:
                if job.cancel_event.is_set():
                    ch_state.status = "cancelled"
                    return
                await sync_single_channel(job, ch_state, user_id=user_id)

        try:
            await asyncio.gather(*[_run_one(ch) for ch in job.channels.values()])

            if job.cancel_event.is_set():
                job.status = "cancelled"
            elif all(c.status in ("success", "skipped") for c in job.channels.values()):
                job.status = "completed"
            elif any(c.status == "success" for c in job.channels.values()):
                job.status = "completed"
            else:
                job.status = "failed"

            job.finished_at = int(time.time() * 1000)
            await persist_job(job)
            deactivate_job(job.job_id)
        finally:
            # In `finally` so a job that dies part-way is still charged for the
            # pages it fetched first. The alternative rewards a crash.
            await run_db(
                charge_sync_job, user_id, job.sync_mode, meter.telegram_requests
            )
