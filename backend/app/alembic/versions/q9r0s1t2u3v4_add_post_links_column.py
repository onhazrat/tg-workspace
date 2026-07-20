"""add links JSONB column to tg_posts

Backfills the column from existing post text so historical posts expose their
plain-text ``t.me/`` links. Masked links (custom anchor text) are only
recoverable on re-scrape — the href was never stored.

Revision ID: q9r0s1t2u3v4
Revises: p8q9r0s1t2u3
Create Date: 2026-07-20
"""

import json
import re

import sqlalchemy as sa
from alembic import op

revision = "q9r0s1t2u3v4"
down_revision = "p8q9r0s1t2u3"
branch_labels = None
depends_on = None

BATCH_SIZE = 2000

# Mirrors app.services.telegram_web.RESERVED_TELEGRAM_PATHS. Inlined so the
# migration stays valid if the service module changes later.
RESERVED_PATHS = {
    "addemoji",
    "addstickers",
    "addtheme",
    "boost",
    "c",
    "iv",
    "joinchat",
    "login",
    "proxy",
    "s",
    "setlanguage",
    "share",
    "socks",
}

_HANDLE_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
_LINK_RE = re.compile(
    r"(?:https?://)?(?:www\.)?(?:t\.me|telegram\.me)/([^\s<>\"')\]]+)",
    re.IGNORECASE,
)


def _is_handle(name: str) -> bool:
    return bool(_HANDLE_RE.match(name)) and name.lower() not in RESERVED_PATHS


def _links_from_text(text: str) -> list[dict[str, str]]:
    links: list[dict[str, str]] = []
    seen: set[str] = set()
    for match in _LINK_RE.finditer(text or ""):
        path = match.group(1).split("?")[0].split("#")[0]
        segments = [seg for seg in path.split("/") if seg]
        if not segments:
            continue
        candidate = (
            segments[1]
            if segments[0].lower() == "s" and len(segments) > 1
            else segments[0]
        )
        if not _is_handle(candidate) or candidate.lower() in seen:
            continue
        seen.add(candidate.lower())
        links.append(
            {"url": f"https://t.me/{candidate}", "channel": candidate}
        )
    return links


def upgrade() -> None:
    op.add_column("tg_posts", sa.Column("links", sa.JSON(), nullable=True))

    conn = op.get_bind()
    # Keyset pagination on id: always advances, so the loop terminates even for
    # rows that yield no links and are therefore never updated.
    last_id = None
    while True:
        if last_id is None:
            rows = conn.execute(
                sa.text(
                    "SELECT id, text FROM tg_posts "
                    "WHERE text LIKE '%t.me/%' "
                    "ORDER BY id LIMIT :limit"
                ),
                {"limit": BATCH_SIZE},
            ).fetchall()
        else:
            rows = conn.execute(
                sa.text(
                    "SELECT id, text FROM tg_posts "
                    "WHERE text LIKE '%t.me/%' AND id > :last_id "
                    "ORDER BY id LIMIT :limit"
                ),
                {"limit": BATCH_SIZE, "last_id": last_id},
            ).fetchall()

        if not rows:
            break

        updates = []
        for row in rows:
            links = _links_from_text(row.text)
            if links:
                updates.append({"row_id": row.id, "links": json.dumps(links)})

        if updates:
            conn.execute(
                sa.text(
                    "UPDATE tg_posts SET links = CAST(:links AS JSON) "
                    "WHERE id = :row_id"
                ),
                updates,
            )

        last_id = rows[-1].id
        if len(rows) < BATCH_SIZE:
            break


def downgrade() -> None:
    op.drop_column("tg_posts", "links")
