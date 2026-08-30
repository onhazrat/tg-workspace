"""Ticket 31: an import writes the caller's rows and nobody else's.

`POST /data/import` reaches Summary, BotCredential, ChatDestination and the log
tables by a different door from the endpoints ticket 17 scoped, and that door
had no owner check at all: `session.get(Model, id)` followed by an overwrite.
So `{"summaries": [{"id": "<their id>", "text": "..."}]}` rewrote another
account's summary, and `{"bot_credentials": [...]}` rewrote another account's
**token** and took the row with it — `upsert_publish_log` and friends assign
`user_id` on the existing branch too, so the clobber was a takeover.

## The decision this ticket had to make

The ticket offered two designs and asked for one, written down.

**Import is per-account.** A row that already belongs to somebody else is
refused with that family's own 404, exactly as its endpoint answers. A
cross-account restore is ticket 28's, not a capability being taken away here.

The reason is not "scoping is good" — it is that **import cannot express another
account's ownership in the first place**. Every importer stamps a new row with
the *caller's* id; the export document carries no owner at all. So a restore
into an empty database already files every account's rows under whoever ran it,
and refusing to overwrite a foreign existing row removes nothing that worked.
`test_import_stamps_new_rows_with_the_caller_not_the_document` is that premise
as a guard rather than as a paragraph: when ticket 28 teaches export and import
to carry a subject, it fails, and whoever is holding it has to come back and
re-take this decision instead of inheriting it.

The route's `Permission.DATA_ADMIN` gate (ticket 18) is not that answer. It says
who may call import; it says nothing about whose rows the call lands on, and an
Admin restoring their own backup onto an id that has since been reused has no
idea it landed on somebody else's row. Capability is not intent.

## One rule, everywhere: a read may be gated, a write may not

Ticket 31's first cut closed the import door and left nine other by-id writes on
the flag-gated `assert_owner` — including `PUT /data/summaries/{id}`,
`POST /data/logs/{type}` and `PUT /data/bot-credentials/{id}`, all of them plain
`CurrentUser` with no permission gate, all of them still rewriting another
account's row on the shipping config. Shipping a primitive whose docstring says
the write question is never gated, next to nine writes that gate it, is two
answers to one question.

`test_only_reads_use_the_gated_ownership_guard` is that rule as a guard, and
`test_credential_crud_refuses_another_accounts_row` is the family that had no
check at all — not a gated one, none. The reads stay gated on purpose: refusing
to *show* a row is a visibility change, which is exactly what the flag defers.

## Why the refusal is not gated on `TENANCY_ENFORCED`

Every seam adoption so far is invisible while the flag is off, because the flag
gates **visibility** and no batch is allowed to change a response. This one
follows ticket 30 instead, for the same reason dismissals did: the question here
is not "may I see this row" but "is this row mine", and a flag cannot gate
identity. Gated off, the clobber is still there on the deployment that has it.

It costs nothing to leave ungated, which is what makes the argument easy: on a
single-account deployment there is no foreign row to refuse, so no response
moves. **Rows with a NULL owner are deliberately still writable while the flag
is off** — legacy rows and anything a background job wrote carry no stamp, and
refusing those would break the operator's own restore today. Under enforcement
`assert_owner` adds the NULL rule, because a row nobody can read and anybody can
overwrite is the worst of both. Every guard below is parametrised over both flag
states to say all of that out loud.

## Mutation-tested

Sixteen mutations, each watched before the guard it targets was trusted:

* drop `_assert_importable` from `_import_summaries` → the summaries battery
  fails, both flag states
* gate `_assert_importable` behind `tenancy_enforced()` → only the flag-off
  parametrisations fail (the shape a half-fix takes, per ticket 30)
* refuse a NULL owner unconditionally → the ownerless-row guard fails flag-off
* excuse network logs from `_import_logs` again → the network battery fails
* owner-check sync logs in `_import_logs` → the sync exemption fails, flag-on
* give the import path a detail string of its own → the detail guard fails
* drop the check from `migrate_bot_credentials` → its battery fails
* drop an entry from `IMPORT_WRITES`, or downgrade one from "Checked" to
  "Excused" → the coverage guard fails
* add an `_import_quota_usage` writing an unplaced table → the coverage guard
  fails (this is the scenario that motivated deriving it from the AST)
* re-gate `upsert_summary` onto `assert_owner` → the ticket 17 flag-off battery
  **and** the read/write primitive guard both fail
* drop either credential-family write check → that battery fails, both states
* give `assert_owner_on_write` a `detail` default → the contract guard fails

**Three mutations were watched passing, and each one changed the work.**

* renaming a detail constant in production and in the test together passed,
  because the first version of the detail guard imported the same constant it
  was pinning. It now compares two independent paths, which is the invariant
  that actually matters — the endpoint and the import answering *differently*.
* moving the check after the mutation instead of before it passed, and
  correctly: the document is one transaction and nothing commits on the way to
  the raise, so the ordering is a readability preference and not a guarantee.
  The claim that it was one was removed rather than propped up.
* re-gating `upsert_summary`, and separately deleting the credential checks,
  passed everything — because the first cut of this ticket shipped those fixes
  with no guard at all. Review caught the fixes; the mutations caught that
  nothing was holding them. That is the whole argument for the rule: a fix
  nobody can break is a fix nobody is keeping.
"""

