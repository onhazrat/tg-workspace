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
* restoring the `"quota" in err.lower()` branch in `run_auto_summary` —
  `test_a_failed_run_does_not_disable_the_schedule` goes red;
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
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
import time
import uuid
from collections.abc import Iterator
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.core.secrets import encrypt_token
from app.jobs import auto_summary
from app.models import User
from app.models_tg import AICredential, LLMLog, Post, Summary, utc_now
from app.services.ai_keys import AI_CREDENTIAL_NOT_FOUND
from app.services.logs import LOG_HEAVY_COLUMNS, list_logs
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

    The Channel is deliberately **not followed**, so `_sync_channels_for_summary`
    finds nothing stale and the test never reaches the scraper. The Post is
    seeded directly because the corpus table is not follow-scoped on the read
    `_regenerate_one` makes.
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
    row = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=owner,
        text="body",
        channels=[channel],
        start_date=now - 7_200_000,
        end_date=now - 3_600_000,
        language="English",
        post_count=0,
        timestamp=now,
        extra={"autoRegenerate": True, **(extra or {})},
    )
    session.add(row)
    session.commit()
    return row


def _stub_provider(text: str = "regenerated [x #1]") -> MagicMock:
    provider = AsyncMock()
    provider.complete.return_value = MagicMock(
        text=text, model_dump=lambda: {"text": text}
    )
    return provider


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

    provider = _stub_provider()
    with patch.object(auto_summary, "get_provider", return_value=provider) as built:
        asyncio.run(auto_summary.run_auto_summary())

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

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        result = asyncio.run(auto_summary.run_auto_summary())

    assert len(result["regenerated"]) == 1
    with Session(engine) as check:
        fresh = check.get(Summary, result["regenerated"][0])
    assert fresh is not None
    assert (fresh.extra or {}).get("aiKeyId") == chosen.id


def test_a_foreign_key_id_is_refused_and_files_a_failed_row(
    session: Session, user: User, other_user: User
) -> None:
    """`extra` is filled from unrecognised request keys, so `aiKeyId` is untrusted.

    Ticket 33 found this exact shape already exploited on `publishBotId`:
    resolving a credential by primary key alone let a Summary name another
    Account's row, which the scheduler then decrypted and spent. The refusal is
    `resolve_ai_key`'s, before `decrypt_token`, and it answers as an absent row
    does. What this test adds is that the refusal is **audible**: a silent
    return would make "somebody else's Key" and "auto-regeneration is off" the
    same observation from the History.
    """
    theirs = _seed_key(session, other_user.id, secret="not-yours")
    _seed_key(session, user.id)
    _due_summary(session, user.id, extra={"aiKeyId": theirs.id})

    built = MagicMock()
    with patch.object(auto_summary, "get_provider", built):
        result = asyncio.run(auto_summary.run_auto_summary())

    built.assert_not_called()
    assert result["regenerated"] == []

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
    provider = AsyncMock()
    provider.complete.side_effect = rejection

    with patch.object(auto_summary, "get_provider", return_value=provider):
        result = asyncio.run(auto_summary.run_auto_summary())

    assert result["regenerated"] == []
    rows = _llm_rows(user.id)
    assert [r.status for r in rows] == ["failed"]

    with Session(engine) as check:
        refreshed = check.get(AICredential, key.id)
    assert refreshed is not None
    assert refreshed.last_validated is None


def test_a_failed_run_does_not_disable_the_schedule(
    session: Session, user: User
) -> None:
    """One bad night does not switch the feature off.

    The removed branch matched `quota`, `429` and `rate limit` in the error
    text, which is every Provider's busiest-hour message. It was defensible
    while one Operator key paid for everything; under BYOK the Account is billed
    by its own Provider, so switching their schedule off protects nobody and
    costs them the run silently.
    """
    key = _seed_key(session, user.id)
    summary = _due_summary(session, user.id, extra={"aiKeyId": key.id})

    provider = AsyncMock()
    provider.complete.side_effect = RuntimeError("429 quota exceeded, rate limit")

    with patch.object(auto_summary, "get_provider", return_value=provider):
        result = asyncio.run(auto_summary.run_auto_summary())

    assert result["errors"], "the failure was swallowed rather than reported"
    with Session(engine) as check:
        row = check.get(Summary, summary.id)
    assert row is not None
    assert (row.extra or {}).get("autoRegenerate") is True, (
        "a failed run turned auto-regeneration off; the Account loses every "
        "future run and nothing tells them"
    )


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

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        asyncio.run(auto_summary.run_auto_summary())

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

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        asyncio.run(auto_summary.run_auto_summary())

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

    with patch.object(auto_summary, "get_provider", return_value=_stub_provider()):
        asyncio.run(auto_summary.run_auto_summary())

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
