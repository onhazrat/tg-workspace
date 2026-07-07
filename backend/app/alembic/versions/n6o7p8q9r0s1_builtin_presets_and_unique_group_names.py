"""builtin preset groups and unique setting group names

Revision ID: n6o7p8q9r0s1
Revises: m5n6o7p8q9r0
Create Date: 2026-07-07

Seeds Slow feed / High velocity built-in groups per operator scope and enforces
case-insensitive unique group names within each scope.
"""

import sqlalchemy as sa
from alembic import op

revision = "n6o7p8q9r0s1"
down_revision = "m5n6o7p8q9r0"
branch_labels = None
depends_on = None


def _scope_key(user_id: str | None) -> str:
    return user_id if user_id is not None else "global"


def upgrade() -> None:
    conn = op.get_bind()
    scopes = conn.execute(
        sa.text(
            """
            SELECT DISTINCT user_id
            FROM (
                SELECT user_id FROM tg_channel_setting_groups
                UNION
                SELECT user_id FROM tg_channels
            ) AS scopes
            """
        )
    ).fetchall()
    if not scopes:
        scopes = [(None,)]

    for (user_id,) in scopes:
        scope = _scope_key(str(user_id) if user_id is not None else None)
        for group_id, name, regular_min, dynamic_posts in (
            ("slow-feed-" + scope, "Slow feed", 1440, 1),
            ("high-velocity-" + scope, "High velocity", 60, 10),
        ):
            exists = conn.execute(
                sa.text(
                    "SELECT 1 FROM tg_channel_setting_groups WHERE id = :group_id"
                ),
                {"group_id": group_id},
            ).first()
            if exists:
                continue
            conn.execute(
                sa.text(
                    """
                    INSERT INTO tg_channel_setting_groups (
                        id, user_id, name, is_default,
                        regular_sync_enabled, dynamic_sync_enabled,
                        auto_sync_interval_minutes, dynamic_sync_expected_posts,
                        auto_follow_forwarded, is_frozen, is_unavailable_on_web_view,
                        created_at, updated_at
                    ) VALUES (
                        :id, :user_id, :name, false,
                        true, true, :regular_min, :dynamic_posts,
                        false, false, false,
                        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
                    )
                    """
                ),
                {
                    "id": group_id,
                    "user_id": user_id,
                    "name": name,
                    "regular_min": regular_min,
                    "dynamic_posts": dynamic_posts,
                },
            )

    duplicate_rows = conn.execute(
        sa.text(
            """
            SELECT
                COALESCE(user_id::text, 'global') AS scope_key,
                lower(name) AS normalized_name,
                array_agg(id ORDER BY created_at, id) AS group_ids
            FROM tg_channel_setting_groups
            GROUP BY COALESCE(user_id::text, 'global'), lower(name)
            HAVING COUNT(*) > 1
            """
        )
    ).fetchall()

    reserved_prefixes = (
        "default-",
        "restricted-",
        "frozen-",
        "slow-feed-",
        "high-velocity-",
    )

    for scope_key, _normalized_name, group_ids in duplicate_rows:
        reserved_ids = [
            group_id
            for group_id in group_ids
            if group_id.startswith(reserved_prefixes)
        ]
        canonical_id = reserved_ids[0] if reserved_ids else group_ids[0]

        for duplicate_id in group_ids:
            if duplicate_id == canonical_id:
                continue
            conn.execute(
                sa.text(
                    """
                    UPDATE tg_channels
                    SET setting_group_id = :canonical_id
                    WHERE setting_group_id = :duplicate_id
                    """
                ),
                {
                    "canonical_id": canonical_id,
                    "duplicate_id": duplicate_id,
                },
            )
            row = conn.execute(
                sa.text("SELECT name FROM tg_channel_setting_groups WHERE id = :id"),
                {"id": duplicate_id},
            ).first()
            if not row:
                continue
            suffix = 2
            new_name = f"{row[0]} ({suffix})"
            while conn.execute(
                sa.text(
                    """
                    SELECT 1 FROM tg_channel_setting_groups
                    WHERE COALESCE(user_id::text, 'global') = :scope_key
                      AND lower(name) = lower(:name)
                      AND id <> :duplicate_id
                    """
                ),
                {
                    "scope_key": scope_key,
                    "name": new_name,
                    "duplicate_id": duplicate_id,
                },
            ).first():
                suffix += 1
                new_name = f"{row[0]} ({suffix})"
            conn.execute(
                sa.text(
                    """
                    UPDATE tg_channel_setting_groups
                    SET name = :name
                    WHERE id = :duplicate_id
                    """
                ),
                {"name": new_name, "duplicate_id": duplicate_id},
            )

    op.create_index(
        "uq_tg_channel_setting_groups_scope_name",
        "tg_channel_setting_groups",
        [sa.text("COALESCE(user_id::text, 'global')"), sa.text("lower(name)")],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index(
        "uq_tg_channel_setting_groups_scope_name",
        table_name="tg_channel_setting_groups",
    )
