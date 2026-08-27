"""Ticket 33: the scheduler stops sending as another account's bot.

`_auto_publish` resolved both ids by primary key with no ownership check, and
`publish_summary_text` did the same for the credential before decrypting its
token. `upsert_summary` passes unknown body keys straight into `Summary.extra`
and credential ids are client-chosen strings from the URL path, so a Summary
could name another account's `publishBotId` and the scheduler would decrypt that
account's token and send as its bot, to a destination that account chose.

Four things here are not the wiring.

**The credential check is tested through `publish_summary_text`, not only
through `_auto_publish`.** That is checkbox 2 and it is the whole shape of the
fix: guarding the caller leaves the next caller unguarded, which is how ticket
31 found nine by-id writes still on the gated primitive after the import door
was closed. `publish_summary_text` is what decrypts the token, so it is the
function that must be sure — and `test_a_foreign_credential_is_never_decrypted`
spies on `decrypt_token` rather than on the send, because a refusal that happens
after the plaintext token exists has already produced the thing the encryption
is for.

**Both flag states, because this is identity and not visibility.** Ticket 31's
rule: a by-id read may defer to `TENANCY_ENFORCED`, a by-id write may not. A
send and a token decryption are writes by that measure. Gate this and the
scheduler goes on publishing as somebody else's bot until ticket 21 flips the
flag, which is the half-fix shape ticket 30 named — so every battery below is
parametrised, and gating the check fails only the flag-off half.

**A NULL owner on either side is permitted while the flag is off and refused
under enforcement**, which is `assert_owner_on_write`'s existing asymmetry
reached from a third direction. `user_id` is nullable on `tg_bot_credentials`,
`tg_chat_destinations` *and* `tg_summaries`, so the credential a single-operator
deployment has been publishing with since before the stamp existed still works
today and stops the moment enforcement arrives. That is **ticket 21's bill**,
pinned here rather than left for an operator to discover as a publish that
silently stopped. It is also where this path parts from ticket 32: that ticket
refused to match NULL as "mine" for the *list*, because handing every account
the deployment's own credential is a leak. Refusing to *use* one is not a leak,
so the asymmetry is deliberate on both sides.

**The refusal is visible in the publish log.** The scheduler is unattended;
nobody is watching a 403 that never renders. An absent destination used to
`return` after a `logger.warning` and write nothing at all, so "auto-publish is
configured and produces no message" was indistinguishable from "auto-publish is
off". Absent and foreign now both write a failed log, with the same text — the
`assert_owner` rule that the body is the other half of the answer.

## What this file cannot demonstrate today

`run_auto_summary` selects `Summary.user_id == operator OR IS NULL`, so a second
account's Summary is not regenerated at all on the shipping config and the
end-to-end exploit is **latent** rather than live. That is still the right time
to close it: the filter goes away with the operator model, and the credential
ids it protects are guessable strings. These tests therefore drive
`_auto_publish` and `publish_summary_text` directly, which is the level the fix
lives at anyway.

## Mutation-tested

* drop the check from `publish_summary_text` → the decrypt and the two
  credential batteries fail, both flag states
* gate it behind `tenancy_enforced()` → only the flag-off halves fail
* drop the destination check from `_auto_publish` → that battery fails
* give the refusal a message of its own → the indistinguishability guard fails
* let the destination branch `return` without a log → the visibility guard fails
* give `acting_user_id` a default of `None` → the signature guard fails
* refuse a NULL owner unconditionally in `may_act_on` → the ownerless batteries
  fail flag-off, which is where the operator's own credential lives today
* revert `_resolve_bot_token` to 403 with its own string → the twin guard fails
* revert it to the hand-rolled NULL rule → the twin guard fails, flag-on
* put the destination row id back in the searchable `chat_id` column → the
  visibility guard fails
* have a by-id read call `may_act_on` → the declared-caller guard fails
* make `may_act_on`'s arguments positional → the keyword guard fails

**One mutation was watched passing, and it changed the work.** Attributing the
send to `dest.user_id` instead of `summary.user_id` passed all nineteen tests,
because every one of them gave the Summary and the destination the same owner —
so the wrong id and the right id were the same id. The wiring guard now runs
against an *ownerless* destination, the one row shape where the two answers
differ, and that shape pins the destination side of the NULL rule as well.
"""

from __future__ import annotations

