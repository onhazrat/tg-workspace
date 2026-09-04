"""Ticket 37: the name-collision filter answers identity, and the index agrees.

`_name_collision_scope_filter` answers "is this name already taken". It mirrors
the unique index `(COALESCE(user_id::text, 'global'), lower(name))` on
`tg_channel_setting_groups`, and for as long as ownerless preset rows existed it
was deliberately *wider* than that index: `me OR user_id IS NULL`.

Ticket 21 deleted those rows and made the column `NOT NULL` with a cascading
key, so the wider leg stopped being able to match anything. Narrowing it is a
no-op to behaviour, which is exactly why it needs a guard: the two only agree
now by arithmetic, and nothing was watching.

**The band this protects against is a 500.** If the filter is ever narrower than
the index, or the index ever wider than the filter, there is a set of names the
application believes are free and Postgres refuses. Those arrive as an
`IntegrityError` out of `session.commit()` while the route has a 409 ready three
frames up. So every behavioural test here asserts the 409 *and* names
`IntegrityError` in its failure mode, rather than asserting "it raised".

**The filter now reads exactly like a scoped read, and it must never become
one.** With the `IS NULL` leg gone the body is `user_id == me`, which is
byte-for-byte what `scoped_select` produces for a `USER_OWNED` table. Ticket
30's rule says why it cannot adopt the seam: the owner in a key answers *which
row is yours*, and a flag may gate visibility but never identity. Gate this one
and a duplicate name stops being rejected while `TENANCY_ENFORCED` is off, then
arrives as the `UniqueViolation` above. `test_the_filter_consults_neither_the_
flag_nor_the_seam` is the row that fails when somebody simplifies it on sight,
and it asserts the *reason* rather than the current query, in the pattern
`client-split.conform.ts` set.

Per `CLAUDE.md`, each assertion here was mutation-tested. Ten mutations were
applied and each watched to fail the one row that names it. Six on the rule:
restoring the `IS NULL` leg, widening the filter to every row, narrowing it to
somebody else's rows, routing it through `tenancy_enforced()`, reintroducing an
optional owner on `scope_key`, and dropping the collision check from the rename
path. Four on the *scan*, added in review, because a guard that reads source has
its own evasions: a flag call hidden behind a triple-quoted block, the optional
owner spelled `Optional[uuid.UUID]` and `None | uuid.UUID`, and the scope
reintroduced on an `async def`.
"""

from __future__ import annotations

import ast
import inspect
import textwrap
import uuid
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow, ChannelSettingGroup
from app.services import channel_setting_groups as groups_module
from app.services.channel_setting_groups import (
    SLOW_FEED_GROUP_NAME,
    _name_collision_scope_filter,
    create_setting_group,
    ensure_builtin_groups,
    update_setting_group,
)
from tests.utils.user import create_random_user

FLAG_STATES = ("enforced", "unenforced")


def _body_without_docstring(func: object) -> str:
    """The function's statements, with its own docstring dropped.

    Splitting the source on the last `\"\"\"` is the obvious version and it is
    wrong: a triple-quoted `text(...)` block added anywhere in the body would
    hide every statement before it from the scan, silently, while the guard
    stayed green. Found in review.
    """
    parsed = ast.parse(textwrap.dedent(inspect.getsource(func))).body[0]
    assert isinstance(parsed, ast.FunctionDef)
    statements = parsed.body
    if ast.get_docstring(parsed) is not None:
        statements = statements[1:]
    return "\n".join(ast.unparse(node) for node in statements)


def _is_optional_owner(annotation: ast.expr) -> bool:
    """Every spelling of "a UUID or nothing", not just the one in use today.

    `uuid.UUID | None` is what the module wrote, but `Optional[uuid.UUID]`,
    `None | uuid.UUID` and a bare `UUID | None` after `from uuid import UUID`
    all reintroduce the unowned scope. Matching one literal string would leave
    the guard green through any of them. Found in review.
    """
    text = ast.unparse(annotation).replace(" ", "")
    if "UUID" not in text:
        return False
    return (
        "|None" in text
        or "None|" in text
        or text.startswith(("Optional[", "typing.Optional["))
    )


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture(autouse=True)
def _clean(session: Session) -> None:
    """Wipe before *and* after, so migration-seeded rows never decide an answer.

    `l4m5n6o7p8q9` and `n6o7p8q9r0s1` seed presets into every database migrated
    from empty. This file counts rows and asserts on names, so it is the exact
    shape ticket 34's review found passing for the wrong reason.
    """
    _truncate(session)
    yield
    _truncate(session)


def _truncate(session: Session) -> None:
    session.exec(delete(ChannelFollow))
    session.exec(delete(Channel))
    session.exec(delete(ChannelSettingGroup))
    session.commit()


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def set_flag(monkeypatch: pytest.MonkeyPatch):
    from app.core import config

    def _set(flag_state: str) -> None:
        monkeypatch.setattr(
            config.settings, "TENANCY_ENFORCED", flag_state == "enforced"
        )

    return _set


# --------------------------------------------------------------------------
# A duplicate name is a 409, never a UniqueViolation
# --------------------------------------------------------------------------