from __future__ import annotations

import ast
import pathlib
import uuid
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, SQLModel, col, delete

from app import models_tg
from app.core.db import engine
from app.models import User
from app.models_tg import (
    BotCredential,
    ChatDestination,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    PublishLog,
    Summary,
    SyncLog,
)
from app.services import data_import_export
from app.services.credentials import (
    delete_bot_credential,
    delete_chat_destination,
    encrypt_bot_token,
    migrate_bot_credentials,
    upsert_bot_credential,
    upsert_chat_destination,
)
from app.services.data_import_export import (
    IMPORT_WRITES,
    INDIRECT_WRITES,
    import_data,
)
from app.services.logs import LOG_MODELS, get_log
from app.services.summaries import get_summary
from app.services.tenancy import Scope, scope_of
from tests.utils.user import create_random_user

BOTH_FLAG_STATES = pytest.mark.parametrize("enforced", [False, True])


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


def _set_flag(monkeypatch: pytest.MonkeyPatch, value: bool) -> None:
    """Turn the seam on or off for one test. See `test_tenancy_seam.py`.

    Set explicitly rather than assumed, so this file is green whichever way the
    ambient default points — ticket 21 flipping it does not come back here.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", value)


# --------------------------------------------------------------------------
# The families an import can overwrite, and what an overwrite would change
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Family:
    """One export section, seeded and then attacked.

    Parametrised rather than written out six times for the reason ticket 17
    gives: these are near-copies of one another, and a seventh section added
    without a check should fail `test_every_import_write_is_covered_or_excused`
    rather than pass because nobody wrote its four tests.
    """

    section: str
    model: type[SQLModel]
    #: Provoke this family's **own** 404 for an id that is not there, through
    #: whatever endpoint already answers for one. The detail guard compares the
    #: import refusal against what this raises rather than against a constant
    #: the production code and the test both import: that version passes when
    #: the constant is renamed in both places, which is exactly the case where
    #: the oracle is still closed and nothing is wrong. What must never happen
    #: is the *two paths* answering differently, and only two paths can show it.
    absent: Callable[[Session, str, uuid.UUID], object]
    seed: Callable[[str, uuid.UUID | None], SQLModel]
    attack: Callable[[str], dict[str, Any]]
    probe: Callable[[Any], Any]
    original: Any
    attacked: Any


THEIR_TOKEN = "111111:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
MY_TOKEN = "222222:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"


FAMILIES: tuple[Family, ...] = (
    Family(
        section="summaries",
        model=Summary,
        absent=lambda session, row_id, viewer: get_summary(
            session, row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: Summary(
            id=row_id,
            user_id=owner,
            text="theirs",
            channels=["alpha"],
            start_date=0,
            end_date=0,
            language="English",
            timestamp=0,
            extra={},
        ),
        attack=lambda row_id: {"id": row_id, "text": "pwned"},
        probe=lambda row: row.text,
        original="theirs",
        attacked="pwned",
    ),
    Family(
        section="bot_credentials",
        model=BotCredential,
        absent=lambda session, row_id, viewer: delete_bot_credential(
            session, row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: BotCredential(
            id=row_id,
            user_id=owner,
            name="theirs",
            token_encrypted=encrypt_bot_token(THEIR_TOKEN),
        ),
        attack=lambda row_id: {"id": row_id, "name": "pwned", "token": MY_TOKEN},
        probe=lambda row: row.name,
        original="theirs",
        attacked="pwned",
    ),
    Family(
        section="chat_destinations",
        model=ChatDestination,
        absent=lambda session, row_id, viewer: delete_chat_destination(
            session, row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: ChatDestination(
            id=row_id,
            user_id=owner,
            name="theirs",
            chat_id="-1001",
        ),
        attack=lambda row_id: {"id": row_id, "name": "pwned", "chat_id": "-1002"},
        probe=lambda row: row.name,
        original="theirs",
        attacked="pwned",
    ),
    Family(
        section="publish_logs",
        model=PublishLog,
        absent=lambda session, row_id, viewer: get_log(
            session, "publish", row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: PublishLog(
            id=row_id,
            user_id=owner,
            summary_id="s1",
            bot_id="b1",
            bot_name="theirs",
            chat_id="-1001",
            chat_name="theirs",
            status="success",
            timestamp=0,
        ),
        attack=lambda row_id: {"id": row_id, "status": "pwned"},
        probe=lambda row: row.status,
        original="success",
        attacked="pwned",
    ),
    Family(
        section="llm_logs",
        model=LLMLog,
        absent=lambda session, row_id, viewer: get_log(
            session, "llm", row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: LLMLog(
            id=row_id,
            user_id=owner,
            model="theirs",
            prompt="",
            response="",
            status="success",
            timestamp=0,
        ),
        attack=lambda row_id: {"id": row_id, "model": "pwned"},
        probe=lambda row: row.model,
        original="theirs",
        attacked="pwned",
    ),
    Family(
        section="network_logs",
        model=NetworkLog,
        absent=lambda session, row_id, viewer: get_log(
            session, "network", row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: NetworkLog(
            id=row_id,
            user_id=owner,
            url="https://t.me/s/alpha",
            method="GET",
            status="theirs",
            timestamp=0,
        ),
        attack=lambda row_id: {
            "id": row_id,
            "url": "https://t.me/s/alpha",
            "status": "pwned",
        },
        probe=lambda row: row.status,
        original="theirs",
        attacked="pwned",
    ),
    Family(
        section="embedding_logs",
        model=EmbeddingLog,
        absent=lambda session, row_id, viewer: get_log(
            session, "embedding", row_id, user_id=viewer
        ),
        seed=lambda row_id, owner: EmbeddingLog(
            id=row_id,
            user_id=owner,
            text_count=1,
            status="theirs",
            timestamp=0,
        ),
        attack=lambda row_id: {"id": row_id, "status": "pwned"},
        probe=lambda row: row.status,
        original="theirs",
        attacked="pwned",
    ),
)

FAMILIES_BY_SECTION = {family.section: family for family in FAMILIES}


def _ids(families: tuple[Family, ...]) -> list[str]:
    return [family.section for family in families]


def _seed(session: Session, family: Family, owner: uuid.UUID | None) -> str:
    row_id = f"{family.section}-{uuid.uuid4()}"
    session.add(family.seed(row_id, owner))
    session.commit()
    return row_id


def _reread(session: Session, family: Family, row_id: str) -> Any:
    session.expire_all()
    return session.get(family.model, row_id)


# --------------------------------------------------------------------------
# The decision, asserted as its own premise
# --------------------------------------------------------------------------


def test_import_stamps_new_rows_with_the_caller_not_the_document(
    session: Session, user: User, other_user: User
) -> None:
    """Why a per-account import loses nothing: it never had another owner.

    The document names `other_user` every way it can and the row still comes out
    owned by the caller, because no importer reads an owner off an item. That is
    the whole argument for design (1) over design (2): a cross-account restore is
    not being refused here, it does not exist yet. Ticket 28 is where it starts
    to, and this guard is what stops that ticket inheriting the decision by
    accident.
    """
    row_id = f"summaries-{uuid.uuid4()}"
    import_data(
        session,
        {
            "summaries": [
                {
                    "id": row_id,
                    "text": "mine",
                    "userId": str(other_user.id),
                    "user_id": str(other_user.id),
                }
            ]
        },
        user_id=user.id,
    )
    created = session.get(Summary, row_id)
    assert created is not None
    assert created.user_id == user.id


#: Models `data_import_export.py` names but never writes a row of. Two entries,
#: both read-only lookups, so the AST walk below does not demand a placement for
#: something the module only reads.
NAMED_BUT_NOT_WRITTEN = {
    "ChannelSettingGroup": (
        "Resolved by `session.get` and by `ensure_default_group`, never merged "
        "into by an id the document supplies."
    ),
}


def test_every_import_write_is_covered_or_excused() -> None:
    """A table the import writes is attacked here, or says why it is not.

    **Derived from the module's AST, not from a list.** The first version
    compared `IMPORT_WRITES` against two hard-coded sets, which asserts that the
    inventory is what it is and nothing more — review pointed out that adding an
    `_import_quota_usage` writing a new table would have left every test in this
    file green while this docstring claimed otherwise. It now reads the domain
    models the module actually names and requires each to be placed, the way
    `test_channel_creation_paths.py` walks for its creators.

    Names reached *indirectly* still have to be added by hand: `ChannelFollow`
    goes through `sync_follow_settings` and `SyncMeta` through `touch_sync`, and
    neither is spelled in this module. Both are in the inventory because review
    found them missing. An AST walk cannot close that gap; what it closes is the
    far likelier one, a new section importing a model and writing it.
    """
    for model, note in IMPORT_WRITES.items():
        assert note, f"{model.__name__} is listed with no reason"
    for name, note in INDIRECT_WRITES.items():
        assert note, f"{name} is listed with no reason"

    domain_models = {
        name
        for name, value in vars(models_tg).items()
        if isinstance(value, type)
        and issubclass(value, SQLModel)
        and getattr(value, "__table__", None) is not None
    }
    tree = ast.parse(pathlib.Path(data_import_export.__file__).read_text())
    named = {
        node.id
        for node in ast.walk(tree)
        if isinstance(node, ast.Name) and node.id in domain_models
    }
    placed = {model.__name__ for model in IMPORT_WRITES}

    unplaced = named - placed - set(NAMED_BUT_NOT_WRITTEN) - set(INDIRECT_WRITES)
    assert not unplaced, (
        f"{sorted(unplaced)} are named in data_import_export.py and appear in "
        f"neither IMPORT_WRITES nor NAMED_BUT_NOT_WRITTEN. Say which, with a "
        f"reason."
    )

    # Every entry's own note has to agree with whether the battery attacks it,
    # so an entry cannot be quietly downgraded to "Excused" to dodge a guard.
    attacked = {family.model for family in FAMILIES}
    assert attacked <= set(IMPORT_WRITES)
    for model, note in IMPORT_WRITES.items():
        checked = model in attacked
        assert checked == note.startswith("Checked"), (
            f"{model.__name__} says {note.split(':')[0]!r} but is "
            f"{'in' if checked else 'not in'} the battery above"
        )


# --------------------------------------------------------------------------
# The hole itself, under both flag states
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
@pytest.mark.parametrize("family", FAMILIES, ids=_ids(FAMILIES))
def test_importing_a_row_another_account_owns_is_refused(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    family: Family,
    enforced: bool,
) -> None:
    """The clobber, closed. Both flag states, because this is identity."""
    _set_flag(monkeypatch, enforced)
    row_id = _seed(session, family, other_user.id)

    with pytest.raises(HTTPException) as excinfo:
        import_data(session, {family.section: [family.attack(row_id)]}, user_id=user.id)

    assert excinfo.value.status_code == 404
    session.rollback()
    assert family.probe(_reread(session, family, row_id)) == family.original


@BOTH_FLAG_STATES
@pytest.mark.parametrize("family", FAMILIES, ids=_ids(FAMILIES))
def test_the_refusal_matches_the_absent_row_detail(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    family: Family,
    enforced: bool,
) -> None:
    """404 is half the answer; a distinguishable body reopens the oracle.

    Compared against what this family's own endpoint raises for an id that is
    genuinely not there, rather than against the constant the production code
    uses — two independent paths, because a one-path assertion moves with the
    thing it is meant to pin. Renaming the constant everywhere keeps the oracle
    closed and should stay green; the two paths *drifting apart* is the failure,
    and only this shape can see it.
    """
    _set_flag(monkeypatch, enforced)
    row_id = _seed(session, family, other_user.id)

    with pytest.raises(HTTPException) as missing:
        family.absent(session, f"absent-{uuid.uuid4()}", user.id)
    session.rollback()

    with pytest.raises(HTTPException) as refused:
        import_data(session, {family.section: [family.attack(row_id)]}, user_id=user.id)

    assert missing.value.status_code == 404
    assert refused.value.status_code == 404
    assert refused.value.detail == missing.value.detail
    session.rollback()


@BOTH_FLAG_STATES
@pytest.mark.parametrize("family", FAMILIES, ids=_ids(FAMILIES))
def test_your_own_row_still_imports(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    family: Family,
    enforced: bool,
) -> None:
    """The check fires on a foreign row, not on every row with an id."""
    _set_flag(monkeypatch, enforced)
    row_id = _seed(session, family, user.id)

    import_data(session, {family.section: [family.attack(row_id)]}, user_id=user.id)

    assert family.probe(_reread(session, family, row_id)) == family.attacked


@BOTH_FLAG_STATES
@pytest.mark.parametrize("family", FAMILIES, ids=_ids(FAMILIES))
def test_an_absent_id_still_creates(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    family: Family,
    enforced: bool,
) -> None:
    """Still an upsert. A guard that broke creation would break restore."""
    _set_flag(monkeypatch, enforced)
    row_id = f"{family.section}-{uuid.uuid4()}"

    import_data(session, {family.section: [family.attack(row_id)]}, user_id=user.id)

    created = _reread(session, family, row_id)
    assert created is not None
    assert created.user_id == user.id


@pytest.mark.parametrize("family", FAMILIES, ids=_ids(FAMILIES))
def test_an_ownerless_row_can_no_longer_be_written_at_all(
    session: Session,
    family: Family,
) -> None:
    """Ticket 21 removed the row shape these two tests were about.

    There used to be a pair here — `..._is_still_writable_while_the_flag_is_off`
    and `..._is_refused_under_enforcement` — pinning `assert_owner_on_write`'s
    one asymmetry between the flag states from both sides. That asymmetry
    existed for legacy rows and for anything a background job wrote, and PR 3 of
    ticket 21 makes `user_id` `NOT NULL` on all fourteen `USER_OWNED` tables, so
    an import can no longer *find* such a row to overwrite: the database refuses
    to hold one.

    The branch is still in `may_act_on` and still gated, because the seam's
    primitives take `uuid.UUID | None` and the sync-log family below genuinely
    has no owner. What changed is that it is unreachable through these seven
    sections — and an inverted assertion is worth more here than a deleted one,
    because a `NOT NULL` quietly dropped in a later migration would put the
    clobber back exactly where ticket 31 found it.
    """
    with pytest.raises(IntegrityError):
        _seed(session, family, None)
    session.rollback()


# --------------------------------------------------------------------------
# The families that are deliberately not refused
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_a_sync_log_is_not_refused_for_having_no_owner(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch, enforced: bool
) -> None:
    """Sync logs are Channel telemetry (ticket 19) and store no owner at all.

    `upsert_sync_log` deliberately ignores the `user_id` it is handed, so every
    row here has a NULL owner as a matter of course. An owner check over this
    family would refuse every sync log an import carries — which is the failure
    that looks most like the fix working.
    """
    _set_flag(monkeypatch, enforced)
    row_id = f"sync-{uuid.uuid4()}"
    session.add(
        SyncLog(
            id=row_id,
            channel_name="alpha",
            status="success",
            posts_count=1,
            timestamp=0,
        )
    )
    session.commit()

    import_data(
        session,
        {"sync_logs": [{"id": row_id, "channel_name": "alpha", "status": "failed"}]},
        user_id=user.id,
    )

    session.expire_all()
    row = session.get(SyncLog, row_id)
    assert row is not None
    assert row.status == "failed"


def test_the_import_and_the_api_door_owner_check_the_same_log_types() -> None:
    """One rule for one question, derived from the seam rather than listed.

    The first cut gated the import on `PERSONAL_LOG_TYPES` and excused network
    logs, while `create_logs` at the API door owner-checks them and says why in
    its own docstring — "a write landing on an existing row is an overwrite
    either way". Review caught the two disagreeing. `PERSONAL_LOG_TYPES` is a
    *retention* partition, and borrowing it to answer a write-authority question
    was the category error underneath, so both doors now ask the seam directly.

    Sync logs are the one family the import skips, and this asserts that too:
    the API door checks the Follow instead, and that branch is create-only,
    which a restore cannot adopt without refusing every re-import.
    """
    checked = {
        log_type
        for log_type, (model, _) in LOG_MODELS.items()
        if scope_of(model) is not Scope.FOLLOW_SCOPED
    }

    assert checked == {"publish", "llm", "embedding", "network"}
    assert set(LOG_MODELS) - checked == {"sync"}
    assert {
        family.section for family in FAMILIES if family.section.endswith("_logs")
    } == {f"{log_type}_logs" for log_type in checked}


# --------------------------------------------------------------------------
# The document is one transaction, so a refusal takes the whole of it
# --------------------------------------------------------------------------


def test_a_refused_row_takes_the_rest_of_the_document_with_it(
    session: Session, user: User, other_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One transaction per document, so a partial import is not a thing.

    The legal row earlier in the same document does not survive the refusal that
    comes after it. That is the single transaction doing the work, not the order
    of the check within a section — moving the check after the overwrite was
    watched passing, because nothing commits on the way to the raise either way.
    """
    _set_flag(monkeypatch, False)
    theirs = _seed(session, FAMILIES_BY_SECTION["summaries"], other_user.id)
    mine = f"summaries-{uuid.uuid4()}"

    with pytest.raises(HTTPException):
        import_data(
            session,
            {
                "summaries": [
                    {"id": mine, "text": "mine"},
                    {"id": theirs, "text": "pwned"},
                ]
            },
            user_id=user.id,
        )

    session.rollback()
    session.expire_all()
    assert session.get(Summary, mine) is None
    row = session.get(Summary, theirs)
    assert row is not None
    assert row.text == "theirs"


