"""Server-side channel sync orchestration (backward pagination)."""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from datetime import datetime
from typing import Any

import httpx
from sqlmodel import Session, col, select

from app.core.config import settings
from app.core.db import engine
from app.jobs.settings import compute_scrape_cutoff_ms, load_retention_settings, load_sync_settings
from app.models_tg import Channel, Post
from app.services.channels import update_channel_coverage
from app.services.language import detect_language_from_posts
from app.services.logs import upsert_network_log, upsert_sync_log
from app.services.network import rotate_tor_identity
from app.services.network_settings import load_network_settings, redact_proxy_url, resolve_proxies
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


def _posts_to_save(channel_name: str, posts: list[dict[str, Any]]) -> list[dict[str, Any]]:
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
            )
            response["fullRequest"] = request_body
            return response
        except Exception as exc:  # noqa: BLE001
            is_rate_limit = isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code == 429
            is_network = isinstance(exc, (httpx.HTTPError, ConnectionError, OSError)) or (
                "not available on the web view" in str(exc)
            )
            is_unavailable = "not available on the web view" in str(exc)

            if is_unavailable:
                raise SyncScrapeError(
                    str(exc),
                    is_unavailable=True,
                    full_request=request_body,
                    full_response={"error": str(exc)},
                ) from exc

            if retry_count < settings.SYNC_MAX_RETRIES and (is_rate_limit or is_network):
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


