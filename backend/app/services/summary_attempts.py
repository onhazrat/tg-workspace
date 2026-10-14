"""Summary Attempts: every request for a Summary's prose, and how it ended.

The aggregate of `tg_summary_attempts` and its only writer (ADR-030). An
Attempt outlives log retention, so a Summary keeps every reason it failed for
as long as it exists, and is deleted with it by the foreign key's cascade.

The Summary row itself is `summaries.py`'s: a failure here asks that module to
mark it Failed, and both writes land in one commit.
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import func
from sqlmodel import Session, col, select

from app.models_tg import SummaryAttempt, utc_now
from app.schemas.summaries import (
    AttemptKind,
    AttemptOutcome,
    SummaryAttemptResponse,
)
from app.services.summaries import mark_summary_failed, own_summary


def now_ms() -> int:
    return int(utc_now().timestamp() * 1000)


def failure_kind(status: int | None) -> AttemptKind:
    """What kind of failure an HTTP status is. Never read off message text.

    `None` is a request nothing answered: a dropped connection or a timeout,
    which is worth trying again. So is any 5xx, overloads included. 413 is the
    prompt that does not fit, whether the server's assembly or the Provider
    refused it.
    """
    if status is None or status == 408 or status >= 500:
        return "transient"
    if status == 429:
        return "quota"
    if status in (401, 403):
        return "auth"
    if status == 404:
        return "model"
    if status == 413:
        return "limit"
    return "other"


def _next_number(session: Session, summary_id: str) -> int:
    highest = session.exec(
        select(func.max(SummaryAttempt.attempt)).where(
            SummaryAttempt.summary_id == summary_id
        )
    ).one()
    return (highest or 0) + 1


def record_attempt(
    session: Session,
    summary_id: str,
    *,
    user_id: uuid.UUID,
    outcome: AttemptOutcome,
    model: str,
    key_id: str | None,
    started_at: int,
    kind: AttemptKind | None = None,
    error: str | None = None,
    partial_text: str | None = None,
) -> SummaryAttempt:
    """Record one finished Attempt; a failed one marks its Summary Failed.

    The Summary is looked up with the write guard, so a foreign id is this
    family's 404 and nothing is written.
    """
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    attempt = SummaryAttempt(
        id=str(uuid.uuid4()),
        summary_id=summary_id,
        user_id=summary.user_id,
        attempt=_next_number(session, summary_id),
        outcome=outcome,
        kind=kind,
        error=error,
        model=model,
        key_id=key_id,
        partial_text=partial_text or None,
        started_at=started_at,
        ended_at=now_ms(),
    )
    session.add(attempt)
    if outcome == "failed":
        mark_summary_failed(session, summary)
    session.commit()
    session.refresh(attempt)
    return attempt


def restore_attempt(
    session: Session, item: dict[str, Any], *, user_id: uuid.UUID
) -> None:
    """Put back one exported Attempt on a Summary the import already checked.

    Stamped with the subject, never an owner the document names. Its number is
    kept unless another Attempt of that Summary holds it, which only a
    document mixed from two installs can produce; it then takes the next one.
    Not committed: an import is one transaction.
    """
    parsed = SummaryAttemptResponse.model_validate(item)
    fields = parsed.model_dump(exclude={"id"})
    taken = session.exec(
        select(SummaryAttempt.id).where(
            SummaryAttempt.summary_id == parsed.summary_id,
            SummaryAttempt.attempt == parsed.attempt,
        )
    ).first()
    if taken is not None and taken != parsed.id:
        fields["attempt"] = _next_number(session, parsed.summary_id)
    row = session.get(SummaryAttempt, parsed.id) or SummaryAttempt(
        id=parsed.id, **fields, user_id=user_id
    )
    for name, value in fields.items():
        setattr(row, name, value)
    row.user_id = user_id
    session.add(row)
    session.flush()


def list_attempts(
    session: Session, summary_id: str, *, user_id: uuid.UUID
) -> list[SummaryAttempt]:
    """A Summary's Attempts, oldest first. A foreign Summary is its 404."""
    own_summary(session, summary_id, user_id=user_id, writing=False)
    return list(
        session.exec(
            select(SummaryAttempt)
            .where(SummaryAttempt.summary_id == summary_id)
            .order_by(col(SummaryAttempt.attempt))
        ).all()
    )


def attempt_to_camel(attempt: SummaryAttempt) -> dict[str, Any]:
    return {
        "id": attempt.id,
        "summaryId": attempt.summary_id,
        "attempt": attempt.attempt,
        "outcome": attempt.outcome,
        "kind": attempt.kind,
        "error": attempt.error,
        "model": attempt.model,
        "keyId": attempt.key_id,
        "partialText": attempt.partial_text,
        "partialDismissedAt": attempt.partial_dismissed_at,
        "automatic": attempt.automatic,
        "scheduled": attempt.scheduled,
        "startedAt": attempt.started_at,
        "endedAt": attempt.ended_at,
    }