@pytest.mark.parametrize("flag_state", FLAG_STATES)
def test_a_second_group_of_the_same_name_answers_409(
    session: Session, user: User, set_flag, flag_state: str
) -> None:
    """The route's own answer, in both flag states, because identity is ungated."""
    set_flag(flag_state)
    create_setting_group(session, {"name": "Research"}, user_id=user.id)

    try:
        with pytest.raises(HTTPException) as exc_info:
            create_setting_group(session, {"name": "research"}, user_id=user.id)
    except IntegrityError as exc:  # pragma: no cover - the failure this guards
        session.rollback()
        pytest.fail(
            "A duplicate name reached Postgres and came back as an "
            f"IntegrityError instead of the route's 409: {exc}. The filter is "
            "narrower than the unique index it mirrors."
        )

    assert exc_info.value.status_code == 409


@pytest.mark.parametrize("flag_state", FLAG_STATES)
def test_renaming_onto_a_seeded_preset_answers_409(
    session: Session, user: User, set_flag, flag_state: str
) -> None:
    """The case the wider leg used to cover, now covered by the account's own row.

    While the presets were global, `me OR user_id IS NULL` is what caught this.
    They are per-account now, so the narrowed filter has to catch it on its own
    leg. `update_setting_group` checks the collision *before* `apply_group_fields`
    refuses reserved names, so a 400 here means the order flipped and the
    collision is no longer what answers.
    """
    set_flag(flag_state)
    ensure_builtin_groups(session, user_id=user.id)
    created = create_setting_group(session, {"name": "Research"}, user_id=user.id)

    try:
        with pytest.raises(HTTPException) as exc_info:
            update_setting_group(
                session,
                str(created["id"]),
                {"name": SLOW_FEED_GROUP_NAME},
                user_id=user.id,
            )
    except IntegrityError as exc:  # pragma: no cover - the failure this guards
        session.rollback()
        pytest.fail(
            "Renaming onto a built-in preset reached Postgres as an "
            f"IntegrityError instead of the route's 409: {exc}."
        )

    assert exc_info.value.status_code == 409, (
        "A preset name must collide through the name filter, not through the "
        "reserved-name check further down `apply_group_fields`."
    )


@pytest.mark.parametrize("flag_state", FLAG_STATES)
def test_two_accounts_may_hold_the_same_name(
    session: Session, user: User, other_user: User, set_flag, flag_state: str
) -> None:
    """The other half: narrowing must not have made the filter global.

    A filter that matched every row would also answer 409 for every duplicate,
    so the tests above pass under it. This is the one that fails, and it is the
    reason the index keys on the owner at all.
    """
    set_flag(flag_state)
    create_setting_group(session, {"name": "Research"}, user_id=user.id)
    create_setting_group(session, {"name": "Research"}, user_id=other_user.id)

    owners = {
        row.user_id
        for row in session.exec(
            select(ChannelSettingGroup).where(ChannelSettingGroup.name == "Research")
        ).all()
    }
    assert owners == {user.id, other_user.id}


# --------------------------------------------------------------------------
# The filter and the index say the same thing
# --------------------------------------------------------------------------


def test_the_filter_has_no_unowned_leg() -> None:
    """`user_id IS NULL` cannot match a row, so it must not be in the query.

    Ticket 21 set the column `NOT NULL`. A leg that can never be true is not
    harmless here: it is the visible difference between this filter and the
    index, and while it stands nobody can tell by reading whether the two agree.
    """
    compiled = str(
        _name_collision_scope_filter(uuid.uuid4()).compile(
            compile_kwargs={"literal_binds": True}
        )
    )
    assert "IS NULL" not in compiled.upper(), (
        "The name filter still tests for an unowned row. "
        f"tg_channel_setting_groups.user_id is NOT NULL since ticket 21: {compiled}"
    )
    assert "user_id" in compiled


def test_the_filter_consults_neither_the_flag_nor_the_seam() -> None:
    """Identity is not visibility, and the narrowed filter now looks like both.

    Asserts the reason rather than the state: `user_id == me` is what
    `scoped_select` produces too, so a test that only checked the query would
    stay green through the change that breaks this.
    """
    body = _body_without_docstring(_name_collision_scope_filter)

    for forbidden in ("tenancy_enforced", "scoped_select"):
        assert forbidden not in body, (
            f"`_name_collision_scope_filter` calls `{forbidden}`. It answers "
            "which row is *yours*, which a flag may never gate — gating it "
            "makes a duplicate name stop being rejected while enforcement is "
            "off and arrive as a Postgres UniqueViolation instead of a 409."
        )


def test_the_module_has_no_unowned_scope() -> None:
    """No function in the module still offers `None` as a scope.

    `scope_key(None)` answered `"global"` and fed five reserved-id builders, so
    `default-global` stayed a constructible id for a row that can no longer be
    inserted. Derived from the AST rather than listed, because the point is that
    a *new* function must not reintroduce the scope either.
    """
    source = Path(inspect.getfile(groups_module)).read_text()
    offenders = [
        f"{node.name}({arg.arg})"
        for node in ast.walk(ast.parse(source))
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        for arg in [*node.args.args, *node.args.kwonlyargs]
        if arg.arg == "user_id"
        and arg.annotation is not None
        and _is_optional_owner(arg.annotation)
    ]
    assert not offenders, (
        "These take an optional owner, but `tg_channel_setting_groups.user_id` "
        "is NOT NULL since ticket 21, so `None` is an IntegrityError rather "
        f"than the global scope: {', '.join(offenders)}"
    )
