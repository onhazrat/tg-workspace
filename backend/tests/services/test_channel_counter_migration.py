"""The migration turns stored counter text into the numbers it stands for (ADR-023).

The five Channel counters were stored as Telegram renders them ("28.3K"). The
migration converts them in SQL, so its parse has to agree with the scraper's
`parse_abbreviated_count` on every shape staging holds, and it must refuse to
run rather than null out a value it cannot read.

Watched to fail:
  * drop the `m` multiplier -> "1.2M" reads 1.2 and the parse test fails
  * truncate instead of round -> "16.4M" reads 16399999
  * skip the unparsable pre-check -> the refusal test fails
"""

from __future__ import annotations

import importlib

import pytest
import sqlalchemy as sa

from app.core.db import engine

mig = importlib.import_module(
    "app.alembic.versions.a7c3e9f1d2b4_channel_counters_are_numbers"
)


def _parse(raw: str | None) -> int | None:
    with engine.connect() as conn:
        value = conn.execute(
            sa.text(f"SELECT {mig.counter_to_int_sql('v')} FROM (SELECT :raw AS v) s"),
            {"raw": raw},
        ).scalar()
    return None if value is None else int(value)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("877", 877),
        ("9.24K", 9_240),
        ("28.3K", 28_300),
        ("166K", 166_000),
        ("1.2M", 1_200_000),
        ("16.4M", 16_400_000),
        ("8 214", 8_214),
        ("1,024", 1_024),
        (None, None),
        ("", None),
    ],
)
def test_the_sql_parse_reads_every_shape_telegram_renders(
    raw: str | None, expected: int | None
) -> None:
    assert _parse(raw) == expected


def test_text_that_is_not_a_count_parses_to_nothing() -> None:
    assert _parse("about a dozen") is None
    assert _parse("1.2.3") is None


def test_the_migration_refuses_a_counter_it_cannot_read() -> None:
    """A value that does not parse stops the upgrade instead of vanishing."""
    with engine.connect() as conn:
        conn.execute(
            sa.text(
                "CREATE TEMP TABLE counters_probe (subscribers varchar);"
                "INSERT INTO counters_probe VALUES ('12.5K'), ('about a dozen')"
            )
        )
        with pytest.raises(RuntimeError, match="about a dozen"):
            mig.refuse_unparsable(conn, "counters_probe", ["subscribers"])
