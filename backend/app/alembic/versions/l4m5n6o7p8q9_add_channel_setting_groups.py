"""add channel setting groups with strict inheritance

Revision ID: l4m5n6o7p8q9
Revises: k3l4m5n6o7p8
Create Date: 2026-07-07

"""

import sqlalchemy as sa
from alembic import op

revision = "l4m5n6o7p8q9"
down_revision = "k3l4m5n6o7p8"
branch_labels = None
depends_on = None


def _scope_key(user_id: str | None) -> str:
    return user_id if user_id is not None else "global"


def upgrade() -> None:
    op.create_table(
        "tg_channel_setting_groups",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "regular_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
        sa.Column(
            "dynamic_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column(
            "auto_sync_interval_minutes",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
        sa.Column(
            "dynamic_sync_expected_posts",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
        sa.Column(
            "auto_follow_forwarded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("is_frozen", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "is_unavailable_on_web_view",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_tg_channel_setting_groups_user_id"),
        "tg_channel_setting_groups",
        ["user_id"],
        unique=False,
    )

    conn = op.get_bind()
    scopes = conn.execute(
        sa.text("SELECT DISTINCT user_id FROM tg_channels")
    ).fetchall()
    if not scopes:
        scopes = [(None,)]

    for (user_id,) in scopes:
        scope = _scope_key(str(user_id) if user_id is not None else None)
        default_id = f"default-{scope}"
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
                    :id, :user_id, 'default', true,
                    true, false, 60, 15,
                    false, false, false,
                    NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
                )
                """
            ),
            {"id": default_id, "user_id": user_id},
        )

        restricted_count = conn.execute(
            sa.text(
                """
                SELECT COUNT(*) FROM tg_channels
                WHERE user_id IS NOT DISTINCT FROM :user_id
                  AND (is_frozen = true OR is_unavailable_on_web_view = true)
                """
            ),
            {"user_id": user_id},
        ).scalar_one()
        if restricted_count:
            restricted_id = f"restricted-{scope}"
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
                        :id, :user_id, 'Restricted', false,
                        false, false, 60, 15,
                        false, true, true,
                        NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
                    )
                    """
                ),
                {"id": restricted_id, "user_id": user_id},
            )

    op.add_column(
        "tg_channels",
        sa.Column("setting_group_id", sa.String(), nullable=True),
    )
    op.create_index(
        op.f("ix_tg_channels_setting_group_id"),
        "tg_channels",
        ["setting_group_id"],
        unique=False,
    )

    for (user_id,) in scopes:
        scope = _scope_key(str(user_id) if user_id is not None else None)
        default_id = f"default-{scope}"
        restricted_id = f"restricted-{scope}"
        conn.execute(
            sa.text(
                """
                UPDATE tg_channels
                SET setting_group_id = CASE
                    WHEN is_frozen = true OR is_unavailable_on_web_view = true
                    THEN :restricted_id
                    ELSE :default_id
                END
                WHERE user_id IS NOT DISTINCT FROM :user_id
                """
            ),
            {
                "user_id": user_id,
                "default_id": default_id,
                "restricted_id": restricted_id,
            },
        )

    op.alter_column("tg_channels", "setting_group_id", nullable=False)

    op.drop_column("tg_channels", "regular_sync_enabled")
    op.drop_column("tg_channels", "dynamic_sync_enabled")
    op.drop_column("tg_channels", "auto_sync_interval_minutes")
    op.drop_column("tg_channels", "dynamic_sync_expected_posts")
    op.drop_column("tg_channels", "is_frozen")
    op.drop_column("tg_channels", "is_unavailable_on_web_view")
    op.drop_column("tg_channels", "auto_follow_forwarded")


def downgrade() -> None:
    op.add_column(
        "tg_channels",
        sa.Column(
            "auto_follow_forwarded",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "is_unavailable_on_web_view",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column("is_frozen", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "dynamic_sync_expected_posts",
            sa.Integer(),
            nullable=False,
            server_default="15",
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "auto_sync_interval_minutes",
            sa.Integer(),
            nullable=False,
            server_default="60",
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "dynamic_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "tg_channels",
        sa.Column(
            "regular_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    conn = op.get_bind()
    conn.execute(
        sa.text(
            """
            UPDATE tg_channels AS ch
            SET
                regular_sync_enabled = g.regular_sync_enabled,
                dynamic_sync_enabled = g.dynamic_sync_enabled,
                auto_sync_interval_minutes = g.auto_sync_interval_minutes,
                dynamic_sync_expected_posts = g.dynamic_sync_expected_posts,
                auto_follow_forwarded = g.auto_follow_forwarded,
                is_frozen = g.is_frozen,
                is_unavailable_on_web_view = g.is_unavailable_on_web_view
            FROM tg_channel_setting_groups AS g
            WHERE ch.setting_group_id = g.id
            """
        )
    )

    op.drop_index(op.f("ix_tg_channels_setting_group_id"), table_name="tg_channels")
    op.drop_column("tg_channels", "setting_group_id")
    op.drop_index(
        op.f("ix_tg_channel_setting_groups_user_id"),
        table_name="tg_channel_setting_groups",
    )
    op.drop_table("tg_channel_setting_groups")
