#!/usr/bin/env python3
"""Read-only audit of tg_posts for media-only placeholders, empty text, and forwards."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import text
from sqlmodel import Session

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from app.core.db import engine

MEDIA_ONLY_PLACEHOLDER = "[Media/No Text Content]"
DEFAULT_JSON_REPORT = _REPO_ROOT / "backend/tests/fixtures/live/audit_report.json"
TOP_CHANNELS_LIMIT = 30

SQL_HELP = """
SQL equivalents (psql)
----------------------

Global summary:

  SELECT
    COUNT(*) AS total_posts,
    COUNT(*) FILTER (WHERE text = '[Media/No Text Content]') AS media_only,
    COUNT(*) FILTER (
      WHERE trim(text) = '' AND text <> '[Media/No Text Content]'
    ) AS empty_text,
    COUNT(*) FILTER (
      WHERE forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL
    ) AS forwarded,
    COUNT(*) FILTER (
      WHERE (forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL)
        AND (text = '[Media/No Text Content]' OR trim(text) = '')
    ) AS forwarded_only
  FROM tg_posts;

Per-channel counts (ordered by media-only desc):

  SELECT
    channel_name,
    COUNT(*) AS total_posts,
    COUNT(*) FILTER (WHERE text = '[Media/No Text Content]') AS media_only,
    COUNT(*) FILTER (
      WHERE trim(text) = '' AND text <> '[Media/No Text Content]'
    ) AS empty_text,
    COUNT(*) FILTER (
      WHERE forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL
    ) AS forwarded,
    COUNT(*) FILTER (
      WHERE (forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL)
        AND (text = '[Media/No Text Content]' OR trim(text) = '')
    ) AS forwarded_only
  FROM tg_posts
  GROUP BY channel_name
  ORDER BY media_only DESC, total_posts DESC;

Single channel (replace @durov with your channel name, @ stripped in DB):

  SELECT
    channel_name,
    COUNT(*) AS total_posts,
    COUNT(*) FILTER (WHERE text = '[Media/No Text Content]') AS media_only,
    COUNT(*) FILTER (
      WHERE trim(text) = '' AND text <> '[Media/No Text Content]'
    ) AS empty_text,
    COUNT(*) FILTER (
      WHERE forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL
    ) AS forwarded,
    COUNT(*) FILTER (
      WHERE (forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL)
        AND (text = '[Media/No Text Content]' OR trim(text) = '')
    ) AS forwarded_only
  FROM tg_posts
  WHERE channel_name = 'durov'
  GROUP BY channel_name;

Top 30 channels by media-only count:

  SELECT
    channel_name,
    COUNT(*) FILTER (WHERE text = '[Media/No Text Content]') AS media_only,
    COUNT(*) AS total_posts
  FROM tg_posts
  GROUP BY channel_name
  HAVING COUNT(*) FILTER (WHERE text = '[Media/No Text Content]') > 0
  ORDER BY media_only DESC, total_posts DESC
  LIMIT 30;