# --------------------------------------------------------------------------
# The credential families' own CRUD, which had no check at all
# --------------------------------------------------------------------------


#: The four by-id writes on the two credential families, as
#: (name, write, delete, seed, detail). These had **no owner check in either
#: flag state** before ticket 31 — not a gated one, none — while their routes
#: are plain `CurrentUser`. `PUT /data/bot-credentials/{id}` naming another
#: account's id replaced that account's stored **bot token**, which is the exact
#: harm this ticket names, through a door easier to reach than the import.
CREDENTIAL_WRITES = (
    (
        "bot_credentials",
        lambda session, row_id, viewer: upsert_bot_credential(
            session, row_id, {"name": "pwned", "token": MY_TOKEN}, user_id=viewer
        ),
        lambda session, row_id, viewer: delete_bot_credential(
            session, row_id, user_id=viewer
        ),
    ),
    (
        "chat_destinations",
        lambda session, row_id, viewer: upsert_chat_destination(
            session, row_id, {"name": "pwned", "chat_id": "-1009"}, user_id=viewer
        ),
        lambda session, row_id, viewer: delete_chat_destination(
            session, row_id, user_id=viewer
        ),
    ),
)


@BOTH_FLAG_STATES
@pytest.mark.parametrize(
    ("section", "write", "remove"),
    CREDENTIAL_WRITES,
    ids=[c[0] for c in CREDENTIAL_WRITES],
)
def test_credential_crud_refuses_another_accounts_row(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    section: str,
    write: Any,
    remove: Any,
    enforced: bool,
) -> None:
    """The easier door onto the rows the import now protects.

    Deferred on the first cut, on the reasoning that scoping a write without its
    read is the half-fix ticket 17 names. Review pushed back and was right: that
    ticket's half-fix was scoping a *read* and leaving the write, which is the
    opposite direction. The write question is identity and ungated; the read
    question is visibility and gated. They are separable, and only one of them
    lets a stranger replace a bot token.
    """
    _set_flag(monkeypatch, enforced)
    family = FAMILIES_BY_SECTION[section]
    row_id = _seed(session, family, other_user.id)

    with pytest.raises(HTTPException) as written:
        write(session, row_id, user.id)
    session.rollback()

    with pytest.raises(HTTPException) as removed:
        remove(session, row_id, user.id)
    session.rollback()

    assert written.value.status_code == 404
    assert removed.value.status_code == 404
    session.expire_all()
    assert family.probe(session.get(family.model, row_id)) == family.original


