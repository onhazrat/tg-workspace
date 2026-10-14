"""Summary Attempts: every request for a Summary's prose, and how it ended.

The aggregate of `tg_summary_attempts` and its only writer (ADR-030). An
Attempt outlives log retention, so a Summary keeps every reason it failed for
as long as it exists, and is deleted with it by the foreign key's cascade.

The Summary row itself is `summaries.py`'s: a failure here asks that module to
mark it Failed, and both writes land in one commit.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, update
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, select

from app.models_tg import Summary, SummaryAttempt, utc_now
from app.schemas.summaries import (
    AttemptKind,
    AttemptOutcome,
    SummaryAttemptResponse,
)
from app.services.posts import lookup_posts
from app.services.summaries import (
    SUMMARY_NOT_FOUND,
    finish_summary,
    mark_summary_failed,
    note_write,
    own_summary,
)


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
    scheduled: bool = False,
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
        scheduled=scheduled,
        started_at=started_at,
        ended_at=now_ms(),
    )
    session.add(attempt)
    if outcome == "failed":
        mark_summary_failed(session, summary)
    session.commit()
    session.refresh(attempt)
    return attempt


#: Why an Attempt a dead worker held ends Failed.
INTERRUPTED_DETAIL = "The worker stopped before the answer finished."
#: What a second start or a Stop of a finished Attempt is told.
ATTEMPT_RUNNING_DETAIL = "An Attempt is already running for this Summary."
ATTEMPT_NOT_RUNNING_DETAIL = "This Attempt is not running."


def running_attempt(session: Session, summary_id: str) -> SummaryAttempt | None:
    return session.exec(
        select(SummaryAttempt).where(
            SummaryAttempt.summary_id == summary_id,
            SummaryAttempt.outcome == "running",
        )
    ).first()


def last_attempt(session: Session, summary_id: str) -> SummaryAttempt | None:
    return session.exec(
        select(SummaryAttempt)
        .where(SummaryAttempt.summary_id == summary_id)
        .order_by(col(SummaryAttempt.attempt).desc())
    ).first()


def begin_attempt(
    session: Session,
    summary: Summary,
    *,
    model: str,
    key_id: str | None,
    automatic: bool = False,
    scheduled: bool = False,
    starts_at: int | None = None,
) -> SummaryAttempt:
    """Record a `running` Attempt; the caller commits it with its queue message.

    One running Attempt per Summary: the read below answers the ordinary case
    with a clear 409, and the partial unique index answers the race two
    requests would otherwise both win. `starts_at` is when a delayed message
    becomes due, which is what the page counts down to.
    """
    if running_attempt(session, summary.id) is not None:
        raise HTTPException(status_code=409, detail=ATTEMPT_RUNNING_DETAIL)
    attempt = SummaryAttempt(
        id=str(uuid.uuid4()),
        summary_id=summary.id,
        user_id=summary.user_id,
        attempt=_next_number(session, summary.id),
        outcome="running",
        model=model,
        key_id=key_id,
        automatic=automatic,
        scheduled=scheduled,
        started_at=starts_at if starts_at is not None else now_ms(),
    )
    session.add(attempt)
    try:
        session.flush()
    except IntegrityError as exc:
        session.rollback()
        raise HTTPException(status_code=409, detail=ATTEMPT_RUNNING_DETAIL) from exc
    return attempt


def claim_attempt(session: Session, attempt_id: str) -> SummaryAttempt | None:
    """The running Attempt a worker is about to run, started now. Commits.

    `None` when a Stop or a Cancel came first. The start time moves to now
    because a delayed retry's was when it became due, not when it began.
    """
    session.execute(
        update(SummaryAttempt)
        .where(
            col(SummaryAttempt.id) == attempt_id,
            col(SummaryAttempt.outcome) == "running",
        )
        .values(started_at=now_ms())
    )
    session.commit()
    attempt = session.get(SummaryAttempt, attempt_id)
    return attempt if attempt is not None and attempt.outcome == "running" else None


def withdraw_attempt(session: Session, summary: Summary, attempt_id: str) -> None:
    """Delete an Attempt that never started; the caller took its message. Commits.

    A withdrawn retry asked nobody for anything, so it leaves no record: the
    Attempts a Summary keeps are the requests that were made.
    """
    attempt = session.get(SummaryAttempt, attempt_id)
    if attempt is not None:
        session.delete(attempt)
    note_write(session, summary)
    session.commit()


def save_progress(session: Session, attempt_id: str, text: str) -> bool:
    """Write a running Attempt's text so far. False once it is not running.

    The worker reads the answer as its cue to stop, which is the backstop for a
    Stop whose `NOTIFY` was lost.
    """
    result = session.execute(
        update(SummaryAttempt)
        .where(
            col(SummaryAttempt.id) == attempt_id,
            col(SummaryAttempt.outcome) == "running",
        )
        .values(partial_text=text or None)
    )
    session.commit()
    return bool(getattr(result, "rowcount", 0))


def end_attempt(
    session: Session,
    attempt_id: str,
    *,
    outcome: AttemptOutcome,
    text: str,
    kind: AttemptKind | None = None,
    error: str | None = None,
    cited_posts: dict[str, Any] | None = None,
) -> SummaryAttempt | None:
    """End a running Attempt and write its Summary to match. Commits.

    `succeeded` hands the text to the Summary; anything else keeps it as the
    Attempt's own and leaves the Summary Failed. An Attempt a Stop already
    ended only takes the text the worker had when it heard, which can be more
    than the last write. Anything else that is no longer running is left alone.
    """
    attempt = session.get(SummaryAttempt, attempt_id)
    if attempt is None:
        return None
    if attempt.outcome == "stopped" and outcome == "stopped":
        if len(text) > len(attempt.partial_text or ""):
            attempt.partial_text = text
            session.add(attempt)
            session.commit()
        return attempt
    if attempt.outcome != "running":
        return None
    summary = session.get(Summary, attempt.summary_id)
    attempt.outcome = outcome
    attempt.kind = kind
    attempt.error = error
    attempt.partial_text = None if outcome == "succeeded" else (text or None)
    attempt.ended_at = now_ms()
    session.add(attempt)
    if summary is not None:
        if outcome == "succeeded":
            finish_summary(
                session,
                summary,
                text=text,
                model=attempt.model,
                key_id=attempt.key_id,
                cited_posts=cited_posts or {},
            )
        else:
            mark_summary_failed(session, summary)
    session.commit()
    session.refresh(attempt)
    return attempt


def stop_attempt(
    session: Session, summary_id: str, attempt_id: str, *, user_id: uuid.UUID
) -> SummaryAttempt:
    """End a running Attempt `stopped`, keeping the text it had. Commits.

    Written here rather than left to the worker, so a Stop works whether or not
    a worker ever picked the Attempt up; the worker adds what it had on top.
    """
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    attempt = session.get(SummaryAttempt, attempt_id)
    if attempt is None or attempt.summary_id != summary.id:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    if attempt.outcome != "running":
        raise HTTPException(status_code=409, detail=ATTEMPT_NOT_RUNNING_DETAIL)
    attempt.outcome = "stopped"
    attempt.ended_at = now_ms()
    session.add(attempt)
    mark_summary_failed(session, summary)
    session.commit()
    session.refresh(attempt)
    return attempt


def get_attempt(
    session: Session, summary_id: str, attempt_id: str, *, user_id: uuid.UUID
) -> SummaryAttempt:
    """One of the caller's Attempts, or the Summary family's 404."""
    own_summary(session, summary_id, user_id=user_id, writing=False)
    attempt = session.get(SummaryAttempt, attempt_id)
    if attempt is None or attempt.summary_id != summary_id:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    return attempt


def fail_interrupted(session: Session, *, still_queued: set[str]) -> int:
    """Fail every running Attempt no queue message is waiting to start. Commits.

    The worker takes an Attempt's message off the Lane as it claims it, so a
    running Attempt with no message left belonged to a worker that is gone. One
    still on the Lane is waiting, which is the point of the queue.
    """
    rows = session.exec(
        select(SummaryAttempt).where(SummaryAttempt.outcome == "running")
    ).all()
    failed = 0
    for attempt in rows:
        if attempt.id in still_queued:
            continue
        attempt.outcome = "failed"
        attempt.kind = "transient"
        attempt.error = INTERRUPTED_DETAIL
        attempt.ended_at = now_ms()
        session.add(attempt)
        summary = session.get(Summary, attempt.summary_id)
        if summary is not None:
            mark_summary_failed(session, summary)
        failed += 1
    session.commit()
    return failed


#: `[channel #id]`, as the prompt asks the model to cite and the page parses.
_CITATION_RE = re.compile(r"\[([^\]]+?)\s*#(\d+)\]")


def cited_posts(session: Session, text: str, *, user_id: uuid.UUID) -> dict[str, Any]:
    """`[channel #id]` citations resolved to Posts, keyed `channel-id`.

    What the browser's `resolveCitedPosts` stored, read through the same
    lookup its hover used; a citation with no Post is left out.
    """
    refs = [(m.group(1).strip(), int(m.group(2))) for m in _CITATION_RE.finditer(text)]
    pairs = list(dict.fromkeys(refs))
    if not pairs:
        return {}
    found = {
        (row["channelName"], row["id"]): row
        for row in lookup_posts(session, pairs, user_id=user_id)
    }
    return {f"{c}-{p}": found[(c, p)] for c, p in pairs if (c, p) in found}


# --- Partial responses (SFR-03) ---------------------------------------------

#: What Keep, Dismiss or Restore on an Attempt with no text to act on is told.
NO_PARTIAL_DETAIL = "This Attempt has no Partial response."


def _partial(
    session: Session, summary_id: str, attempt_id: str, *, user_id: uuid.UUID
) -> tuple[Summary, SummaryAttempt]:
    """The caller's Summary and one of its Attempts that holds a Partial response."""
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    attempt = session.get(SummaryAttempt, attempt_id)
    if attempt is None or attempt.summary_id != summary.id:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    if attempt.outcome == "running" or not attempt.partial_text:
        raise HTTPException(status_code=409, detail=NO_PARTIAL_DETAIL)
    return summary, attempt


