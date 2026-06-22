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
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import (
    compute_scrape_cutoff_ms,
    load_retention_settings,
    load_sync_settings,
)
from app.models_tg import Channel, Post
from app.services.async_db import run_db
from app.services.channels import update_channel_coverage
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
from app.services.posts import bulk_upsert_posts_impl
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

logger = logging.getLogger(__name__)


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
        "url": f"https://t.me/s/{channel_name}"
        if before_id is None
        else f"https://t.me/s/{channel_name}?before={before_id}",
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
            is_network = isinstance(
                exc, (httpx.HTTPError, ConnectionError, OSError)
            ) or ("not available on the web view" in str(exc))
            is_unavailable = "not available on the web view" in str(exc)

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


def _create_forwarded_channel(
    clean: str,
    *,
    display_name: str,
    photo_url: str | None,
    is_unavailable: bool,
    discovered_via: dict[str, Any],
    user_id: uuid.UUID | None,
    effective_start_time: int,
    telemetry_url: str | None,
    telemetry: Any,
) -> None:
    with Session(engine) as session:
        if session.exec(select(Channel).where(col(Channel.name) == clean)).first():
            return
        if telemetry_url and telemetry:
            _save_network_telemetry(session, telemetry_url, telemetry, user_id=user_id)
        now = int(time.time() * 1000)
        session.add(
            Channel(
                id=clean,
                name=clean,
                display_name=display_name,
                photo_url=photo_url,
                start_time=effective_start_time,
                last_updated=now,
                followed_at=now,
                tags=[],
                is_frozen=is_unavailable,
                is_unavailable_on_web_view=is_unavailable,
                discovered_via=discovered_via,
                user_id=user_id,
            )
        )
        session.commit()
        touch_sync(session, "channels")


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
    clean = forwarded_name.strip().replace("@", "").split("/")[-1]
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
        _create_forwarded_channel,
        clean,
        display_name=display_name,
        photo_url=photo_url,
        is_unavailable=is_unavailable,
        discovered_via=discovered_via,
        user_id=user_id,
        effective_start_time=effective_start_time,
        telemetry_url=f"https://t.me/s/{clean}",
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
    scrape_cutoff_ms: int
    effective_start_time: int


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


def _prepare_channel_sync(
    channel_id: str, user_id: uuid.UUID | None
) -> tuple[Literal["ok", "missing", "frozen"], _ChannelSyncCtx | None]:
    with Session(engine) as session:
        channel = session.get(Channel, channel_id)
        if not channel:
            return "missing", None
        if channel.is_frozen:
            return "frozen", None

        effective_user_id = user_id or channel.user_id
        network = load_network_settings(session, effective_user_id)
        sync_settings = load_sync_settings(session)
        retention_settings = load_retention_settings(session)
        scrape_cutoff_ms = compute_scrape_cutoff_ms(sync_settings, retention_settings)
        has_existing_posts = (
            session.exec(
                select(Post.post_id).where(Post.channel_name == channel.name).limit(1)
            ).first()
            is not None
        )

        proxy_default, proxy_overrides = resolve_proxy_concurrency(network)
        return "ok", _ChannelSyncCtx(
            channel_id=channel.id,
            channel_name=channel.name,
            display_name=channel.display_name,
            photo_url=channel.photo_url,
            language=channel.language,
            auto_follow=bool(channel.auto_follow_forwarded),
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
            scrape_cutoff_ms=scrape_cutoff_ms,
            effective_start_time=scrape_cutoff_ms,
        )


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
            session.commit()
            touch_sync(session, "network_logs")

        posts = response.get("posts") or []
        latest_id = int(response.get("latestId") or 0)
        result.latest_id = latest_id

        for field, attr in (
            ("displayName", "display_name"),
            ("photoUrl", "photo_url"),
            ("bio", "bio"),
            ("subscribers", "subscribers"),
            ("photos", "photos"),
            ("videos", "videos"),
            ("files", "files"),
            ("links", "links"),
        ):
            val = response.get(field)
            if val and getattr(channel, attr) != val:
                setattr(channel, attr, val)
            if field == "displayName" and val:
                result.display_name = val
            if field == "photoUrl" and val:
                result.photo_url = val

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
            session.commit()
            return result

        existing_on_page = _existing_post_ids(session, channel.name, page_ids)
        new_on_page = [pid for pid in page_ids if pid not in existing_on_page]

        if ctx.retrieval_pass == "incremental" and existing_on_page:
            if new_on_page:
                anchor_existing = min(existing_on_page)
                record_gaps_to_existing_post(
                    session,
                    channel.name,
                    new_on_page,
                    anchor_existing,
                    job_id=job_id,
                    user_id=user_id,
                    session_seen_ids=session_seen_ids,
                )
            result.stop_sync = True
            result.break_incremental = True

        posts_to_save = _posts_to_save(channel.name, posts)
        if ctx.retrieval_pass == "incremental" and existing_on_page:
            posts_to_save = [
                p for p in posts_to_save if p["id"] not in existing_on_page
            ]

        if posts_to_save:
            bulk_upsert_posts_impl(
                posts_to_save,
                session,
                retrieval_job_id=job_id,
                retrieval_pass=ctx.retrieval_pass,
                retrieval_source=job_source,
            )
            session.commit()
            touch_sync(session, "posts")
            result.posts_saved = len(posts_to_save)

            if ctx.auto_follow:
                known_names = {
                    c.name.lower() for c in session.exec(select(Channel)).all()
                }
                for p in posts_to_save:
                    fwd = p.get("forwardedFrom")
                    if not fwd:
                        continue
                    clean_fwd = fwd.strip().replace("@", "").split("/")[-1]
                    if clean_fwd and clean_fwd.lower() not in known_names:
                        known_names.add(clean_fwd.lower())
                        result.forwards.append(
                            {
                                "name": clean_fwd,
                                "discoveredVia": {
                                    "channelName": channel.name,
                                    "postId": p["id"],
                                    "timestamp": p["timestamp"],
                                },
                            }
                        )

        if result.break_incremental:
            session.commit()
            return result

        oldest_ts = min((p.get("timestamp") or 0 for p in posts), default=0)
        if (
            ctx.retrieval_pass == "initial"
            and ctx.scrape_cutoff_ms > 0
            and oldest_ts < ctx.scrape_cutoff_ms
        ):
            result.stop_sync = True
            session.commit()
            return result

        next_before = response.get("nextBeforeId")
        if next_before is None:
            result.stop_sync = True
        elif before_id is not None and next_before >= before_id:
            result.stop_sync = True
        else:
            result.next_before_id = next_before

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
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        if not channel:
            return

        update_channel_coverage(session, channel, ctx.scrape_cutoff_ms)

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
        channel.updated_at = datetime.utcnow()
        session.add(channel)
        session.commit()
        touch_sync(session, "channels")

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
        session.commit()
        touch_sync(session, "sync_logs")


