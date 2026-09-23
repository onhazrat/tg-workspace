"""A Channel's Language is derived from its Posts (LANG-02, ADR-021).

Every existing `tg_channels.language` came from one of the two retired
detectors: display names from the server (`Persian`) or from a browser, or a
bare ISO 639-3 code when `langs` had no name (`pes`). None of it is in the
vocabulary the derivation writes, so it is discarded rather than translated.
The next batch of Posts written to a Channel labels it again, and LANG-03's
walk labels the rest as it reads the stored Posts.

One UPDATE over one row per Channel, a few thousand on staging.

Revision ID: cb38e8223f97
Revises: c773fdab0741
Create Date: 2026-09-23 18:00:00.000000

"""

from alembic import op

# revision identifiers, used by Alembic.
revision = "cb38e8223f97"
down_revision = "c773fdab0741"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE tg_channels SET language = NULL WHERE language IS NOT NULL")


def downgrade():
    # The retired labels are gone; the derivation writes codes either way.
    pass