def keep_partial(
    session: Session, summary_id: str, attempt_id: str, *, user_id: uuid.UUID
) -> SummaryAttempt:
    """Finish the Summary Incomplete with one Attempt's Partial response. Commits.

    Recorded as a `kept_partial` Attempt carrying the source's model and Key,
    which the Summary takes too, so a scheduled run after it pays as the text
    was paid for. The source keeps its text: keeping uses it, nothing deletes
    it. Refused while an Attempt runs, which would overwrite it on finishing.
    """
    summary, source = _partial(session, summary_id, attempt_id, user_id=user_id)
    if running_attempt(session, summary.id) is not None:
        raise HTTPException(status_code=409, detail=ATTEMPT_RUNNING_DETAIL)
    text = source.partial_text or ""
    now = now_ms()
    kept = SummaryAttempt(
        id=str(uuid.uuid4()),
        summary_id=summary.id,
        user_id=summary.user_id,
        attempt=_next_number(session, summary.id),
        outcome="kept_partial",
        model=source.model,
        key_id=source.key_id,
        started_at=now,
        ended_at=now,
    )
    session.add(kept)
    finish_summary(
        session,
        summary,
        text=text,
        model=source.model,
        key_id=source.key_id,
        cited_posts=cited_posts(session, text, user_id=summary.user_id),
        incomplete=True,
    )
    session.commit()
    session.refresh(kept)
    return kept


def set_partial_dismissed(
    session: Session,
    summary_id: str,
    attempt_id: str,
    *,
    user_id: uuid.UUID,
    dismissed: bool,
) -> SummaryAttempt:
    """Dismiss or restore a Partial response; the text stays either way. Commits."""
    summary, attempt = _partial(session, summary_id, attempt_id, user_id=user_id)
    attempt.partial_dismissed_at = now_ms() if dismissed else None
    session.add(attempt)
    note_write(session, summary)
    session.commit()
    session.refresh(attempt)
    return attempt


def trim_dismissed_partials(session: Session, *, cutoff_ms: int) -> int:
    """Clear the text of Partial responses dismissed before `cutoff_ms`. Commits.

    The one retention write on this table, and it deletes no row: an Attempt
    and why it failed are kept for the life of their Summary (ADR-030). Only
    text somebody said they did not need goes, because it is the bulky part.
    """
    result = session.execute(
        update(SummaryAttempt)
        .where(
            col(SummaryAttempt.partial_dismissed_at) < cutoff_ms,
            col(SummaryAttempt.partial_text).is_not(None),
        )
        .values(partial_text=None)
    )
    session.commit()
    return int(getattr(result, "rowcount", 0) or 0)


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