def _finalize_channel_scrape_error(
    ctx: _ChannelSyncCtx,
    exc: SyncScrapeError,
    *,
    job: SyncJobState,
    user_id: uuid.UUID | None,
    total_new_posts: int,
    requests_log: list[Any],
    responses_log: list[Any],
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        if not channel:
            return

        if exc.is_unavailable:
            channel.is_frozen = True
            channel.is_unavailable_on_web_view = True
            channel.updated_at = datetime.utcnow()
            session.add(channel)
            session.commit()
            touch_sync(session, "channels")

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
        session.commit()
        touch_sync(session, "sync_logs")


def _finalize_channel_error(
    ctx: _ChannelSyncCtx,
    error: str,
    *,
    job: SyncJobState,
    user_id: uuid.UUID | None,
    total_new_posts: int,
    requests_log: list[Any],
    responses_log: list[Any],
) -> None:
    with Session(engine) as session:
        channel = session.get(Channel, ctx.channel_id)
        channel_name = channel.name if channel else ctx.channel_name
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
        session.commit()
        touch_sync(session, "sync_logs")


async def sync_single_channel(
    job: SyncJobState,
    ch_state: ChannelSyncState,
    *,
    user_id: uuid.UUID | None,
) -> None:
    if job.cancel_event.is_set():
        ch_state.status = "cancelled"
        await touch_job(job)
        return

    lock = acquire_channel(ch_state.channel_name)
    async with lock:
        if job.cancel_event.is_set():
            ch_state.status = "cancelled"
            await touch_job(job)
            return

        ch_state.status = "running"
        await touch_job(job)

        prep_status, ctx = await run_db(
            _prepare_channel_sync, ch_state.channel_id, user_id
        )
        if prep_status == "missing":
            ch_state.status = "failed"
            ch_state.error = "Channel not found"
            await touch_job(job)
            return
        if prep_status == "frozen" or ctx is None:
            ch_state.status = "skipped"
            await touch_job(job)
            return

        total_new_posts = 0
        final_latest_id = 0
        requests_log: list[Any] = []
        responses_log: list[Any] = []
        session_seen_ids: set[int] = set()

        try:
            known_latest_id = 0
            before_id: int | None = None
            iterations = 0
            stop_sync = False

            while not stop_sync and not job.cancel_event.is_set():
                if iterations >= settings.SCRAPER_ITERATION_LIMIT:
                    break
                iterations += 1

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

                if response.get("fullRequest"):
                    requests_log.append(response["fullRequest"])
                responses_log.append(response)

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

                if page_result.latest_id:
                    final_latest_id = page_result.latest_id
                    known_latest_id = page_result.latest_id
                if page_result.display_name:
                    ctx.display_name = page_result.display_name
                if page_result.photo_url:
                    ctx.photo_url = page_result.photo_url

                if page_result.posts_saved:
                    total_new_posts += page_result.posts_saved
                    ch_state.posts_fetched = total_new_posts
                    await touch_job(job)

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

                stop_sync = page_result.stop_sync
                if page_result.break_incremental:
                    break
                before_id = page_result.next_before_id

            await run_db(
                _finalize_channel_success,
                ctx,
                job=job,
                user_id=user_id,
                total_new_posts=total_new_posts,
                final_latest_id=final_latest_id,
                requests_log=requests_log,
                responses_log=responses_log,
            )
            ch_state.status = "success"
            ch_state.new_latest_id = final_latest_id or None
            await touch_job(job)

        except SyncScrapeError as exc:
            await run_db(
                _finalize_channel_scrape_error,
                ctx,
                exc,
                job=job,
                user_id=user_id,
                total_new_posts=total_new_posts,
                requests_log=requests_log,
                responses_log=responses_log,
            )
            ch_state.status = "failed"
            ch_state.error = str(exc)
            ch_state.posts_fetched = total_new_posts
            await touch_job(job)

        except Exception as exc:  # noqa: BLE001
            logger.exception("Sync failed for @%s", ch_state.channel_name)
            await run_db(
                _finalize_channel_error,
                ctx,
                str(exc),
                job=job,
                user_id=user_id,
                total_new_posts=total_new_posts,
                requests_log=requests_log,
                responses_log=responses_log,
            )
            ch_state.status = "failed"
            ch_state.error = str(exc)
            ch_state.posts_fetched = total_new_posts
            await touch_job(job)


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
