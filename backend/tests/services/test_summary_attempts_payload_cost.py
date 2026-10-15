"""Listing a Summary's Attempts ships their Partial responses and nothing heavier.

The Attempts list returns each Attempt's `partialText` on purpose: a Summary
rarely has more than a handful of Attempts, and the failure page shows the text
without a second round trip (ADR-030). What it must never carry is the
Summary's own corpus-sized fields, the stored prompt and the Citations, which
live in `tg_summary_payloads` exactly so a list does not detoast them
(`test_summary_list_payload_cost.py` tells that story).

## What is asserted, and in both directions

1. the list does not touch the payload table, even for a Summary whose prompt
   is a megabyte,
2. a page of Attempts with no Partial response serialises to a few hundred
   bytes each, so nothing heavy rides along unseen,
3. a Partial response does come back whole, which is the other direction: a
   guard that passed because the text was dropped would pass on no data.

Mutation-tested: reading `SummaryPayload` in `list_attempts` fails (1); adding
the Summary's prompt to `attempt_to_camel` fails (2).
"""

from __future__ import annotations

import json
import time

from sqlmodel import Session

from app.core.db import engine
from app.services.summaries import upsert_summary
from app.services.summary_attempts import (
    attempt_to_camel,
    list_attempts,
    record_attempt,
)
from tests.services.test_summary_list_payload_cost import PAYLOAD_TABLE, captured_sql
from tests.utils.tenancy import ANY_READER

#: Generous for one Attempt's ids, model, error and times as JSON.
BYTES_PER_ATTEMPT = 600


def _summary_with_attempts(
    session: Session, summary_id: str, *, count: int, partial: str | None = None
) -> None:
    upsert_summary(
        session,
        summary_id,
        {"text": "", "channels": [], "timestamp": 1, "promptText": "p" * 1_000_000},
        user_id=ANY_READER,
    )
    for _ in range(count):
        record_attempt(
            session,
            summary_id,
            user_id=ANY_READER,
            outcome="failed",
            kind="transient",
            error="The AI model is overloaded right now.",
            model="gemini-2.5-flash",
            key_id=None,
            started_at=int(time.time() * 1000),
            partial_text=partial,
        )


def test_listing_attempts_does_not_touch_the_payload_table() -> None:
    with Session(engine) as session:
        _summary_with_attempts(session, "attempt-cost-list", count=3)

        with captured_sql() as statements:
            list_attempts(session, "attempt-cost-list", user_id=ANY_READER)

    assert statements, "no SQL captured; the listener is not wired up"
    offenders = [s for s in statements if PAYLOAD_TABLE in s]
    assert not offenders, f"list_attempts read the payload table: {offenders}"


def test_a_page_of_attempts_carries_nothing_heavy() -> None:
    with Session(engine) as session:
        _summary_with_attempts(session, "attempt-cost-size", count=20)
        rows = list_attempts(session, "attempt-cost-size", user_id=ANY_READER)
        body = json.dumps([attempt_to_camel(a) for a in rows])

    assert len(rows) == 20
    assert len(body) < 20 * BYTES_PER_ATTEMPT, f"{len(body)} bytes for 20 Attempts"


def test_a_partial_response_comes_back_whole() -> None:
    with Session(engine) as session:
        _summary_with_attempts(
            session, "attempt-cost-partial", count=1, partial="half " * 20_000
        )
        [row] = list_attempts(session, "attempt-cost-partial", user_id=ANY_READER)

    assert attempt_to_camel(row)["partialText"] == "half " * 20_000
