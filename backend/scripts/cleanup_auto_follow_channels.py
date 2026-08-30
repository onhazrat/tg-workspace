#!/usr/bin/env python3
"""Freeze or delete channels added via auto-follow (discovered_via is set)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlmodel import Session, col, delete

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT / "backend") not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT / "backend"))

load_dotenv(_REPO_ROOT / ".env")

from app.core.db import engine
from app.models_tg import Channel, Post, PostEmbedding, PostTranslation
from app.services.bulk_channels import is_auto_followed_channel, select_bulk_channels
from app.services.follows import get_operator_user_id
from app.services.sync_meta import touch_sync


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Freeze or delete auto-followed channels (discovered_via set)."
    )
    parser.add_argument("--dry-run", action="store_true", help="Report counts only.")
    parser.add_argument(
        "--limit", type=int, default=None, help="Max channels to affect."
    )
    parser.add_argument(
        "--freeze",
        action="store_true",
        help="Mark channels frozen instead of deleting (default when neither flag set).",
    )
    parser.add_argument(
        "--delete", action="store_true", help="Delete channels and their posts."
    )
    return parser.parse_args()


def _delete_channel(session: Session, channel: Channel) -> None:
    name = channel.name
    session.exec(delete(PostEmbedding).where(col(PostEmbedding.channel_name) == name))
    session.exec(
        delete(PostTranslation).where(col(PostTranslation.channel_name) == name)
    )
    session.exec(delete(Post).where(col(Post.channel_name) == name))
    session.delete(channel)


def main() -> None:
    args = _parse_args()
    action = "delete" if args.delete else "freeze"

    with Session(engine) as session:
        operator_id = get_operator_user_id(session)
        channels = select_bulk_channels(
            session,
            operator_id=operator_id,
            auto_follow_only=True,
            limit=args.limit,
        )
        targets = [ch for ch in channels if is_auto_followed_channel(ch)]
        print(f"Auto-followed channels in scope: {len(targets)}")
        for ch in targets[:15]:
            via = ch.discovered_via or {}
            print(f"  @{ch.name} via @{via.get('channelName', '?')}")
        if len(targets) > 15:
            print(f"  ... and {len(targets) - 15} more")

        if args.dry_run:
            print(f"\n[dry-run] would {action}: {len(targets)}")
            return

        affected = 0
        for channel in targets:
            if action == "freeze":
                channel.is_frozen = True
                session.add(channel)
            else:
                _delete_channel(session, channel)
            affected += 1

        if affected:
            session.commit()
            touch_sync(session, "channels")
            if action == "delete":
                touch_sync(session, "posts")

        print(f"\n{action}d: {affected}")


if __name__ == "__main__":
    main()