@BOTH_FLAG_STATES
@pytest.mark.parametrize(
    ("section", "write", "remove"),
    CREDENTIAL_WRITES,
    ids=[c[0] for c in CREDENTIAL_WRITES],
)
def test_credential_crud_still_writes_your_own(
    session: Session,
    user: User,
    monkeypatch: pytest.MonkeyPatch,
    section: str,
    write: Any,
    remove: Any,
    enforced: bool,
) -> None:
    _set_flag(monkeypatch, enforced)
    family = FAMILIES_BY_SECTION[section]
    row_id = _seed(session, family, user.id)

    write(session, row_id, user.id)
    session.expire_all()
    assert family.probe(session.get(family.model, row_id)) == family.attacked

    remove(session, row_id, user.id)
    session.expire_all()
    assert session.get(family.model, row_id) is None


# --------------------------------------------------------------------------
# One rule: a read may be gated, a write may not
# --------------------------------------------------------------------------


#: Every function in `app/` allowed to call the flag-**gated** `assert_owner`,
#: with why it is a read. Anything else calling it is a write that would go on
#: clobbering another account's row until ticket 21, which is the state this
#: ticket found the codebase in.
#:
#: A declared inventory rather than a derived one, for the reason `SCOPES` and
#: `FOLLOW_TABLE_WRITERS` are: "is this function a read?" is not decidable from
#: the AST, and the point is that adding a name here is a decision somebody has
#: to write a sentence for.
GATED_READS: dict[str, str] = {
    "summaries.get_summary": "Reads one summary; hiding it is a visibility change.",
    "chat_sessions.get_chat_session": "Reads one chat session.",
    "tag_runs.get_tag_run": "Reads one tag run.",
    "discover_reports.get_report": "Reads one Discover report.",
    "logs.get_log": "Reads one log row in full.",
    "channels._visible_follow_job": (
        "Resolves one bulk-follow job for a caller to *read* — the status route "
        "and its SSE stream. A read, so gated. Its cancel sibling is "
        "`_assert_may_cancel_follow_job` on the ungated primitive, for the "
        "reason `_cancellable_job` gives one family over: stopping a job is a "
        "write. Both were added by review of ticket 21 PR 4, which found all "
        "three routes taking `_current_user` and never using it."
    ),
    "jobs._visible_job": (
        "Resolves one sync job for a caller to *read* — `GET /jobs/sync/{id}` "
        "and the SSE stream. The cancel route used to share it and no longer "
        "does: `_cancellable_job` is the same three cases on "
        "`assert_owner_on_write`, because stopping a sync is a write. Review "
        "of ticket 21 PR 3 caught that, and the reason is worth keeping — "
        "before PR 1 a job that was not yours was *nobody's*, so the "
        "`JOBS_MANAGE` branch refused it whatever the flag said. Giving the "
        "scheduler's jobs a real owner is what dropped a foreign one onto the "
        "gated guard alone."
    ),
}