import ast
import asyncio
import inspect
import pathlib
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.jobs import auto_summary
from app.models import User
from app.models_tg import BotCredential, ChatDestination, PublishLog, Summary
from app.services import publish as publish_service
from app.services import tenancy
from app.services.publish import publish_summary_text
from tests.utils.user import create_random_user

BOTH_FLAG_STATES = pytest.mark.parametrize("enforced", [False, True])

#: Who may take the ungated predicate, and why it is not a read.
#:
#: `may_act_on` is the most inviting of the seam's three primitives — it returns
#: a bool and needs no `detail` string — and it answers **without** consulting
#: the flag on the non-NULL branch. A by-id *read* adopting it would therefore
#: narrow a response while enforcement is off, which is the one thing the seam
#: forbids and the reason `test_only_reads_use_the_gated_ownership_guard`
#: exists. Same rule, applied to the primitive this ticket added.
MAY_ACT_ON_CALLERS: dict[str, str] = {
    "publish.publish_summary_text": (
        "Decrypts a bot token and sends as that bot. A write by ticket 31's "
        "measure, and it runs in the scheduler with no response to put a 404 "
        "in — so it raises `ValueError`, not `HTTPException`."
    ),
    "auto_summary._auto_publish": (
        "Resolves the chat destination a send goes to, in the same scheduler "
        "with the same absence of a response. Writes a failed publish log "
        "instead of raising."
    ),
    "telegram._resolve_bot_token": (
        "The interactive twin of the same decision, ported onto the shared "
        "rule by ticket 33. It has a response and does raise a 404; it is here "
        "because it needs the predicate's NULL handling to answer as the "
        "scheduler does, and a hand-rolled copy is what it had before."
    ),
}


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


def _set_flag(monkeypatch: pytest.MonkeyPatch, enforced: bool) -> None:
    """Force the seam, rather than assuming which way it points.

    The flag-off tests assert what the seam does *not* do, so a run with
    `TENANCY_ENFORCED=True` in the environment would fail them for the right
    reason in the wrong run.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", enforced)


# --------------------------------------------------------------------------
# Seeding, and the two entry points as plain calls
# --------------------------------------------------------------------------


def _seed_bot(session: Session, row_id: str, owner: uuid.UUID | None) -> str:
    session.add(
        BotCredential(
            id=row_id, user_id=owner, name=row_id, token_encrypted="enc:secret"
        )
    )
    session.commit()
    return row_id


def _seed_dest(session: Session, row_id: str, owner: uuid.UUID | None) -> str:
    session.add(
        ChatDestination(id=row_id, user_id=owner, name=row_id, chat_id=f"chat-{row_id}")
    )
    session.commit()
    return row_id


def _seed_summary(
    session: Session, owner: uuid.UUID | None, extra: dict[str, Any]
) -> Summary:
    row = Summary(
        id=f"summary-{uuid.uuid4()}",
        user_id=owner,
        text="body",
        channels=["chan"],
        start_date=1_767_225_600_000,
        end_date=1_767_312_000_000,
        language="en",
        model="test-model",
        post_count=1,
        timestamp=0,
        extra=extra,
    )
    session.add(row)
    session.commit()
    return row


def _publish(session: Session, **kwargs: Any) -> dict[str, Any]:
    """The repo tests async code with `asyncio.run`; there is no plugin."""
    return asyncio.run(publish_summary_text(session, **kwargs))


def _auto_publish(session: Session, summary: Summary, extra: dict[str, Any]) -> None:
    asyncio.run(auto_summary._auto_publish(session, summary, extra, "body"))


def _extra(bot_id: str, chat_id: str) -> dict[str, Any]:
    return {
        "autoPublish": True,
        "publishBotId": bot_id,
        "publishChatId": chat_id,
        "sendMetadata": False,
    }


def _publish_logs(session: Session, summary_id: str) -> list[PublishLog]:
    return list(
        session.exec(select(PublishLog).where(col(PublishLog.summary_id) == summary_id))
    )


class _Spy:
    """Records whether the thing that must not happen happened."""

    def __init__(self, result: Any = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self.result = result

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append({"args": args, "kwargs": kwargs})
        return self.result

    async def acall(self, *args: Any, **kwargs: Any) -> Any:
        self.calls.append({"args": args, "kwargs": kwargs})
        return self.result


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> _Spy:
    """Nothing in this file may reach api.telegram.org."""
    spy = _Spy(result=({"ok": True}, {"telemetry": True}))
    monkeypatch.setattr(publish_service, "fetch_with_retry", spy.acall)
    return spy


@pytest.fixture
def decrypt(monkeypatch: pytest.MonkeyPatch) -> _Spy:
    spy = _Spy(result="123:plaintext-bot-token")
    monkeypatch.setattr(publish_service, "decrypt_token", spy)
    return spy


@pytest.fixture
def no_send(monkeypatch: pytest.MonkeyPatch) -> _Spy:
    """Stand in for the service, so `_auto_publish`'s own checks are what run."""
    spy = _Spy(result={"success": True, "results": [], "telemetry": []})
    monkeypatch.setattr(auto_summary, "publish_summary_text", spy.acall)
    return spy


