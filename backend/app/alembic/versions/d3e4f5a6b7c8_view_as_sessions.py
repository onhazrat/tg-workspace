"""View-as session records, and the Owner role for the bootstrap superuser

Ticket 26. Creates `view_as_sessions` and promotes the deployment's superusers
from Admin to Owner.

**The promotion belongs in a migration, not in a script.** `Permission.VIEW_AS`
is held by the `owner` role alone, so on every database that ran ticket 07's
migration — which granted every superuser `admin` and nothing else — the feature
this revision ships is code no account can reach. Making the grant an operator
step means the deploy that adds the button also ships it broken, which is the
same argument `b0c1d2e3f4a5` makes for assigning Admin there rather than
afterwards.

The `admin` assignment is left in place rather than replaced. Roles are a set,
Owner is a strict superset of Admin today, and deleting a row an operator can
see in order to tidy up is not something a migration should do silently.

**Neither foreign key cascades**, unlike every other per-User table in this
schema. An audit row is not owned by either account it names, and the case a
reader most wants an answer for is the deleted one — so both are `SET NULL` and
both addresses are denormalised, which is what still answers afterwards.

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
"""

import sqlalchemy as sa
import sqlmodel.sql.sqltypes
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "d3e4f5a6b7c8"
down_revision = "c2d3e4f5a6b7"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "view_as_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("actor_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "actor_email", sqlmodel.sql.sqltypes.AutoString(length=255), nullable=False
        ),
        sa.Column("subject_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column(
            "subject_email",
            sqlmodel.sql.sqltypes.AutoString(length=255),
            nullable=False,
        ),
        sa.Column("mode", sqlmodel.sql.sqltypes.AutoString(length=32), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["actor_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["subject_user_id"], ["user.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_view_as_sessions_created_at", "view_as_sessions", ["created_at"]
    )
    op.create_index(
        "ix_view_as_sessions_actor_user_id", "view_as_sessions", ["actor_user_id"]
    )
    op.create_index(
        "ix_view_as_sessions_subject_user_id", "view_as_sessions", ["subject_user_id"]
    )

    # `ON CONFLICT DO NOTHING` keeps this idempotent, the same way ticket 07's
    # Admin grant is: `prestart.sh` runs `alembic upgrade head` on every deploy,
    # and a revision that can only be applied to a database in one exact state
    # is a revision that eventually stops the deploy.
    op.execute(
        sa.text(
            """
            INSERT INTO rbac_user_roles (user_id, role_id)
            SELECT id, 'owner' FROM "user" WHERE is_superuser IS TRUE
            ON CONFLICT DO NOTHING
            """
        )
    )


def downgrade():
    op.execute(sa.text("DELETE FROM rbac_user_roles WHERE role_id = 'owner'"))
    op.drop_index("ix_view_as_sessions_subject_user_id", table_name="view_as_sessions")
    op.drop_index("ix_view_as_sessions_actor_user_id", table_name="view_as_sessions")
    op.drop_index("ix_view_as_sessions_created_at", table_name="view_as_sessions")
    op.drop_table("view_as_sessions")
