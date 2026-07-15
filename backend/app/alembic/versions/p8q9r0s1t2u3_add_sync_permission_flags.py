"""add sync permission flags to setting groups

Revision ID: p8q9r0s1t2u3
Revises: o7p8q9r0s1t2
Create Date: 2026-07-15
"""

import sqlalchemy as sa
from alembic import op

revision = "p8q9r0s1t2u3"
down_revision = "o7p8q9r0s1t2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tg_channel_setting_groups",
        sa.Column(
            "include_in_sync_all",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "tg_channel_setting_groups",
        sa.Column(
            "include_in_bulk_sync",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "tg_channel_setting_groups",
        sa.Column(
            "allow_individual_sync",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )
    op.add_column(
        "tg_channel_setting_groups",
        sa.Column(
            "reset_sync_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )

    op.execute(
        sa.text(
            """
            UPDATE tg_channel_setting_groups
            SET include_in_sync_all = false,
                include_in_bulk_sync = true,
                allow_individual_sync = true,
                reset_sync_enabled = false
            WHERE id LIKE 'restricted-%'
               OR (name = 'Restricted' AND is_unavailable_on_web_view = true)
            """
        )
    )
    op.execute(
        sa.text(
            """
            UPDATE tg_channel_setting_groups
            SET include_in_sync_all = false,
                include_in_bulk_sync = false,
                allow_individual_sync = true,
                reset_sync_enabled = true
            WHERE id LIKE 'frozen-%'
               OR (name = 'Frozen' AND is_frozen = true AND is_unavailable_on_web_view = false)
            """
        )
    )


def downgrade() -> None:
    op.drop_column("tg_channel_setting_groups", "reset_sync_enabled")
    op.drop_column("tg_channel_setting_groups", "allow_individual_sync")
    op.drop_column("tg_channel_setting_groups", "include_in_bulk_sync")
    op.drop_column("tg_channel_setting_groups", "include_in_sync_all")