def test_only_reads_use_the_gated_ownership_guard() -> None:
    """`assert_owner` defers to the flag; `assert_owner_on_write` does not.

    Which one a call site takes is the difference between a rule that waits for
    ticket 21 and one that holds now, and nothing was checking it — the first
    cut of this ticket built the ungated guard for the import door and left nine
    by-id writes on the gated one, including three behind routes with no
    permission gate at all. Mutation-tested: re-gating `upsert_summary` passed
    every guard in the repo before this existed.
    """
    found: dict[str, str] = {}
    root = pathlib.Path(data_import_export.__file__).parents[1]

    for path in sorted(root.rglob("*.py")):
        # `tenancy.py` declares both primitives. Ticket 33 moved the shared rule
        # into `may_act_on`, so the ungated one no longer calls the gated one —
        # the skip stays because declaring a guard must never be mistaken for
        # taking one, whichever way the two are composed next.
        if "alembic" in path.parts or path.name == "tenancy.py":
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef):
                continue
            for inner in ast.walk(node):
                if (
                    isinstance(inner, ast.Call)
                    and isinstance(inner.func, ast.Name)
                    and inner.func.id == "assert_owner"
                ):
                    found[f"{path.stem}.{node.name}"] = str(path)

    unexpected = set(found) - set(GATED_READS)
    assert not unexpected, (
        f"{sorted(unexpected)} call the flag-gated `assert_owner`. If it is a "
        f"read, add it to GATED_READS with a reason. If it writes or deletes, "
        f"it must call `assert_owner_on_write` — a gated write goes on "
        f"clobbering another account's row until ticket 21 flips the flag."
    )
    missing = set(GATED_READS) - set(found)
    assert not missing, (
        f"{sorted(missing)} are declared as gated reads but no longer call "
        f"`assert_owner`. Drop the entry rather than leaving a stale exemption."
    )