# --------------------------------------------------------------------------
# The credential, checked where the token is decrypted
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_a_foreign_credential_is_never_decrypted(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """The refusal lands before the plaintext token exists.

    Asserting only that nothing was sent would pass a fix that decrypts first
    and refuses second, which has already produced the thing the encryption is
    for.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-other", other_user.id)

    with pytest.raises(ValueError):
        _publish(
            session,
            acting_user_id=user.id,
            credential_id="bot-of-other",
            chat_id="chat-1",
            text="hello",
        )

    assert decrypt.calls == []
    assert no_network.calls == []


@BOTH_FLAG_STATES
def test_the_refusal_matches_the_absent_credential_message(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """ "Somebody else owns it" and "there is nothing here" answer alike.

    `assert_owner`'s argument, applied to a `ValueError` instead of a 404: the
    status line is only half the answer and this path has no status line at
    all, so the message is the whole of it. Credential ids are client-chosen
    strings, which makes a distinguishable refusal a working oracle for
    guessing them.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-other", other_user.id)

    with pytest.raises(ValueError) as foreign:
        _publish(
            session,
            acting_user_id=user.id,
            credential_id="bot-of-other",
            chat_id="chat-1",
            text="hello",
        )
    with pytest.raises(ValueError) as absent:
        _publish(
            session,
            acting_user_id=user.id,
            credential_id="bot-that-does-not-exist",
            chat_id="chat-1",
            text="hello",
        )

    assert str(foreign.value) == str(absent.value)


@BOTH_FLAG_STATES
def test_your_own_credential_still_publishes(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """The half that would make a fail-closed bug look like a fix."""
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)

    result = _publish(
        session,
        acting_user_id=user.id,
        credential_id="bot-of-mine",
        chat_id="chat-1",
        text="hello",
    )

    assert result["success"] is True
    assert len(decrypt.calls) == 1
    assert len(no_network.calls) == 1


@BOTH_FLAG_STATES
def test_an_ownerless_credential_is_ticket_21s_bill(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """Usable now, refused under enforcement — pinned in both directions.

    `user_id` is nullable on `tg_bot_credentials`, so the credential a
    single-operator deployment has been publishing with since before the stamp
    existed carries no owner. Refusing it today would fail closed against the
    only account that install has, which is the trap `assert_owner`'s docstring
    names. Under enforcement it becomes nobody's and auto-publish stops until
    ticket 21's owner backfill runs — that is a prerequisite of the flag flip,
    not a surprise for whoever throws the switch.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-ownerless", None)

    if enforced:
        with pytest.raises(ValueError):
            _publish(
                session,
                acting_user_id=user.id,
                credential_id="bot-ownerless",
                chat_id="chat-1",
                text="hello",
            )
        assert decrypt.calls == []
    else:
        result = _publish(
            session,
            acting_user_id=user.id,
            credential_id="bot-ownerless",
            chat_id="chat-1",
            text="hello",
        )
        assert result["success"] is True


@BOTH_FLAG_STATES
def test_an_ownerless_summary_may_still_publish_while_the_flag_is_off(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """The actor can be NULL too, and it is the same rule from the other side.

    `run_auto_summary` deliberately picks up `Summary.user_id IS NULL` rows, so
    an unstamped legacy Summary is a live case rather than a hypothetical. With
    no actor there is nothing to compare the credential's owner against; the
    seam permits it while the flag is off for the reason it permits an unstamped
    row, and refuses it under enforcement where every row is stamped.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)

    if enforced:
        with pytest.raises(ValueError):
            _publish(
                session,
                acting_user_id=None,
                credential_id="bot-of-mine",
                chat_id="chat-1",
                text="hello",
            )
    else:
        result = _publish(
            session,
            acting_user_id=None,
            credential_id="bot-of-mine",
            chat_id="chat-1",
            text="hello",
        )
        assert result["success"] is True


@BOTH_FLAG_STATES
def test_the_interactive_door_answers_as_the_scheduler_does(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    enforced: bool,
) -> None:
    """`_resolve_bot_token` is the twin, and it was the divergent one.

    The ticket cites it as the reference implementation, but it hand-rolled the
    rule: 403 `"Bot credential not accessible"` for a foreign row against 404
    `"Bot credential not found"` for an absent one, over ids a client chooses
    and can therefore guess — an enumeration oracle any signed-in account could
    walk. And it refused only a *stamped* foreign row, so under enforcement this
    door would publish with an unstamped credential the scheduler refuses.
    Consolidating the rule and leaving the twin spelling it differently is the
    half-fix this repo names; both now answer alike in both flag states.
    """
    from fastapi import HTTPException

    from app.api.routes.telegram import _resolve_bot_token

    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-other", other_user.id)

    with pytest.raises(HTTPException) as foreign:
        _resolve_bot_token(session, "bot-of-other", None, current_user=user)
    with pytest.raises(HTTPException) as absent:
        _resolve_bot_token(session, "bot-nowhere", None, current_user=user)

    assert foreign.value.status_code == 404
    assert absent.value.status_code == 404
    assert foreign.value.detail == absent.value.detail


def test_may_act_on_has_a_declared_caller_list() -> None:
    """The new primitive stays inside the rule that motivated it.

    Mutation-tested: adding a call from a list read passes every other guard in
    the repo, and fails this one.
    """
    found: dict[str, str] = {}
    root = pathlib.Path(tenancy.__file__).parents[1]

    for path in sorted(root.rglob("*.py")):
        # `tenancy.py` declares it and `assert_owner_on_write` is built on it.
        # That composition is the design, not a call site.
        if "alembic" in path.parts or path.name == "tenancy.py":
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            for inner in ast.walk(node):
                if (
                    isinstance(inner, ast.Call)
                    and isinstance(inner.func, ast.Name)
                    and inner.func.id == "may_act_on"
                ):
                    found[f"{path.stem}.{node.name}"] = str(path)

    unexpected = set(found) - set(MAY_ACT_ON_CALLERS)
    assert not unexpected, (
        f"{sorted(unexpected)} call `may_act_on`, which does not consult the "
        f"tenancy flag on the non-NULL branch. If it is a by-id write or a "
        f"send, add it to MAY_ACT_ON_CALLERS with a reason. If it is a read, "
        f"it must go through `scoped_select` or `assert_owner` instead — "
        f"narrowing a read while enforcement is off changes a response on the "
        f"shipping config, which no seam adoption is allowed to do."
    )
    missing = set(MAY_ACT_ON_CALLERS) - set(found)
    assert not missing, (
        f"{sorted(missing)} are declared as callers but no longer call "
        f"`may_act_on`. Drop the entry rather than leaving a stale exemption."
    )


def test_may_act_on_takes_its_two_arguments_by_keyword() -> None:
    """Same type, symmetric function — the names are the only thing that differ.

    A transposed positional call would compile, pass every behavioural test in
    this file, and answer "is the actor owned by the row" instead.
    """
    parameters = inspect.signature(tenancy.may_act_on).parameters

    assert [p.kind for p in parameters.values()] == [
        inspect.Parameter.KEYWORD_ONLY,
        inspect.Parameter.KEYWORD_ONLY,
    ]


def test_the_acting_owner_is_a_required_keyword() -> None:
    """No default, for the reason ticket 32 gives.

    An optional `acting_user_id` leaves every existing call site passing nothing
    and still passing tests, which is a check that exists and is never applied.
    A caller has to say whose send this is.
    """
    parameter = inspect.signature(publish_summary_text).parameters["acting_user_id"]

    assert parameter.default is inspect.Parameter.empty
    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY


# --------------------------------------------------------------------------
# The destination, and the log that says what happened
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_a_foreign_destination_publishes_nothing(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_send: _Spy,
    enforced: bool,
) -> None:
    """The other half of the pair, and it is reached before the credential is."""
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)
    _seed_dest(session, "dest-of-other", other_user.id)
    extra = _extra("bot-of-mine", "dest-of-other")
    summary = _seed_summary(session, user.id, extra)

    _auto_publish(session, summary, extra)

    assert no_send.calls == []


