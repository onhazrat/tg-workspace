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
import re
import time
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session

from app.ai.base import LLMProvider
from app.ai.failures import EMPTY_ANSWER_DETAIL, failure_detail, provider_code
from app.ai.registry import default_model, get_provider, is_credential_rejection
from app.core import pg_notify
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
from app.services.posts import lookup_posts
from app.services.prompt_assembly import PromptScope, assemble_posts_text
from app.services.summaries import frozen_scope_of, own_summary, store_prompt
from app.services.summary_attempts import (
    ATTEMPT_RUNNING_DETAIL,
    begin_attempt,
    end_attempt,
    fail_interrupted,
    failure_kind,
    last_attempt,
    record_attempt,
    running_attempt,
    save_progress,
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
) -> SummaryAttempt:
    """Start an Attempt and hand it to the worker; nothing is generated here.

    The model and Key default to the last Attempt's. A refusal before any
    Provider is reached (no prompt can be built, the Key cannot be used) is
    recorded as a failed Attempt and returned, so it lands on the Summary's page
    rather than in a toast. The token limit is decided before a Key is looked
    at, so it charges and names none.
    """
    summary = own_summary(session, summary_id, user_id=user_id, writing=True)
    if running_attempt(session, summary.id) is not None:
        raise HTTPException(status_code=409, detail=ATTEMPT_RUNNING_DETAIL)
    previous = last_attempt(session, summary.id)
    model = model or (previous.model if previous else None) or summary.model
    model = model or default_model()
    if key_id is None:
        key_id = previous.key_id if previous else (summary.extra or {}).get("aiKeyId")

    def refused(exc: HTTPException, kind: Any, key: str | None) -> SummaryAttempt:
        return record_attempt(
            session,
            summary.id,
            user_id=user_id,
            outcome="failed",
            kind=kind,
            error=str(exc.detail),
            model=model,
            key_id=key,
            started_at=now,
        )

    now = int(time.time() * 1000)
    payload = session.get(SummaryPayload, summary.id)
    if payload is None or payload.prompt_text is None:
        try:
            store_prompt(session, summary, _prompt_from_scope(session, summary))
            # Kept even if the Key below is refused: "Use another AI" needs it.
            session.commit()
        except HTTPException as exc:
            return refused(exc, failure_kind(exc.status_code), None)
    try:
        _, key = _provider_for(session, user_id=summary.user_id, key_id=key_id)
    except HTTPException as exc:
        return refused(exc, "auth", key_id)
    attempt = begin_attempt(session, summary, model=model, key_id=key.credential_id)
    pgmq.send(
        session,
        GENERATION_LANE,
        {"attemptId": attempt.id, "temperature": temperature},
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
    owner_id: uuid.UUID
    model: str
    prompt: str
    key: ResolvedKey
    provider: LLMProvider


def _prepare(attempt_id: str) -> _Run | None:
    """Everything the stream needs, read and closed before it starts.

    `None` when there is nothing to run: a Stop that came first, or a refusal
    this records as the Attempt's failure.
    """
    with Session(engine) as session:
        attempt = session.get(SummaryAttempt, attempt_id)
        if attempt is None or attempt.outcome != "running":
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
        except HTTPException as exc:
            end_attempt(
                session,
                attempt_id,
                outcome="failed",
                text="",
                kind="auth",
                error=str(exc.detail),
            )
            return None
        return _Run(attempt_id, summary.user_id, attempt.model, prompt, key, provider)


def _cited_posts(session: Session, text: str, *, user_id: uuid.UUID) -> dict[str, Any]:
    """`[channel #id]` citations resolved to Posts, keyed `channel-id`.

    What the browser's `resolveCitedPosts` stored, read through the same
    lookup its hover used; a citation with no Post is left out.
    """
    pairs = list(dict.fromkeys(_citation_refs(text)))
    if not pairs:
        return {}
    found = {
        (row["channelName"], row["id"]): row
        for row in lookup_posts(session, pairs, user_id=user_id)
    }
    return {f"{c}-{p}": found[(c, p)] for c, p in pairs if (c, p) in found}


#: `[channel #id]`, as the prompt asks the model to cite and the page parses.
_CITATION_RE = re.compile(r"\[([^\]]+?)\s*#(\d+)\]")


def _citation_refs(text: str) -> list[tuple[str, int]]:
    return [(m.group(1).strip(), int(m.group(2))) for m in _CITATION_RE.finditer(text)]


def _log(run: _Run, *, text: str, error: str | None, started: float) -> None:
    """The AI log row the browser used to file, composed without the Key."""
    with Session(engine) as session:
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
    with Session(engine) as session:
        cited = (
            _cited_posts(session, text, user_id=run.owner_id)
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
    run = await asyncio.to_thread(_prepare, attempt_id)
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
        outcome, kind = "failed", failure_kind(provider_code(exc))
        error = failure_detail(exc, run.key)
    finally:
        _streams.pop(attempt_id, None)
    text = "".join(parts)
    if outcome == "succeeded" and not text.strip():
        outcome, kind, error = "failed", "empty", EMPTY_ANSWER_DETAIL
    await asyncio.to_thread(
        _finish, run, outcome=outcome, text=text, kind=kind, error=error
    )
    # After the row is written, so a watcher reading it on this sees the end.
    await asyncio.to_thread(_publish, {"attemptId": attempt_id, "outcome": outcome})
    log_error = "Stopped." if outcome == "stopped" else error
    await asyncio.to_thread(_log, run, text=text, error=log_error, started=started)


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
