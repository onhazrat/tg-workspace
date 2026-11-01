"""BYOK-03: a scheduled Summary remembers its Key, and the log says who paid.

Two halves, and they fail for different reasons.

**The unattended path.** `run_auto_summary` fires at 4am with nobody watching,
so every way it can fail has to leave something behind. The three assertions are
that it spends the Key the Summary *named* rather than whichever one is newest,
that a `key_id` naming another Account's row is refused **before**
`decrypt_token` and files a failed row rather than returning quietly
(multi-user-tenancy ticket 33's defect, under a new table), and that a failure —
any failure — leaves `autoRegenerate` alone. The last one is a correction rather
than a new rule: the job used to switch the schedule off whenever an error
mentioned a quota, which was protecting the Operator's single key and now
protects nobody while still losing work.

**The record.** Four columns arrive on `tg_llm_logs`. `provider` and `base_url`
say which endpoint answered, denormalised so the row survives its Key's
deletion. `acted_by_user_id` / `acted_by_email` are the pair all four Artifact
families carry and this table did not, which matters precisely because a *failed*
spend produces no Artifact to carry it. And the credential itself never reaches
the row, which is asserted twice: behaviourally, against a Key whose secret is a
findable string, and structurally, because the failure named in the ticket is an
implementation that logs the request it sent and a Gemini credential travels as a
URL query parameter.

## Mutation evidence

Watched to fail, one change at a time:

* `_regenerate_one` passing `key_id=None` — the "spends the Key it named" test
  goes red on the *base URL*, which is why the fixture gives the two Keys
  different endpoints rather than only different ids;
* narrowing the `new_extra` spread to drop `aiKeyId` — only
  `test_the_regenerated_summary_carries_the_key_forward` moves. Re-listing the
  key explicitly beside `publishBotId` was the first version and it is a **false
  pass**: the spread already carried it, so deleting the explicit line changed
  nothing and the guard proved nothing. The line is gone and the spread is what
  the comment there points at;
* SFR-03 moved the Provider call onto the generation worker: a tick opens the
  successor and starts a `scheduled` Attempt, and these tests drain the Lane
  after it. A quota failure switching the chain off is decided from the
  Attempt's kind (status 429), never from message text;
* `upsert_llm_log` dropping the `acting_owner.stamp` call — nothing here moves
  and `test_view_as_elevation.py::test_an_llm_log_written_during_an_elevation_
  is_attributed` goes red, which is exactly why the attribution is asserted
  there and only its *absence* on an unattended run is asserted here;
* `_log_ai_failure` returning without committing — both refusal tests go red on
  an empty table, the "a log that vanished with the failure" case;
* adding `provider` to `LOG_HEAVY_COLUMNS["llm"]` —
  `test_the_provenance_columns_reach_a_list_page` goes red, because a list page
  never selects a heavy column;
* `"full_request": provider.last_request` — the composition guard goes red, but
  **only after it was rewritten**. Walking the call's arguments was the first
  version and a second false pass: `_run_summary_call` builds its row into a
  local and passes `{**log, …}`, so the argument walk never saw the key;
* a Provider growing a `self.last_request` — the companion guard goes red, which
  is the mutation that makes the one above hard to reach by accident;
* the resolved key spliced into the logged prompt — the secrecy test goes red,
  and it reads the whole row rather than `full_request` alone because an export
  streams every column.

Added after `/code-review` on PR #28, which found three of these before they
shipped:

* narrowing `_run_summary_call`'s resolve guard back to `except HTTPException` —
  `test_a_resolution_failure_that_is_not_an_http_error_still_files_a_row` goes
  red. `decrypt_token` raises a bare `ValueError` outside `local`, so the
  original catch quietly reopened the exact silent failure this module exists to
  close;
* dropping `_record_failure` from the error handler — the backoff test goes red
  on the second tick. Removing the quota auto-disable was right; removing it
  with no damper left a broken Key retrying 1,440 times a day;
* narrowing `_NOT_INHERITED` back to `("autoRegenerate",)` — the clear-on-success
  test goes red, because `extra`'s spread carries the stale ladder onto a
  Summary that has just succeeded. That spread is also how `aiKeyId` travels,
  which is why the same test asserts the Key survived the clearing.
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.core.secrets import encrypt_token
from app.jobs import auto_summary, summary_generation
from app.models import User
from app.models_tg import (
    AICredential,
    LLMLog,
    Post,
    PublishLog,
    Summary,
    SummaryAttempt,
    utc_now,
)
from app.services.ai_keys import AI_CREDENTIAL_NOT_FOUND
from app.services.logs import LOG_HEAVY_COLUMNS, list_logs
from tests.utils.scope import stored_scope
from tests.utils.tenancy import follow_synced
from tests.utils.user import create_random_user

APP_ROOT = pathlib.Path(__file__).resolve().parents[2] / "app"

#: A secret shaped so that finding it in a row is unambiguous. Nothing else in
#: the deployment spells anything like this.
FINDABLE_SECRET = "sk-do-not-log-me-4f2b9c"


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _seed_key(
    session: Session,
    owner: uuid.UUID,
    *,
    row_id: str | None = None,
    secret: str = FINDABLE_SECRET,
    provider: str = "openai_compatible",
    base_url: str | None = "https://openrouter.example/api/v1",
) -> AICredential:
    row = AICredential(
        id=row_id or f"key-{uuid.uuid4().hex[:8]}",
        user_id=owner,
        label="a key",
        provider=provider,
        base_url=base_url,
        key_encrypted=encrypt_token(secret),
        last_validated=int(utc_now().timestamp() * 1000),
    )
    session.add(row)
    session.commit()
    return row


def _due_summary(
    session: Session, owner: uuid.UUID, *, extra: dict[str, Any] | None = None
) -> Summary:
    """A Summary `_is_due` says is ready, over a Channel with one Post in range.

    The Channel is followed and synced past the window, so
    `_sync_channels_for_summary` finds nothing stale and the test never
    reaches the scraper.
    """
    now = int(time.time() * 1000)
    channel = f"prov-{uuid.uuid4().hex[:8]}"
    session.add(
        Post(
            channel_name=channel,
            post_id=1,
            text="a post",
            timestamp=now - 1_800_000,
        )
    )
    follow_synced(session, channel, user_id=owner)
    row = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=owner,
        text="body",
        scope=stored_scope(
            channels=[channel], start=now - 7_200_000, end=now - 3_600_000
        ),
        language="English",
        post_count=0,
        timestamp=now,
        extra={"autoRegenerate": True, **(extra or {})},
    )
    session.add(row)
    session.commit()
    return row


class _ProviderError(Exception):
    """Shaped like the SDKs' errors: a `code` and a `message`."""

    def __init__(self, code: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class _StubProvider:
    def __init__(self, text: str, error: BaseException | None) -> None:
        self.text = text
        self.error = error

    async def stream(self, prompt: str, **_: Any) -> AsyncIterator[str]:
        if self.error is not None:
            raise self.error
        yield self.text


def _stub_provider(
    text: str = "regenerated [x #1]", *, error: BaseException | None = None
) -> _StubProvider:
    return _StubProvider(text, error)


def _drain() -> None:
    """Run every Attempt waiting on the generation Lane, as the worker would."""
    while asyncio.run(summary_generation.run_next_attempt()) is not None:
        pass


def _tick(provider: _StubProvider) -> tuple[dict[str, Any], MagicMock]:
    """One scheduler tick, then the worker running what it started (SFR-03)."""
    with patch.object(
        summary_generation, "get_provider", return_value=provider
    ) as built:
        result = asyncio.run(auto_summary.run_auto_summary())
        _drain()
    return result, built


def _attempts_of(summary_id: str) -> list[SummaryAttempt]:
    with Session(engine) as check:
        return list(
            check.exec(
                select(SummaryAttempt)
                .where(col(SummaryAttempt.summary_id) == summary_id)
                .order_by(col(SummaryAttempt.attempt))
            ).all()
        )


def _llm_rows(owner: uuid.UUID) -> list[LLMLog]:
    with Session(engine) as check:
        return list(
            check.exec(select(LLMLog).where(col(LLMLog.user_id) == owner)).all()
        )


# --------------------------------------------------------------------------
# The unattended path
# --------------------------------------------------------------------------


def test_a_scheduled_run_spends_the_key_the_summary_named(
    session: Session, user: User
) -> None:
    """Nobody is present at 4am to choose one, so the Summary remembers.

    Two Keys, and the one the Summary names is the **older** of them —
    `resolve_ai_key`'s no-id fallback takes the most recently updated validated
    Key, so a run that ignored `aiKeyId` would pass against a single-Key account
    and silently spend the wrong credential for everybody else.
    """
    chosen = _seed_key(session, user.id, base_url="https://chosen.example/v1")
    time.sleep(0.01)
    _seed_key(session, user.id, base_url="https://newer.example/v1")
    summary = _due_summary(session, user.id, extra={"aiKeyId": chosen.id})

    _, built = _tick(_stub_provider())

    assert built.call_args.kwargs["api_key"] == FINDABLE_SECRET
    assert built.call_args.kwargs["base_url"] == "https://chosen.example/v1"

    rows = _llm_rows(user.id)
    assert [r.status for r in rows] == ["success"]
    assert rows[0].provider == "openai_compatible"
    assert rows[0].base_url == "https://chosen.example/v1", (
        "the log names the endpoint that answered, so a Provider that starts "
        "failing is identifiable from the History rather than by guessing"
    )
    assert summary.id  # the fixture row is what came due


def test_the_regenerated_summary_carries_the_key_forward(
    session: Session, user: User
) -> None:
    """The chain is what makes this unattended, not the first run.

    `_regenerate_one` writes a *new* Summary that comes due next, so a choice
    that is not copied across survives exactly one night and then reverts to
    "whichever Key is newest" with nothing to show it changed.
    """
    chosen = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": chosen.id})

    result, _ = _tick(_stub_provider())

    assert len(result["regenerated"]) == 1
    with Session(engine) as check:
        fresh = check.get(Summary, result["regenerated"][0])
    assert fresh is not None
    assert (fresh.extra or {}).get("aiKeyId") == chosen.id
    assert fresh.text == "regenerated [x #1]"


def test_a_foreign_key_id_is_refused_and_files_a_failed_row(
    session: Session, user: User, other_user: User
) -> None:
    """`extra` is filled from unrecognised request keys, so `aiKeyId` is untrusted.

    Ticket 33 found this exact shape already exploited on `publishBotId`:
    resolving a credential by primary key alone let a Summary name another
    Account's row, which the scheduler then decrypted and spent. The refusal is
    `resolve_ai_key`'s, before `decrypt_token`, and it answers as an absent row
    does. What this test adds is that the refusal is **audible**: the successor
    is Failed with the reason on its Attempt, and a failed log row says so too.
    """
    theirs = _seed_key(session, other_user.id, secret="not-yours")
    _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": theirs.id})

    built = MagicMock()
    with patch.object(summary_generation, "get_provider", built):
        result = asyncio.run(auto_summary.run_auto_summary())
    _drain()

    built.assert_not_called()
    [attempt] = _attempts_of(result["regenerated"][0])
    assert (attempt.outcome, attempt.kind, attempt.scheduled) == (
        "failed",
        "auth",
        True,
    )
    rows = _llm_rows(user.id)
    assert [r.status for r in rows] == ["failed"]
    assert AI_CREDENTIAL_NOT_FOUND in (rows[0].error or "")
    assert not _llm_rows(other_user.id), (
        "the refused call was logged against the Account that made it, not "
        "against the Account whose Key it tried to name"
    )


def test_a_rejected_key_files_a_failed_row_and_clears_its_stamp(
    session: Session, user: User
) -> None:
    """A Key the Provider has started rejecting is flagged, not retried blindly.

    Clearing `last_validated` is the signal the settings panel reads, and it is
    driven by a call that was being made anyway — nothing re-validates on a
    schedule, because a job that spends money to check whether you can still
    spend money is the cost BYOK exists to remove.
    """
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    rejection = HTTPException(status_code=401, detail="invalid api key")
    rejection.code = 401  # type: ignore[attr-defined]

    result, _ = _tick(_stub_provider(error=rejection))

    rows = _llm_rows(user.id)
    assert [r.status for r in rows] == ["failed"]
    with Session(engine) as check:
        refreshed = check.get(AICredential, key.id)
        fresh = check.get(Summary, result["regenerated"][0])
    assert refreshed is not None
    assert refreshed.last_validated is None
    assert fresh is not None and (fresh.extra or {}).get("status") == "failed"


def test_a_failed_tick_leaves_a_failed_successor_carrying_the_chain(
    session: Session, user: User
) -> None:
    """SFR-03: an unattended failure is a Failed Summary, and the chain moves on.

    The successor is created before its Attempt runs and takes the chain at
    once, so a failure leaves it Failed with its Attempt (visible in History)
    and still due next window. One bad night does not switch the feature off.
    """
    key = _seed_key(session, user.id)
    summary = _due_summary(session, user.id, extra={"aiKeyId": key.id})

    result, _ = _tick(_stub_provider(error=_ProviderError(400, "bad request")))

    with Session(engine) as check:
        row = check.get(Summary, summary.id)
        fresh = check.get(Summary, result["regenerated"][0])
    assert row is not None and fresh is not None
    assert (row.extra or {}).get("autoRegenerate") is False
    assert (fresh.extra or {}).get("status") == "failed"
    assert (fresh.extra or {}).get("autoRegenerate") is True, (
        "a failed run turned auto-regeneration off; the Account loses every "
        "future run and nothing tells them"
    )
    [attempt] = _attempts_of(fresh.id)
    assert (attempt.outcome, attempt.scheduled) == ("failed", True)


def test_a_quota_failure_switches_the_chain_off(session: Session, user: User) -> None:
    """The one failure that stops the chain: a Key with nothing left to spend."""
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    result, _ = _tick(_stub_provider(error=_ProviderError(429, "quota exceeded")))

    with Session(engine) as check:
        fresh = check.get(Summary, result["regenerated"][0])
    assert fresh is not None
    assert (fresh.extra or {}).get("status") == "failed"
    assert (fresh.extra or {}).get("autoRegenerate") is False


def test_the_next_tick_derives_the_following_window_from_a_failed_successor(
    session: Session, user: User
) -> None:
    """Each missed window stays behind as one Failed Summary; none stalls the chain."""
    key = _seed_key(session, user.id)
    now = int(time.time() * 1000)
    hour = 3_600_000
    channel = f"prov-{uuid.uuid4().hex[:8]}"
    # One Post in each of the next two windows, so both ticks have work.
    for post_id, ts in ((1, now - 5 * hour // 2), (2, now - 3 * hour // 2)):
        session.add(Post(channel_name=channel, post_id=post_id, text="a", timestamp=ts))
    follow_synced(session, channel, user_id=user.id)
    session.add(
        Summary(
            id=f"sum-{uuid.uuid4().hex[:8]}",
            user_id=user.id,
            text="body",
            scope=stored_scope(
                channels=[channel], start=now - 4 * hour, end=now - 3 * hour
            ),
            language="English",
            post_count=0,
            timestamp=now,
            extra={"autoRegenerate": True, "aiKeyId": key.id},
        )
    )
    session.commit()
    failing = _stub_provider(error=_ProviderError(400, "bad request"))

    first, _ = _tick(failing)
    second, _ = _tick(_stub_provider())

    with Session(engine) as check:
        missed = check.get(Summary, first["regenerated"][0])
        following = check.get(Summary, second["regenerated"][0])
    assert missed is not None and following is not None
    assert (missed.extra or {}).get("status") == "failed"
    assert (missed.extra or {}).get("autoRegenerate") is False
    assert following.scope is not None and missed.scope is not None
    assert following.scope["start"] == missed.scope["end"]
    assert following.text == "regenerated [x #1]"


def test_a_failed_tick_does_not_retry_every_minute(
    session: Session, user: User
) -> None:
    """The chain moving on is what paces a broken Key now.

    `_is_due` stayed true forever once a window passed and the tick is 60
    seconds, so a failure that left the chain where it was retried 1,440 times
    a day. The successor took the chain and is not due until its own window
    ends, so a second tick straight after has nothing to run.
    """
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    failing = _stub_provider(error=_ProviderError(400, "provider is having a day"))
    _tick(failing)
    first = len(_llm_rows(user.id))
    _tick(failing)

    assert first == 1
    assert len(_llm_rows(user.id)) == 1, (
        "the second tick retried; a broken Key produces ~1,440 failed rows and "
        "outbound calls a day"
    )


def test_a_tick_that_breaks_before_its_successor_backs_off(
    session: Session, user: User
) -> None:
    """The backoff still paces a tick that fails before any Summary exists."""
    summary = _due_summary(session, user.id)

    with patch.object(
        auto_summary, "derived_scope", side_effect=RuntimeError("no window")
    ):
        result = asyncio.run(auto_summary.run_auto_summary())

    assert result["errors"]
    with Session(engine) as check:
        row = check.get(Summary, summary.id)
    assert row is not None
    assert (row.extra or {}).get("autoRegenerateFailures") == 1
    assert (row.extra or {}).get("autoRegenerate") is True


def test_the_wait_doubles_and_is_capped() -> None:
    """A ladder, not a constant, and it stops climbing.

    The cap is what keeps "keeps retrying" true: an unbounded doubling reaches
    a wait longer than the deployment's life, which is an auto-disable arrived
    at by arithmetic rather than by decision.
    """
    assert auto_summary._retry_after(1) == 60_000
    assert auto_summary._retry_after(2) == 120_000
    assert auto_summary._retry_after(3) == 240_000
    assert auto_summary._retry_after(99) == auto_summary._RETRY_BACKOFF_CAP_MS


def test_a_successful_run_clears_the_backoff(session: Session, user: User) -> None:
    """The successor starts on attempt zero.

    A run that produced a Summary is the proof the Key works. Inheriting the
    ladder through `extra`'s spread would make last night's outage delay a
    Summary that has just succeeded — and the spread is exactly how `aiKeyId`
    travels, so this is the same mechanism carrying something it must not.
    """
    key = _seed_key(session, user.id)
    _due_summary(
        session,
        user.id,
        extra={
            "aiKeyId": key.id,
            "autoRegenerateFailures": 4,
            "autoRegenerateRetryAfter": 1,  # long past, so it is due now
        },
    )

    result, _ = _tick(_stub_provider())

    assert len(result["regenerated"]) == 1
    with Session(engine) as check:
        fresh = check.get(Summary, result["regenerated"][0])
    assert fresh is not None
    extra = fresh.extra or {}
    assert "autoRegenerateFailures" not in extra
    assert "autoRegenerateRetryAfter" not in extra
    assert extra.get("aiKeyId") == key.id, (
        "clearing the ladder must not also drop the Key the chain runs on"
    )


def test_a_resolution_failure_that_is_not_an_http_error_still_files_a_row(
    session: Session, user: User
) -> None:
    """ "Every failure files a row" has to mean every failure.

    `resolve_ai_key` answers a missing or foreign Key with an `HTTPException`,
    which is the case anybody catches. It also reaches `decrypt_token`, which
    raises a bare `ValueError` outside `local` for a row that is not encrypted
    — a `SECRET_KEY` rotation, or a restore carrying plaintext. Catching only
    the tidy one puts that back in the silent column.
    """
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    with patch.object(
        summary_generation,
        "resolve_ai_key",
        side_effect=ValueError("Stored key is not encrypted; re-save it"),
    ):
        result = asyncio.run(auto_summary.run_auto_summary())

    rows = _llm_rows(user.id)
    assert [r.status for r in rows] == ["failed"], (
        "a non-HTTP resolution failure produced no log row at all"
    )
    assert "not encrypted" in (rows[0].error or "")
    [attempt] = _attempts_of(result["regenerated"][0])
    assert "not encrypted" in (attempt.error or "")


def test_a_scheduled_success_is_auto_published(session: Session, user: User) -> None:
    """Published when the worker finishes it, not when the tick starts it."""
    key = _seed_key(session, user.id)
    _due_summary(
        session,
        user.id,
        extra={
            "aiKeyId": key.id,
            "autoPublish": True,
            "publishBotId": "bot",
            "publishChatId": "chat",
        },
    )

    with patch.object(auto_summary, "_auto_publish", new=AsyncMock()) as published:
        result, _ = _tick(_stub_provider())

    published.assert_awaited_once()
    assert published.await_args is not None
    assert published.await_args.args[1].id == result["regenerated"][0]


def test_auto_publish_skips_a_cut_short_summary_and_says_so(
    session: Session, user: User
) -> None:
    """A kept Partial response stops short; nobody unattended sends one (SFR-03)."""
    row = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=user.id,
        text="half a report",
        language="English",
        timestamp=int(time.time() * 1000),
        extra={
            "cutShort": True,
            "autoPublish": True,
            "publishBotId": "bot",
            "publishChatId": "chat",
        },
    )
    session.add(row)
    session.commit()

    with patch.object(auto_summary, "send_publication", new=AsyncMock()) as sent:
        asyncio.run(auto_summary._auto_publish(session, row, owner_id=user.id))

    sent.assert_not_awaited()
    with Session(engine) as check:
        [log] = check.exec(
            select(PublishLog).where(col(PublishLog.summary_id) == row.id)
        ).all()
    assert log.status == "skipped"
    assert "Cut short" in (log.error or "")


# --------------------------------------------------------------------------
# The record
# --------------------------------------------------------------------------


def test_the_key_never_reaches_the_logged_request_body(
    session: Session, user: User
) -> None:
    """Reading your own logs must not hand back your own credential.

    Asserted over the **whole row** rather than over `full_request` alone,
    because an export streams every column and the question the Account cares
    about is whether the secret is anywhere in what comes back.
    """
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    _tick(_stub_provider())

    rows = _llm_rows(user.id)
    assert rows
    for row in rows:
        assert FINDABLE_SECRET not in str(row.model_dump()), (
            f"the credential reached {row.id}; a log row is readable by its "
            "owner and travels in every export"
        )


def test_the_provenance_columns_reach_a_list_page(session: Session, user: User) -> None:
    """Columns, not another key in a blob the list never selects.

    "Which Provider is failing me" and "who spent my Key" are questions you ask
    *of a list*. `LOG_HEAVY_COLUMNS["llm"]` drops the bodies from every list
    page — the split that took `/data/logs/sync` from 56 MB to 0.11 MB — so a
    field hidden in `full_request` would be answerable only by opening rows one
    at a time.
    """
    assert "provider" not in LOG_HEAVY_COLUMNS["llm"]
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    _tick(_stub_provider())

    with Session(engine) as check:
        listed = list_logs(check, "llm", user_id=user.id)
    assert listed
    assert listed[0]["provider"] == "openai_compatible"
    assert listed[0]["baseUrl"] == "https://openrouter.example/api/v1"
    assert "actedByEmail" in listed[0]
    assert "actedByUserId" not in listed[0], (
        "the foreign-key half of the attribution is not wire data; "
        "`ArtifactBase` made the same choice for the four Artifact families"
    )


def test_an_unattended_run_attributes_nobody(session: Session, user: User) -> None:
    """The scheduler opens its own `Session` and binds no acting Owner.

    Not a special case anybody wrote — it is what "nobody elevated anything"
    looks like, and asserting it here is what keeps the stamp meaningful when
    `test_view_as_elevation.py` asserts the other side.
    """
    key = _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": key.id})

    _tick(_stub_provider())

    rows = _llm_rows(user.id)
    assert rows
    assert rows[0].acted_by_user_id is None
    assert rows[0].acted_by_email is None


# --------------------------------------------------------------------------
# The structural half
# --------------------------------------------------------------------------


def _ai_call_sites() -> dict[str, ast.Module]:
    """Modules that both build a Provider **and** write an LLM log.

    Derived rather than listed, and the conjunction is the definition rather
    than a filter: a module holding both is one where the outgoing request
    object is in scope at the moment the log is composed, which is the only
    place the mistake below can be made. `services/logs.py` and
    `services/data_import_export.py` write the same table from a body that
    arrived over HTTP — the browser composed it and no credential was ever in
    that process — so they are outside this by the rule, not by an exemption.
    """
    sites: dict[str, ast.Module] = {}
    for path in APP_ROOT.rglob("*.py"):
        if "alembic" in path.parts:
            continue
        source = path.read_text(encoding="utf-8")
        if "upsert_llm_log" in source and "get_provider" in source:
            sites[str(path.relative_to(APP_ROOT))] = ast.parse(source)
    return sites


def test_a_logged_request_body_is_composed_and_never_dumped() -> None:
    """The guard the ticket asks for, and the failure it names.

    The obvious implementation of "record what we sent" hands the outgoing HTTP
    request to the log, and **one supported Provider carries its credential as a
    URL query parameter** — so that implementation writes the Account's key into
    a row the Account can read back and export. Nothing about it looks wrong in
    review.

    So every `full_request` written by a module that has a Provider in scope has
    to be *built* there: a dict literal, or a name bound to one. A bare
    attribute (`response.request`, `client.last_request`, `provider.
    last_request`) is the shape this refuses.

    Scanned over the whole module rather than over the call's arguments, which
    is the first version of this guard and a false pass: `_run_summary_call`
    composes its row into a local and passes `{**log, ...}`, so an argument-only
    walk never saw the key at all and the mutation went green.
    """
    sites = _ai_call_sites()
    assert sites, "no AI call sites found; this guard has stopped covering anything"

    offenders: list[str] = []
    seen = 0
    for module, tree in sites.items():
        for node in ast.walk(tree):
            if not isinstance(node, ast.Dict):
                continue
            for key, value in zip(node.keys, node.values, strict=True):
                if not (isinstance(key, ast.Constant) and key.value == "full_request"):
                    continue
                seen += 1
                if not isinstance(value, ast.Dict | ast.Name):
                    offenders.append(f"{module}: {ast.dump(value)[:60]}")

    assert seen, (
        f"no `full_request` key was found in {sorted(sites)}; either the field "
        "was renamed or these modules stopped recording one, and this guard is "
        "now asserting nothing"
    )
    assert not offenders, (
        "a logged request body was taken from something rather than composed: "
        f"{offenders}. Build the dict from the prompt at the call site — a "
        "Gemini credential travels as a URL query parameter, so a dumped "
        "request object writes the key into the row."
    )


def test_the_provider_classes_expose_no_request_to_log() -> None:
    """Nothing to dump means the mistake above cannot be made by accident.

    The companion to the guard above, pointed at the other end: a Provider that
    kept its last outgoing request around would make "log what we sent" a one
    liner, and the AST guard only sees the call sites that exist today.
    """
    exposed: list[str] = []
    for path in (APP_ROOT / "ai" / "providers").glob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in (
                "last_request",
                "full_request",
            ):
                exposed.append(f"{path.name}: {node.attr}")
    assert not exposed, (
        f"a Provider is keeping its outgoing request: {exposed}. It carries the "
        "credential, and the only reason to keep it is to log it."
    )