@BOTH_FLAG_STATES
def test_a_refused_destination_says_why_in_the_publish_log(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_send: _Spy,
    enforced: bool,
) -> None:
    """Nobody is watching the scheduler, so a silent `return` is the wrong answer.

    And the foreign row answers exactly as the absent one does, which is the
    same indistinguishability the credential message keeps.

    **Both runs name the same destination id**, once when no such row exists and
    once when it exists and belongs to somebody else. Comparing two *different*
    ids would prove nothing here, because the message carries the id the caller
    asked about — which is safe, since they already know it — and the invariant
    that matters is that the answer never varies with who owns the row.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)

    extra = _extra("bot-of-mine", "dest-contested")
    absent_summary = _seed_summary(session, user.id, extra)
    foreign_summary = _seed_summary(session, user.id, extra)

    _auto_publish(session, absent_summary, extra)
    _seed_dest(session, "dest-contested", other_user.id)
    _auto_publish(session, foreign_summary, extra)

    absent_logs = _publish_logs(session, absent_summary.id)
    foreign_logs = _publish_logs(session, foreign_summary.id)

    assert len(foreign_logs) == 1
    assert foreign_logs[0].status == "failed"
    assert foreign_logs[0].error
    assert foreign_logs[0].user_id == user.id
    assert len(absent_logs) == 1
    assert absent_logs[0].error == foreign_logs[0].error

    # The Telegram chat id column stays empty rather than carrying the row id:
    # it is searchable, and every other write in `_auto_publish` fills it with
    # a real chat id.
    assert foreign_logs[0].chat_id == ""
    assert foreign_logs[0].chat_name == ""


@BOTH_FLAG_STATES
def test_a_foreign_credential_says_why_in_the_publish_log(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_network: _Spy,
    decrypt: _Spy,
    enforced: bool,
) -> None:
    """Checkbox 3, end to end through the job rather than through the service."""
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-other", other_user.id)
    _seed_dest(session, "dest-of-mine", user.id)
    extra = _extra("bot-of-other", "dest-of-mine")
    summary = _seed_summary(session, user.id, extra)

    _auto_publish(session, summary, extra)

    logs = _publish_logs(session, summary.id)
    assert len(logs) == 1
    assert logs[0].status == "failed"
    assert logs[0].error and "credential" in logs[0].error.lower()
    assert decrypt.calls == []
    assert no_network.calls == []


@BOTH_FLAG_STATES
def test_the_summarys_owner_is_who_the_send_is_attributed_to(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_send: _Spy,
    enforced: bool,
) -> None:
    """The wiring, pinned — on the one row shape that can tell the two apart.

    `_auto_publish` has no `current_user`, so the acting owner must be the
    Summary's. Every other test here gives the Summary and the destination the
    same owner, which means passing `dest.user_id` by mistake reaches the
    identical answer: this guard was **watched passing that mutation** before it
    was written this way. An *ownerless* destination separates them — the
    Summary's owner is an id and the destination's is `None`, and only the
    first is who the send is on behalf of.

    The same row shape pins the destination side of the NULL rule, which is the
    other half of ticket 21's bill: a legacy destination carrying no stamp is
    usable now and refused once enforcement arrives.
    """
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)
    _seed_dest(session, "dest-ownerless", None)
    extra = _extra("bot-of-mine", "dest-ownerless")
    summary = _seed_summary(session, user.id, extra)

    _auto_publish(session, summary, extra)

    logs = _publish_logs(session, summary.id)
    assert len(logs) == 1

    if enforced:
        assert no_send.calls == []
        assert logs[0].status == "failed"
        return

    assert len(no_send.calls) == 1
    assert no_send.calls[0]["kwargs"]["acting_user_id"] == user.id
    assert logs[0].status == "success"


@BOTH_FLAG_STATES
def test_your_own_destination_still_publishes(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    no_send: _Spy,
    enforced: bool,
) -> None:
    """The half that would make a fail-closed bug look like a fix."""
    _set_flag(monkeypatch, enforced)
    _seed_bot(session, "bot-of-mine", user.id)
    _seed_dest(session, "dest-of-mine", user.id)
    extra = _extra("bot-of-mine", "dest-of-mine")
    summary = _seed_summary(session, user.id, extra)

    _auto_publish(session, summary, extra)

    assert len(no_send.calls) == 1

    logs = _publish_logs(session, summary.id)
    assert len(logs) == 1
    assert logs[0].status == "success"