# --------------------------------------------------------------------------
# The other import-shaped door
# --------------------------------------------------------------------------


@BOTH_FLAG_STATES
def test_migrate_bot_credentials_refuses_another_accounts_credential(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    enforced: bool,
) -> None:
    """`POST /data/bot-credentials/migrate` is an import by another name.

    Same shape as `_import_bot_credentials` — a list of exported credentials,
    merged by id, tokens re-encrypted — and unlike `/data/import` it is not even
    Admin-gated. Fixing one door and leaving this one open is precisely the
    "reaches the same tables by a different door" mistake this ticket exists to
    correct.
    """
    _set_flag(monkeypatch, enforced)
    row_id = _seed(session, FAMILIES_BY_SECTION["bot_credentials"], other_user.id)
    before = session.get(BotCredential, row_id)
    assert before is not None
    stored = before.token_encrypted

    with pytest.raises(HTTPException) as missing:
        delete_bot_credential(session, f"absent-{uuid.uuid4()}", user_id=user.id)
    session.rollback()

    with pytest.raises(HTTPException) as refused:
        migrate_bot_credentials(
            session,
            [{"id": row_id, "name": "pwned", "token": MY_TOKEN}],
            user_id=user.id,
        )

    assert refused.value.status_code == 404
    assert refused.value.detail == missing.value.detail
    session.rollback()
    session.expire_all()
    after = session.get(BotCredential, row_id)
    assert after is not None
    assert after.name == "theirs"
    assert after.token_encrypted == stored


@BOTH_FLAG_STATES
def test_migrate_bot_credentials_still_writes_your_own(
    session: Session, user: User, monkeypatch: pytest.MonkeyPatch, enforced: bool
) -> None:
    _set_flag(monkeypatch, enforced)
    row_id = _seed(session, FAMILIES_BY_SECTION["bot_credentials"], user.id)

    result = migrate_bot_credentials(
        session, [{"id": row_id, "name": "mine", "token": MY_TOKEN}], user_id=user.id
    )

    assert result["migrated"] == 1
    session.expire_all()
    row = session.get(BotCredential, row_id)
    assert row is not None
    assert row.name == "mine"
