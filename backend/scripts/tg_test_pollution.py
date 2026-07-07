"""Known TG test artifacts — shared by cleanup script and pytest helpers."""

from __future__ import annotations

from collections.abc import Iterable

from sqlmodel import Session, col, delete, or_, select

from app.models_tg import (
    Channel,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    Summary,
    SyncLog,
)

# Channel IDs created by backend pytest suites
TEST_CHANNEL_IDS: frozenset[str] = frozenset(
    {
        "ch1",
        "stale-ch",
        "rag-ch",
        "backfill-ch",
        "fallback-a",
        "fallback-b",
        "ch-ms-ts",
        "smoke-test",
        "op-ch",
        "other-ch",
        "scope-op",
        "scope-other",
        # Additional IDs found in tests
        "ch-test",
        "range-ch",
        "op-status-ch",
        "foreign-status-ch",
    }
)

# Channel names that may differ from id (scheduler/tenancy tests)
TEST_CHANNEL_NAMES: frozenset[str] = frozenset(
    {
        "op-channel",
        "other-channel",
        "ret-ch",
    }
)

TEST_SUMMARY_IDS: frozenset[str] = frozenset({"auto-sum-test", "sum-1"})

TEST_NETWORK_LOG_IDS: frozenset[str] = frozenset({"nl-test-1"})

ALL_TEST_CHANNEL_KEYS: frozenset[str] = TEST_CHANNEL_IDS | TEST_CHANNEL_NAMES

TG_TABLES: tuple[str, ...] = (
    "tg_post_sync_state",
    "tg_post_embeddings",
    "tg_post_translations",
    "tg_posts",
    "tg_publish_logs",
    "tg_sync_logs",
    "tg_summaries",
    "tg_sync_jobs",
    "tg_sync_meta",
    "tg_llm_logs",
    "tg_embedding_logs",
    "tg_network_logs",
    "tg_bot_credentials",
    "tg_chat_destinations",
    "tg_app_settings",
    "tg_channel_setting_groups",
    "tg_channels",
)


def _summary_references_test_channels(channels: list[str] | None) -> bool:
    if not channels:
        return False
    return any(ch in ALL_TEST_CHANNEL_KEYS for ch in channels)


def count_test_pollution(session: Session) -> dict[str, int]:
    """Return row counts that would be removed by delete_test_pollution."""
    counts: dict[str, int] = {}

    channel_rows = session.exec(
        select(Channel).where(
            or_(
                col(Channel.id).in_(TEST_CHANNEL_IDS),
                col(Channel.name).in_(TEST_CHANNEL_NAMES),
            )
        )
    ).all()
    counts["tg_channels"] = len(channel_rows)

    channel_keys = {ch.id for ch in channel_rows} | {ch.name for ch in channel_rows}
    channel_keys |= ALL_TEST_CHANNEL_KEYS

    counts["tg_posts"] = len(
        session.exec(select(Post).where(col(Post.channel_name).in_(channel_keys))).all()
    )
    counts["tg_post_embeddings"] = len(
        session.exec(
            select(PostEmbedding).where(
                col(PostEmbedding.channel_name).in_(channel_keys)
            )
        ).all()
    )
    counts["tg_post_translations"] = len(
        session.exec(
            select(PostTranslation).where(
                col(PostTranslation.channel_name).in_(channel_keys)
            )
        ).all()
    )
    counts["tg_sync_logs"] = len(
        session.exec(
            select(SyncLog).where(col(SyncLog.channel_name).in_(channel_keys))
        ).all()
    )

    summary_rows = session.exec(select(Summary)).all()
    counts["tg_summaries"] = sum(
        1
        for s in summary_rows
        if s.id in TEST_SUMMARY_IDS or _summary_references_test_channels(s.channels)
    )

    counts["tg_network_logs"] = len(
        session.exec(
            select(NetworkLog).where(col(NetworkLog.id).in_(TEST_NETWORK_LOG_IDS))
        ).all()
    )

    return counts


def delete_test_pollution(session: Session, *, dry_run: bool = False) -> dict[str, int]:
    """Delete known test channels and dependent rows. Returns deletion counts."""
    counts = count_test_pollution(session)
    if dry_run:
        return counts

    channel_rows = session.exec(
        select(Channel).where(
            or_(
                col(Channel.id).in_(TEST_CHANNEL_IDS),
                col(Channel.name).in_(TEST_CHANNEL_NAMES),
            )
        )
    ).all()
    channel_keys = {ch.id for ch in channel_rows} | {ch.name for ch in channel_rows}
    channel_keys |= ALL_TEST_CHANNEL_KEYS

    session.exec(
        delete(PostEmbedding).where(col(PostEmbedding.channel_name).in_(channel_keys))
    )
    session.exec(
        delete(PostTranslation).where(
            col(PostTranslation.channel_name).in_(channel_keys)
        )
    )
    session.exec(delete(Post).where(col(Post.channel_name).in_(channel_keys)))
    session.exec(delete(SyncLog).where(col(SyncLog.channel_name).in_(channel_keys)))

    for summary in session.exec(select(Summary)).all():
        if summary.id in TEST_SUMMARY_IDS or _summary_references_test_channels(
            summary.channels
        ):
            session.delete(summary)

    session.exec(delete(NetworkLog).where(col(NetworkLog.id).in_(TEST_NETWORK_LOG_IDS)))

    for ch in channel_rows:
        session.delete(ch)

    session.commit()
    return counts


def truncate_tg_tables(session: Session) -> None:
    """Remove all TG domain rows (for isolated test DB teardown)."""
    from sqlalchemy import text

    tables = ", ".join(TG_TABLES)
    session.execute(text(f"TRUNCATE TABLE {tables} RESTART IDENTITY CASCADE"))
    session.commit()


def cleanup_channel_keys(session: Session, channel_keys: Iterable[str]) -> None:
    """Delete one or more channels and rows that reference them by name/id."""
    keys = set(channel_keys)
    if not keys:
        return

    session.exec(delete(PostEmbedding).where(col(PostEmbedding.channel_name).in_(keys)))
    session.exec(
        delete(PostTranslation).where(col(PostTranslation.channel_name).in_(keys))
    )
    session.exec(delete(Post).where(col(Post.channel_name).in_(keys)))
    session.exec(delete(SyncLog).where(col(SyncLog.channel_name).in_(keys)))

    for summary in session.exec(select(Summary)).all():
        if _summary_references_test_channels(summary.channels) and any(
            ch in keys for ch in (summary.channels or [])
        ):
            session.delete(summary)

    for ch in session.exec(
        select(Channel).where(
            or_(col(Channel.id).in_(keys), col(Channel.name).in_(keys))
        )
    ).all():
        session.delete(ch)

    session.commit()