"""

_CHANNEL_STATS_SQL = text(
    """
    SELECT
      channel_name,
      COUNT(*)::bigint AS total_posts,
      COUNT(*) FILTER (WHERE text = :placeholder)::bigint AS media_only,
      COUNT(*) FILTER (
        WHERE trim(text) = '' AND text <> :placeholder
      )::bigint AS empty_text,
      COUNT(*) FILTER (
        WHERE forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL
      )::bigint AS forwarded,
      COUNT(*) FILTER (
        WHERE (forwarded_from IS NOT NULL OR forwarded_from_name IS NOT NULL)
          AND (text = :placeholder OR trim(text) = '')
      )::bigint AS forwarded_only
    FROM tg_posts
    WHERE (CAST(:channel AS text) IS NULL OR channel_name = CAST(:channel AS text))
    GROUP BY channel_name
    ORDER BY media_only DESC, total_posts DESC, channel_name ASC
    """
)


@dataclass(frozen=True)
class ChannelStats:
    channel_name: str
    total_posts: int
    media_only: int
    empty_text: int
    forwarded: int
    forwarded_only: int

    @property
    def media_only_pct(self) -> float:
        if self.total_posts == 0:
            return 0.0
        return round(100.0 * self.media_only / self.total_posts, 2)


@dataclass(frozen=True)
class AuditSummary:
    total_posts: int
    media_only: int
    empty_text: int
    forwarded: int
    forwarded_only: int
    channel_count: int

    @property
    def media_only_pct(self) -> float:
        if self.total_posts == 0:
            return 0.0
        return round(100.0 * self.media_only / self.total_posts, 2)


def _normalize_channel_name(channel: str | None) -> str | None:
    if channel is None:
        return None
    normalized = channel.strip()
    if normalized.startswith("@"):
        normalized = normalized[1:]
    return normalized or None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Audit tg_posts for media-only placeholders, empty text, and forward stats. "
            "Read-only — no writes."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=SQL_HELP,
    )
    parser.add_argument(
        "--channel",
        metavar="NAME",
        help="Limit audit to one channel (with or without leading @).",
    )
    parser.add_argument(
        "--json",
        nargs="?",
        const=DEFAULT_JSON_REPORT,
        default=None,
        type=Path,
        metavar="PATH",
        help=(
            "Write JSON report to PATH "
            f"(default: {DEFAULT_JSON_REPORT.relative_to(_REPO_ROOT)})."
        ),
    )
    return parser.parse_args()


def _fetch_channel_stats(session: Session, channel: str | None) -> list[ChannelStats]:
    rows = session.execute(
        _CHANNEL_STATS_SQL,
        {"placeholder": MEDIA_ONLY_PLACEHOLDER, "channel": channel},
    ).mappings()
    return [
        ChannelStats(
            channel_name=row["channel_name"],
            total_posts=int(row["total_posts"]),
            media_only=int(row["media_only"]),
            empty_text=int(row["empty_text"]),
            forwarded=int(row["forwarded"]),
            forwarded_only=int(row["forwarded_only"]),
        )
        for row in rows
    ]


def _summarize(channels: list[ChannelStats]) -> AuditSummary:
    return AuditSummary(
        total_posts=sum(ch.total_posts for ch in channels),
        media_only=sum(ch.media_only for ch in channels),
        empty_text=sum(ch.empty_text for ch in channels),
        forwarded=sum(ch.forwarded for ch in channels),
        forwarded_only=sum(ch.forwarded_only for ch in channels),
        channel_count=len(channels),
    )


def _print_table(channels: list[ChannelStats], summary: AuditSummary) -> None:
    headers = (
        "channel",
        "total",
        "media_only",
        "empty",
        "fwd",
        "fwd_only",
        "media_%",
    )
    rows: list[tuple[str, ...]] = [
        (
            ch.channel_name,
            str(ch.total_posts),
            str(ch.media_only),
            str(ch.empty_text),
            str(ch.forwarded),
            str(ch.forwarded_only),
            f"{ch.media_only_pct:.1f}",
        )
        for ch in channels
    ]

    widths = [len(h) for h in headers]
    for row in rows:
        for idx, cell in enumerate(row):
            widths[idx] = max(widths[idx], len(cell))

    def _fmt_row(cells: tuple[str, ...]) -> str:
        return "  ".join(cell.rjust(widths[idx]) for idx, cell in enumerate(cells))

    print(_fmt_row(headers))
    print(_fmt_row(tuple("-" * w for w in widths)))
    for row in rows:
        print(_fmt_row(row))

    print()
    print("Global summary")
    print(f"  channels:      {summary.channel_count}")
    print(f"  total_posts:   {summary.total_posts}")
    print(f"  media_only:    {summary.media_only} ({summary.media_only_pct:.2f}%)")
    print(f"  empty_text:    {summary.empty_text}")
    print(f"  forwarded:     {summary.forwarded}")
    print(f"  forwarded_only:{summary.forwarded_only}")

    top = sorted(channels, key=lambda ch: (-ch.media_only, -ch.total_posts))[
        :TOP_CHANNELS_LIMIT
    ]
    if top and summary.media_only > 0:
        print()
        print(f"Top {min(TOP_CHANNELS_LIMIT, len(top))} channels by media_only")
        for ch in top:
            print(
                f"  {ch.channel_name}: {ch.media_only} / {ch.total_posts} "
                f"({ch.media_only_pct:.1f}%)"
            )


def _build_report(
    *,
    channel_filter: str | None,
    channels: list[ChannelStats],
    summary: AuditSummary,
) -> dict[str, Any]:
    top_channels = sorted(channels, key=lambda ch: (-ch.media_only, -ch.total_posts))[
        :TOP_CHANNELS_LIMIT
    ]
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "placeholder": MEDIA_ONLY_PLACEHOLDER,
        "channel_filter": channel_filter,
        "summary": asdict(summary) | {"media_only_pct": summary.media_only_pct},
        "channels": [
            asdict(ch) | {"media_only_pct": ch.media_only_pct} for ch in channels
        ],
        "top_channels_by_media_only": [
            asdict(ch) | {"media_only_pct": ch.media_only_pct} for ch in top_channels
        ],
    }


def _write_json(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"\nWrote JSON report to {path}")


def audit(
    *, channel: str | None = None, json_path: Path | None = None
) -> dict[str, Any]:
    normalized_channel = _normalize_channel_name(channel)
    with Session(engine) as session:
        channels = _fetch_channel_stats(session, normalized_channel)
    summary = _summarize(channels)
    report = _build_report(
        channel_filter=normalized_channel,
        channels=channels,
        summary=summary,
    )
    _print_table(channels, summary)
    if json_path is not None:
        _write_json(json_path, report)
    return report


if __name__ == "__main__":
    args = _parse_args()
    audit(channel=args.channel, json_path=args.json)