async def _maybe_add_forwarded_channel(
    session: Session,
    forwarded_name: str,
    *,
    discovered_via: dict[str, Any],
    proxies: list[str],
    tor_auto_rotate: bool,
    tor_rotation_threshold: int,
    user_id: uuid.UUID | None,
    effective_start_time: int,
) -> None:
    clean = forwarded_name.strip().replace("@", "").split("/")[-1]
    if not clean:
        return
    existing = session.exec(select(Channel).where(col(Channel.name) == clean)).first()
    if existing:
        return

    display_name = clean
    photo_url = None
    is_unavailable = False
    try:
        info = await get_channel_info(
            clean,
            proxies=proxies or None,
            tor_auto_rotate=tor_auto_rotate,
            tor_rotation_threshold=tor_rotation_threshold,
        )
        display_name = info.get("displayName") or clean
        photo_url = info.get("photoUrl")
        is_unavailable = bool(info.get("isUnavailableOnWebView"))
        if info.get("telemetry"):
            _save_network_telemetry(
                session,
                f"https://t.me/s/{clean}",
                info["telemetry"],
                user_id=user_id,
            )
    except Exception as exc:  # noqa: BLE001
        logger.warning("Auto-follow channel info failed for @%s: %s", clean, exc)

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
        total_new_posts = 0
        final_latest_id = 0
        requests_log: list[Any] = []
        responses_log: list[Any] = []
        session_seen_ids: set[int] = set()

        with Session(engine) as session:
            channel = session.get(Channel, ch_state.channel_id)
            effective_user_id = user_id or (channel.user_id if channel else None)
            network = load_network_settings(session, effective_user_id)
            sync_settings = load_sync_settings(session)
            proxies = resolve_proxies(network)
            tor_auto_rotate = bool(network.get("torAutoRotate"))
            tor_rotation_threshold = int(network.get("torRotationThreshold") or 10)
            tor_control_enabled = bool(network.get("torControlEnabled"))
            tor_control_port = int(
                network.get("torControlPort") or network.get("torControlPortDefault") or settings.TOR_CONTROL_PORT
            )
            auto_follow = bool(sync_settings.get("autoFollowForwarded"))
            retention_settings = load_retention_settings(session)
            scrape_cutoff_ms = compute_scrape_cutoff_ms(sync_settings, retention_settings)
            effective_start_time = scrape_cutoff_ms

            if not channel:
                ch_state.status = "failed"
                ch_state.error = "Channel not found"
                await touch_job(job)
                return
            if channel.is_frozen:
                ch_state.status = "skipped"
                await touch_job(job)
                return

            has_existing_posts = (
                session.exec(
                    select(Post.post_id)
                    .where(Post.channel_name == channel.name)
                    .limit(1)
                ).first()
                is not None
            )
            retrieval_pass = "incremental" if has_existing_posts else "initial"

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
                        channel.name,
                        before_id=before_id,
                        known_latest_id=known_latest_id,
                        known_display_name=channel.display_name,
                        known_photo_url=channel.photo_url,
                        proxies=proxies,
                        tor_auto_rotate=tor_auto_rotate,
                        tor_rotation_threshold=tor_rotation_threshold,
                        tor_control_enabled=tor_control_enabled,
                        tor_control_port=tor_control_port,
                    )

                    if response.get("fullRequest"):
                        requests_log.append(response["fullRequest"])
                    responses_log.append(response)

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
                    final_latest_id = latest_id or final_latest_id
                    if latest_id:
                        known_latest_id = latest_id

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

                    page_ids = [p["id"] for p in posts]
                    record_gaps_from_page(
                        session,
                        channel.name,
                        page_ids,
                        job_id=job.job_id,
                        user_id=user_id,
                        session_seen_ids=session_seen_ids,
                    )

                    if not posts:
                        stop_sync = True
                        break

                    existing_on_page = _existing_post_ids(session, channel.name, page_ids)
                    new_on_page = [pid for pid in page_ids if pid not in existing_on_page]

                    if retrieval_pass == "incremental" and existing_on_page:
                        if new_on_page:
                            anchor_existing = min(existing_on_page)
                            record_gaps_to_existing_post(
                                session,
                                channel.name,
                                new_on_page,
                                anchor_existing,
                                job_id=job.job_id,
                                user_id=user_id,
                                session_seen_ids=session_seen_ids,
                            )
                        stop_sync = True

                    posts_to_save = _posts_to_save(channel.name, posts)
                    if retrieval_pass == "incremental" and existing_on_page:
                        posts_to_save = [p for p in posts_to_save if p["id"] not in existing_on_page]

                    if posts_to_save:
                        bulk_upsert_posts_impl(
                            posts_to_save,
                            session,
                            retrieval_job_id=job.job_id,
                            retrieval_pass=retrieval_pass,
                            retrieval_source=job.source,
                        )
                        session.commit()
                        touch_sync(session, "posts")
                        total_new_posts += len(posts_to_save)
                        ch_state.posts_fetched = total_new_posts
                        await touch_job(job)

                        if auto_follow:
                            known_names = {
                                c.name.lower()
                                for c in session.exec(select(Channel)).all()
                            }
                            for p in posts_to_save:
                                fwd = p.get("forwardedFrom")
                                if not fwd:
                                    continue
                                clean_fwd = fwd.strip().replace("@", "").split("/")[-1]
                                if clean_fwd and clean_fwd.lower() not in known_names:
                                    known_names.add(clean_fwd.lower())
                                    await _maybe_add_forwarded_channel(
                                        session,
                                        clean_fwd,
                                        discovered_via={
                                            "channelName": channel.name,
                                            "postId": p["id"],
                                            "timestamp": p["timestamp"],
                                        },
                                        proxies=proxies,
                                        tor_auto_rotate=tor_auto_rotate,
                                        tor_rotation_threshold=tor_rotation_threshold,
                                        user_id=user_id,
                                        effective_start_time=effective_start_time,
                                    )

                    if retrieval_pass == "incremental" and existing_on_page:
                        break

                    oldest_ts = min(
                        (p.get("timestamp") or 0 for p in posts),
                        default=0,
                    )
                    if retrieval_pass == "initial" and scrape_cutoff_ms > 0 and oldest_ts < scrape_cutoff_ms:
                        stop_sync = True
                        break

                    next_before = response.get("nextBeforeId")
                    if next_before is None:
                        stop_sync = True
                        break
                    if before_id is not None and next_before >= before_id:
                        stop_sync = True
                        break
                    before_id = next_before

                update_channel_coverage(session, channel, scrape_cutoff_ms)

                detected_language = channel.language
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

                ch_state.status = "success"
                ch_state.new_latest_id = final_latest_id or None

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
                await touch_job(job)

            except SyncScrapeError as exc:
                if exc.is_unavailable:
                    channel.is_frozen = True
                    channel.is_unavailable_on_web_view = True
                    channel.updated_at = datetime.utcnow()
                    session.add(channel)
                    session.commit()
                    touch_sync(session, "channels")

                ch_state.status = "failed"
                ch_state.error = str(exc)
                ch_state.posts_fetched = total_new_posts

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
                await touch_job(job)

            except Exception as exc:  # noqa: BLE001
                logger.exception("Sync failed for @%s", ch_state.channel_name)
                ch_state.status = "failed"
                ch_state.error = str(exc)
                ch_state.posts_fetched = total_new_posts

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
                await touch_job(job)


async def run_sync_job(job: SyncJobState, user_id: uuid.UUID | None) -> None:
    job.status = "running"
    await touch_job(job)
    with Session(engine) as session:
        sync_settings = load_sync_settings(session)
        concurrency = max(
            1,
            int(sync_settings.get("syncConcurrency") or settings.SYNC_CONCURRENCY_DEFAULT),
        )

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
