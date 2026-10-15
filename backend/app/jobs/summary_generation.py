"""Summary Attempts on the worker, in a generation Lane of their own (ADR-030).

A Summary used to be generated inside the API request that streamed it to the
browser, so a sleeping laptop or a closed tab killed it. Now the API starts an
Attempt (a `running` row plus one message on `GENERATION_LANE`) and rings the
worker; the worker claims the message, calls the Provider and writes the
answer. The page watches over SSE, and can come back mid-Attempt from any
device.

**Its own Lane and its own concurrency, outside the scraping Partition.** A
Summary holds its slot for as long as the model takes to answer, minutes for a
long report. Drained by the sync consumer it would hold a proxy Slot that long
and take that throughput from Telegram syncs, so it is drained here, by its own
consumer, `GENERATION_CONCURRENCY` at a time, and `DRAIN_ORDER` never names it.

**At most once.** The message is archived the moment it is claimed: a crashed
worker must not redeliver an Attempt that may already have spent the Account's
Key. The worker's startup reconciles instead, failing every running Attempt
whose message is gone (`reconcile_interrupted_attempts`).

**Progress crosses processes over `LISTEN`/`NOTIFY`.** Every chunk is announced
on `ATTEMPT_EVENTS_CHANNEL` with its offset, and the text so far is written to
the row every `FLUSH_SECONDS`. A watcher starts from the row and fills in from
the notifications, so a notification lost or dropped for size costs at most
one flush of freshness. Stop travels the same channel the other way, as sync
cancellation does: the API ends the row `stopped` and announces it; the worker
running that Attempt cancels its stream and keeps the text it had.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session

from app.ai.base import LLMProvider
from app.ai.failures import (
    EMPTY_ANSWER_DETAIL,
    failure_detail,
    provider_code,
    retry_after_seconds,
)
from app.ai.registry import default_model, get_provider, is_credential_rejection
from app.core import acting_owner, pg_notify
from app.core.db import engine
from app.models_tg import Summary, SummaryAttempt, SummaryPayload
from app.prompts.summary import format_summary_prompt
from app.schemas.post_filter import to_steps
from app.services import pgmq
from app.services.ai_keys import (
    Purpose,
    ResolvedKey,
    record_validation,
    resolve_ai_key,
)
from app.services.logs import upsert_llm_log
from app.services.prompt_assembly import PromptScope, assemble_posts_text
from app.services.summaries import frozen_scope_of, own_summary, store_prompt
from app.services.summary_attempts import (
    ATTEMPT_NOT_RUNNING_DETAIL,
    ATTEMPT_RUNNING_DETAIL,
    begin_attempt,
    cited_posts,
    claim_attempt,
    end_attempt,
    exception_kind,
    fail_interrupted,
    failure_kind,
    get_attempt,
    last_attempt,
    record_attempt,
    running_attempt,
    save_progress,
    withdraw_attempt,
)
from app.services.sync_meta import touch_sync

logger = logging.getLogger(__name__)

#: The queue Attempts wait on. Created by migration `b7d2e9f4a1c6`.
GENERATION_LANE = "summary_generation"
#: Rung by every start, as `SYNC_LANE_WAKE_CHANNEL` is by every sync enqueue.
GENERATION_WAKE_CHANNEL = "summary_generation_wake"
#: Chunks, ends and Stops, each naming its Attempt.
ATTEMPT_EVENTS_CHANNEL = "summary_attempt_events"

#: Attempts one worker runs at once. Each is one Provider stream, waiting on a
#: remote model rather than on this process.
GENERATION_CONCURRENCY = 4
#: How often a running Attempt writes its text so far to its row.
FLUSH_SECONDS = 1.0
#: How long a watcher waits on notifications before reading the row again,
#: and how long the consumer waits on a ring before sweeping the Lane.
WATCH_POLL_SECONDS = 1.0
SWEEP_SECONDS = 30.0
#: Only covers claim-then-archive, which happen in one transaction.
_CLAIM_VT_SECONDS = 60
#: The temperature Generate always used when nobody chose one.
DEFAULT_TEMPERATURE = 0.7
#: How long the automatic retry of a transient failure waits when the Provider
#: named no Retry-After (SFR-03), and the most it waits when it did.
RETRY_DELAY_SECONDS = 10.0
MAX_RETRY_DELAY_SECONDS = 600.0
#: Why an Attempt was refused before a Provider was reached.
_LEGACY_SCOPE_DETAIL = "This Summary records no Scope, so no prompt can be built."
_NO_PROMPT_DETAIL = "This Summary has no prompt to run."


def _provider_for(
    session: Session, *, user_id: uuid.UUID, key_id: str | None
) -> tuple[LLMProvider, ResolvedKey]:
    """Whose Key pays (the Summary's owner, ADR-016), and the client to spend it."""
    key = resolve_ai_key(
        session, user_id=user_id, purpose=Purpose.SUMMARY, key_id=key_id
    )
    return (
        get_provider(provider=key.provider, api_key=key.api_key, base_url=key.base_url),
        key,
    )


# --- Starting -------------------------------------------------------------


def _acted_by(session: Session) -> dict[str, str] | None:
    """The acting Owner of a View-as spend, as the queue message carries it.

    The worker has no request to read it off, and a Generate an Owner started
    must still be credited to them when the worker writes the answer and its
    AI log row (CLAUDE.md: `acted_by_*` on every write, `LLMLog` included).
    """
    owner = acting_owner.current(session)
    return {"userId": str(owner.user_id), "email": owner.email} if owner else None


def _owner_from(message: dict[str, Any]) -> acting_owner.ActingOwner | None:
    acted = message.get("actedBy")
    if not isinstance(acted, dict):
        return None
    return acting_owner.ActingOwner(
        user_id=uuid.UUID(str(acted["userId"])), email=str(acted["email"])
    )


@contextlib.contextmanager
def _session_as(owner: acting_owner.ActingOwner | None) -> Iterator[Session]:
    """A worker `Session` whose writes are credited as the start request's were."""
    with Session(engine) as session:
        acting_owner.bind(session, owner)
        yield session


def _prompt_from_scope(session: Session, summary: Summary) -> str:
    """The prompt a Summary's frozen Scope reads, as Generate would build it.

    For a Summary that never got as far as storing one: a passing sync or
    network failure can then be retried as it is. A 413 from the assembly is
    the token limit, and the caller records it as such.
    """
    frozen = frozen_scope_of(summary)
    if frozen is None:
        raise HTTPException(status_code=422, detail=_LEGACY_SCOPE_DETAIL)
    channels = list(frozen.channels)
    scope = PromptScope(
        channels=channels,
        start_date=frozen.start,
        end_date=frozen.end,
        steps=to_steps(frozen.selection) if frozen.selection is not None else None,
        view_measure=frozen.view_measure,
        sort=frozen.sort,
        group_by_channel=frozen.group_by_channel,
    )
    return format_summary_prompt(
        channels=channels,
        language=summary.language,
        posts_text=assemble_posts_text(session, scope, user_id=summary.user_id),
    )


def start_attempt(
    session: Session,
    summary_id: str,
    *,
    user_id: uuid.UUID,
    model: str | None,
    key_id: str | None,
    temperature: float | None,
    scheduled: bool = False,
) -> SummaryAttempt:
    """Start an Attempt and hand it to the worker; nothing is generated here.

    The model and Key default to the last Attempt's. A refusal before any
    Provider is reached (no prompt can be built, the Key cannot be used) is
    recorded as a failed Attempt and returned, so it lands on the Summary's page
    rather than in a toast. The token limit is decided before a Key is looked
    at, so it charges and names none. A Key that cannot be used also files a
    failed AI log row, as every refused spend does. `scheduled` is the
    scheduler's own regeneration (SFR-03).
    """
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    if running_attempt(session, summary.id) is not None:
        raise HTTPException(status_code=409, detail=ATTEMPT_RUNNING_DETAIL)
    # A Summary with a report may be retried: success replaces the text, and
    # a failure leaves it readable (`mark_summary_failed`).
    previous = last_attempt(session, summary.id)
    model = model or (previous.model if previous else None) or summary.model
    model = model or default_model()
    if key_id is None:
        key_id = previous.key_id if previous else (summary.extra or {}).get("aiKeyId")

    def refused(detail: str, kind: Any, key: str | None) -> SummaryAttempt:
        return record_attempt(
            session,
            summary.id,
            user_id=user_id,
            outcome="failed",
            kind=kind,
            error=detail,
            model=model,
            key_id=key,
            started_at=now,
            scheduled=scheduled,
        )

    now = int(time.time() * 1000)
    payload = session.get(SummaryPayload, summary.id)
    if payload is None or payload.prompt_text is None:
        try:
            store_prompt(session, summary, _prompt_from_scope(session, summary))
            # Kept even if the Key below is refused: "Use another AI" needs it.
            session.commit()
        except HTTPException as exc:
            return refused(str(exc.detail), failure_kind(exc.status_code), None)
    try:
        _, key = _provider_for(session, user_id=summary.user_id, key_id=key_id)
    except Exception as exc:
        # `Exception`, not `HTTPException`: `decrypt_token` raises a bare
        # `ValueError` for a row that is not encrypted, and that refusal must
        # land on the page and in the log like any other.
        detail = _refusal_detail(exc)
        _log_refusal(session, summary, model=model, error=detail)
        return refused(detail, "auth", key_id)
    attempt = begin_attempt(
        session,
        summary,
        model=model,
        key_id=key.credential_id,
        scheduled=scheduled,
    )
    pgmq.send(
        session,
        GENERATION_LANE,
        {
            "attemptId": attempt.id,
            "temperature": temperature,
            "actedBy": _acted_by(session),
        },
    )
    session.commit()
    session.refresh(attempt)
    touch_sync(session, "summaries")
    # Best-effort, like every ring: a lost one waits for the sweep.
    try:
        pg_notify.publish(GENERATION_WAKE_CHANNEL, {"attemptId": attempt.id})
    except Exception:  # noqa: BLE001
        logger.warning("failed to ring the worker for attempt %s", attempt.id)
    return attempt


def _refusal_detail(exc: BaseException) -> str:
    return str(exc.detail) if isinstance(exc, HTTPException) else str(exc)


def _log_refusal(session: Session, summary: Summary, *, model: str, error: str) -> None:
    """File the failed AI log row of a spend refused before a Provider. Commits.

    Nothing reached an endpoint, so it names no provider. Composed from the
    stored prompt, never from a request, so no credential can reach it.
    """
    payload = session.get(SummaryPayload, summary.id)
    prompt = (payload.prompt_text if payload is not None else None) or ""
    upsert_llm_log(
        session,
        {
            "id": str(uuid.uuid4()),
            "model": model,
            "prompt": prompt,
            "model_config_json": {},
            "full_request": {"prompt": prompt},
            "type": "summary",
            "response": "",
            "status": "failed",
            "error": error,
            "timestamp": int(time.time() * 1000),
            "duration": 0,
        },
        summary.user_id,
    )
    session.commit()
    touch_sync(session, "llm_logs")


def announce_stop(attempt_id: str) -> None:
    """Tell whichever worker runs `attempt_id` that it was stopped."""
    try:
        pg_notify.publish(
            ATTEMPT_EVENTS_CHANNEL, {"attemptId": attempt_id, "outcome": "stopped"}
        )
    except Exception:  # noqa: BLE001
        # The row already says `stopped`; the worker reads it at its next flush.
        logger.warning("failed to announce the stop of attempt %s", attempt_id)


# --- Running (worker) -------------------------------------------------------


def claim_next_attempt() -> dict[str, Any] | None:
    """Take the next message off the Lane, or `None` when it is empty.

    Read and archived in one transaction: from here the Attempt is this
    process's, and a crash leaves it to `reconcile_interrupted_attempts`.
    """
    with Session(engine) as session:
        messages = pgmq.read(
            session, GENERATION_LANE, vt_seconds=_CLAIM_VT_SECONDS, qty=1
        )
        if not messages:
            return None
        msg = messages[0]
        pgmq.archive(session, GENERATION_LANE, msg.msg_id)
        session.commit()
        return dict(msg.message)


def reconcile_interrupted_attempts() -> int:
    """Fail the Attempts a dead worker held. Worker startup only."""
    with Session(engine) as session:
        queued = {
            str(m.message.get("attemptId"))
            for m in pgmq.queued_messages(session, GENERATION_LANE)
        }
        return fail_interrupted(session, still_queued=queued)


@dataclass(frozen=True)
class _Run:
    attempt_id: str
    summary_id: str
    owner_id: uuid.UUID
    model: str
    prompt: str
    key: ResolvedKey
    provider: LLMProvider
    automatic: bool
    scheduled: bool
    acted_by: acting_owner.ActingOwner | None


def _prepare(attempt_id: str, acted_by: acting_owner.ActingOwner | None) -> _Run | None:
    """Everything the stream needs, read and closed before it starts.

    `None` when there is nothing to run: a Stop or a Cancel that came first, or
    a refusal this records as the Attempt's failure.
    """
    with _session_as(acted_by) as session:
        attempt = claim_attempt(session, attempt_id)
        if attempt is None:
            return None
        summary = session.get(Summary, attempt.summary_id)
        payload = session.get(SummaryPayload, attempt.summary_id)
        prompt = payload.prompt_text if payload is not None else None
        if summary is None or not prompt:
            end_attempt(
                session,
                attempt_id,
                outcome="failed",
                text="",
                kind="other",
                error=_NO_PROMPT_DETAIL,
            )
            return None
        try:
            provider, key = _provider_for(
                session, user_id=summary.user_id, key_id=attempt.key_id
            )
        except Exception as exc:
            detail = _refusal_detail(exc)
            _log_refusal(session, summary, model=attempt.model, error=detail)
            end_attempt(
                session,
                attempt_id,
                outcome="failed",
                text="",
                kind="auth",
                error=detail,
            )
            return None
        return _Run(
            attempt_id,
            summary.id,
            summary.user_id,
            attempt.model,
            prompt,
            key,
            provider,
            automatic=attempt.automatic,
            scheduled=attempt.scheduled,
            acted_by=acted_by,
        )


def _log(run: _Run, *, text: str, error: str | None, started: float) -> None:
    """The AI log row the browser used to file, composed without the Key."""
    with _session_as(run.acted_by) as session:
        upsert_llm_log(
            session,
            {
                "id": str(uuid.uuid4()),
                "model": run.model,
                "prompt": run.prompt,
                "model_config_json": {},
                "full_request": {"prompt": run.prompt},
                "type": "summary",
                "provider": run.key.provider,
                "base_url": run.key.base_url,
                "response": text,
                "status": "failed" if error else "success",
                "error": error,
                "timestamp": int(time.time() * 1000),
                "duration": time.perf_counter() - started,
            },
            run.owner_id,
        )
        session.commit()
        touch_sync(session, "llm_logs")


def _finish(
    run: _Run,
    *,
    outcome: Any,
    text: str,
    kind: Any = None,
    error: str | None = None,
) -> None:
    with _session_as(run.acted_by) as session:
        cited = (
            cited_posts(session, text, user_id=run.owner_id)
            if outcome == "succeeded"
            else None
        )
        end_attempt(
            session,
            run.attempt_id,
            outcome=outcome,
            text=text,
            kind=kind,
            error=error,
            cited_posts=cited,
        )
        touch_sync(session, "summaries")


def _publish(payload: dict[str, Any]) -> None:
    try:
        pg_notify.publish(ATTEMPT_EVENTS_CHANNEL, payload)
    except Exception:  # noqa: BLE001
        logger.warning("failed to announce attempt progress")


def _save(attempt_id: str, text: str) -> bool:
    with Session(engine) as session:
        return save_progress(session, attempt_id, text)


#: The stream task of every Attempt this process is running, for Stop to cancel.
_streams: dict[str, asyncio.Task[None]] = {}


async def _stream_into(run: _Run, parts: list[str], temperature: float) -> None:
    length = 0
    last_flush = time.monotonic()
    async for chunk in run.provider.stream(
        run.prompt, model=run.model, temperature=temperature
    ):
        parts.append(chunk)
        await asyncio.to_thread(
            _publish, {"attemptId": run.attempt_id, "offset": length, "text": chunk}
        )
        length += len(chunk)
        if time.monotonic() - last_flush >= FLUSH_SECONDS:
            last_flush = time.monotonic()
            if not await asyncio.to_thread(_save, run.attempt_id, "".join(parts)):
                # Stopped, and the `NOTIFY` saying so never arrived.
                raise asyncio.CancelledError


async def run_attempt(message: dict[str, Any]) -> None:
    """Run one claimed Attempt to its end, whatever that end is."""
    _stop_consumer.start()
    attempt_id = str(message["attemptId"])
    run = await asyncio.to_thread(_prepare, attempt_id, _owner_from(message))
    if run is None:
        return
    temperature = message.get("temperature")
    temperature = DEFAULT_TEMPERATURE if temperature is None else float(temperature)
    parts: list[str] = []
    started = time.perf_counter()
    stream = asyncio.create_task(_stream_into(run, parts, temperature))
    _streams[attempt_id] = stream
    outcome: Any = "succeeded"
    kind: Any = None
    error: str | None = None
    asked: float | None = None
    try:
        await stream
    except asyncio.CancelledError:
        current = asyncio.current_task()
        if current is not None and current.cancelling():
            raise  # the worker is shutting down; reconcile fails it on boot
        outcome = "stopped"
    except Exception as exc:
        if run.key.credential_id and is_credential_rejection(exc):
            await asyncio.to_thread(_reject_key, run.key.credential_id)
        if provider_code(exc) is None:
            logger.warning("attempt %s stream failed", attempt_id, exc_info=exc)
        outcome, kind = "failed", exception_kind(exc)
        error = failure_detail(exc, run.key)
        asked = retry_after_seconds(exc)
    finally:
        _streams.pop(attempt_id, None)
    text = "".join(parts)
    if outcome == "succeeded" and not text.strip():
        outcome, kind, error = "failed", "empty", EMPTY_ANSWER_DETAIL
    await asyncio.to_thread(
        _finish, run, outcome=outcome, text=text, kind=kind, error=error
    )
    retry_in: float | None = None
    # Not a View-as spend: its retry would spend the target's Key after the
    # Owner's Spend session may have ended. The Owner retries it by hand.
    if kind == "transient" and not run.automatic and run.acted_by is None:
        retry_in = min(
            RETRY_DELAY_SECONDS if asked is None else asked, MAX_RETRY_DELAY_SECONDS
        )
        if not await asyncio.to_thread(_queue_retry, run, message, retry_in):
            retry_in = None
    # After the rows are written, so a watcher reading them on this sees the
    # end and any retry it queued.
    await asyncio.to_thread(_publish, {"attemptId": attempt_id, "outcome": outcome})
    log_error = "Stopped." if outcome == "stopped" else error
    await asyncio.to_thread(_log, run, text=text, error=log_error, started=started)
    if retry_in is not None:
        _ring_after(retry_in)
    elif run.scheduled and outcome != "stopped":
        await _after_scheduled(run.summary_id, outcome=outcome, kind=kind)


async def _after_scheduled(summary_id: str, *, outcome: Any, kind: Any) -> None:
    """Hand a scheduled Attempt's end to the scheduler that started it.

    Imported here because the scheduler imports this module to start them.
    """
    from app.jobs import auto_summary

    await auto_summary.after_scheduled_attempt(summary_id, outcome=outcome, kind=kind)


def _queue_retry(run: _Run, message: dict[str, Any], delay: float) -> bool:
    """Queue the one automatic retry of a transient failure (SFR-03).

    The worker's, so a scheduled Summary or a closed tab recovers too. On the
    same model and Key, flagged `automatic`, and due after `delay`: the page
    counts down to its start and can withdraw it. Not when an Attempt was
    started by hand in the meantime.
    """
    seconds = max(0, round(delay))
    with _session_as(run.acted_by) as session:
        summary = session.get(Summary, run.summary_id)
        if summary is None or running_attempt(session, summary.id) is not None:
            return False
        try:
            retry = begin_attempt(
                session,
                summary,
                model=run.model,
                key_id=run.key.credential_id,
                automatic=True,
                scheduled=run.scheduled,
                starts_at=int(time.time() * 1000) + seconds * 1000,
            )
        except HTTPException:
            return False  # a start by hand won the race
        pgmq.send(
            session,
            GENERATION_LANE,
            {**message, "attemptId": retry.id},
            delay_seconds=seconds,
        )
        session.commit()
        touch_sync(session, "summaries")
        return True


#: Rings waiting to fire, held so nothing collects them first.
_rings: set[asyncio.TimerHandle] = set()


def _ring_after(delay: float) -> None:
    """Wake the consumer when a delayed retry falls due; the sweep backstops it."""

    def ring() -> None:
        _rings.discard(handle)
        with contextlib.suppress(Exception):
            pg_notify.publish(GENERATION_WAKE_CHANNEL, {})

    handle = asyncio.get_running_loop().call_later(delay, ring)
    _rings.add(handle)


def cancel_attempt(
    session: Session, summary_id: str, attempt_id: str, *, user_id: uuid.UUID
) -> None:
    """Withdraw an Attempt still waiting on the Lane: the countdown's Cancel.

    Taking its message off the queue is the test of "not started": a worker
    archives the message as it claims it, so once that has happened there is
    nothing left to delete and the Attempt is refused as running.
    """
    attempt = get_attempt(session, summary_id, attempt_id, user_id=user_id)
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    waiting = [
        m.msg_id
        for m in pgmq.queued_messages(session, GENERATION_LANE)
        if str(m.message.get("attemptId")) == attempt.id
    ]
    if (
        attempt.outcome != "running"
        or not waiting
        or not pgmq.delete(session, GENERATION_LANE, waiting[0])
    ):
        raise HTTPException(status_code=409, detail=ATTEMPT_NOT_RUNNING_DETAIL)
    withdraw_attempt(session, summary, attempt.id)
    touch_sync(session, "summaries")


def _reject_key(credential_id: str) -> None:
    with Session(engine) as session:
        record_validation(session, credential_id, valid=False)


async def run_next_attempt() -> str | None:
    """Claim and run one Attempt to its end; the id, or `None` if none waited."""
    message = await asyncio.to_thread(claim_next_attempt)
    if message is None:
        return None
    await run_attempt(message)
    return str(message["attemptId"])


async def _consume_stops() -> None:
    queue = pg_notify.listener(ATTEMPT_EVENTS_CHANNEL).subscribe()
    while True:
        event = await queue.get()
        if event.get("outcome") == "stopped":
            stream = _streams.get(str(event.get("attemptId")))
            if stream is not None:
                stream.cancel()


_stop_consumer = pg_notify.NotificationConsumer(_consume_stops)

_running: set[asyncio.Task[None]] = set()


async def drain_generation_lane() -> None:
    """Start waiting Attempts until the Lane is empty or every slot is busy."""
    while len(_running) < GENERATION_CONCURRENCY:
        message = await asyncio.to_thread(claim_next_attempt)
        if message is None:
            return
        task = asyncio.create_task(_run_then_drain(message))
        _running.add(task)
        task.add_done_callback(_running.discard)


async def _run_then_drain(message: dict[str, Any]) -> None:
    try:
        await run_attempt(message)
    except Exception:  # noqa: BLE001
        logger.exception("attempt %s failed to run", message.get("attemptId"))
    # A slot is free: whatever waited behind a full house starts now.
    with contextlib.suppress(Exception):
        await drain_generation_lane()


async def _consume_wakes() -> None:
    queue = pg_notify.listener(GENERATION_WAKE_CHANNEL).subscribe()
    while True:
        try:
            await drain_generation_lane()
        except Exception:  # noqa: BLE001
            logger.exception("generation lane drain failed")
        # The sweep is the backstop for a ring that was lost.
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(queue.get(), timeout=SWEEP_SECONDS)


_generation_consumer = pg_notify.NotificationConsumer(_consume_wakes)


def start_generation_consumer() -> None:
    """Drain the generation Lane on every ring. Worker process only."""
    _stop_consumer.start()
    _generation_consumer.start()


def stop_generation_consumer() -> None:
    _generation_consumer.stop()
    _stop_consumer.stop()


# --- Watching (API) ---------------------------------------------------------


def _snapshot(attempt_id: str) -> tuple[str, str, str | None] | None:
    """`(outcome, text so far, error)` as the rows hold them."""
    with Session(engine) as session:
        attempt = session.get(SummaryAttempt, attempt_id)
        if attempt is None:
            return None
        if attempt.outcome == "succeeded":
            summary = session.get(Summary, attempt.summary_id)
            text = summary.text if summary is not None else ""
        else:
            text = attempt.partial_text or ""
        return attempt.outcome, text, attempt.error


def merge_text(known: str, row_text: str, parked: dict[int, str]) -> str:
    """The longest text these pieces agree on.

    Every piece is a prefix-or-slice of the same answer: the row is a prefix
    written at the last flush, and each notification is a slice at an offset.
    A slice past the end of what is known waits in `parked` until the row or
    an earlier slice reaches it.
    """
    text = row_text if len(row_text) > len(known) else known
    for offset in sorted(parked):
        if offset > len(text):
            break
        chunk = parked.pop(offset)
        if offset + len(chunk) > len(text):
            text = text[:offset] + chunk
    return text


def _frame(payload: dict[str, Any]) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def watch_attempt(attempt_id: str) -> AsyncIterator[str]:
    """SSE frames: the text as it arrives, then how the Attempt ended.

    `{"text": ...}` frames carry only what is new, so a page appends them; the
    first one is everything written so far, which is what lets a page opened
    mid-Attempt attach. The last frame is `{"outcome", "error"}`, then `[DONE]`.
    """
    queue = pg_notify.listener(ATTEMPT_EVENTS_CHANNEL).subscribe()
    try:
        known, sent = "", 0
        parked: dict[int, str] = {}
        while True:
            snap = await asyncio.to_thread(_snapshot, attempt_id)
            if snap is None:
                return
            outcome, row_text, error = snap
            known = merge_text(known, row_text, parked)
            if outcome != "running":
                # The row is the answer once it has ended.
                known = row_text if len(row_text) >= len(known) else known
            if len(known) > sent:
                yield _frame({"text": known[sent:]})
                sent = len(known)
            if outcome != "running":
                yield _frame({"outcome": outcome, "error": error})
                yield "data: [DONE]\n\n"
                return
            while True:
                try:
                    event = await asyncio.wait_for(
                        queue.get(), timeout=WATCH_POLL_SECONDS
                    )
                except TimeoutError:
                    break
                if event.get("attemptId") != attempt_id:
                    continue
                if "offset" not in event:
                    break  # it ended: the row has the rest
                parked[int(event["offset"])] = str(event.get("text", ""))
                known = merge_text(known, "", parked)
                if len(known) > sent:
                    yield _frame({"text": known[sent:]})
                    sent = len(known)
    finally:
        pg_notify.listener(ATTEMPT_EVENTS_CHANNEL).unsubscribe(queue)
