"""consolidate duplicate legacy reserved setting groups

Revision ID: m5n6o7p8q9r0
Revises: l4m5n6o7p8q9
Create Date: 2026-07-07

Merges legacy user-created "Frozen" / "Restricted" groups (random UUID ids)
into canonical reserved ids frozen-{scope} / restricted-{scope}.
"""

import sqlalchemy as sa
from alembic import op

revision = "m5n6o7p8q9r0"
down_revision = "l4m5n6o7p8q9"
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
        for reserved_name, canonical_id in (
            ("Frozen", f"frozen-{scope}"),
            ("Restricted", f"restricted-{scope}"),
        ):
            legacy_rows = conn.execute(
                sa.text(
                    """
                    SELECT id FROM tg_channel_setting_groups
                    WHERE name = :reserved_name
                      AND id <> :canonical_id
                      AND id NOT LIKE 'default-%'
                      AND id NOT LIKE 'restricted-%'
                      AND id NOT LIKE 'frozen-%'
                      AND user_id IS NOT DISTINCT FROM :user_id
                    """
                ),
                {
                    "reserved_name": reserved_name,
                    "canonical_id": canonical_id,
                    "user_id": user_id,
                },
            ).fetchall()
            if not legacy_rows:
                continue

            exists = conn.execute(
                sa.text(
                    "SELECT 1 FROM tg_channel_setting_groups WHERE id = :canonical_id"
                ),
                {"canonical_id": canonical_id},
            ).first()
            if not exists:
                is_frozen = reserved_name == "Frozen"
                is_restricted = reserved_name == "Restricted"
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
                            false, false, 60, 15,
                            false, :is_frozen, :is_restricted,
                            NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
                        )
                        """
                    ),
                    {
                        "id": canonical_id,
                        "user_id": user_id,
                        "name": reserved_name,
                        "is_frozen": is_frozen,
                        "is_restricted": is_restricted,
                    },
                )

            for (legacy_id,) in legacy_rows:
                conn.execute(
                    sa.text(
                        """
                        UPDATE tg_channels
                        SET setting_group_id = :canonical_id
                        WHERE setting_group_id = :legacy_id
                        """
                    ),
                    {"canonical_id": canonical_id, "legacy_id": legacy_id},
                )
                conn.execute(
                    sa.text(
                        "DELETE FROM tg_channel_setting_groups WHERE id = :legacy_id"
                    ),
                    {"legacy_id": legacy_id},
                )


def downgrade() -> None:
    # Data consolidation is not reversible without guessing legacy ids.
    pass
