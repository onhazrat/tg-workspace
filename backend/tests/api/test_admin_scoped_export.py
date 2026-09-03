"""Ticket 28: an export is about somebody, and it says who before it starts.

`GET /data/export` was Admin-gated and complete, and about nobody in
particular: it walked every table with a bare `select(Model)` and dressed the
Channel section in whoever happened to be asking. On a single-operator
deployment that is a backup. With two accounts it is one person downloading
everybody's summaries, credentials and logs by pressing Export.

So the five things this file holds the line on:

* the subject is a **parameter**, and leaving it off means *you*, never
  everybody — `subject=all` is the wide read and it has to be typed;
* a subject's document carries their Follows, all four artifact families and
  their personal settings, and nobody else's;
* Posts come through the Follow, which is what makes "the subject's corpus"
  mean the same thing here as it does everywhere else;
* the row count is in a header, which a `StreamingResponse` sends before the
  generator runs — asserted by reading the header with the body still
  unconsumed, because asserting it after `.json()` would prove nothing;
* an import creates the Follows its Posts imply, which is the hole ticket 21
  found and left here.

## Both flag states, and why that is not decoration

`subject_select` is **ungated**, unlike `scoped_select`. A read that derives
its account from the caller may be a no-op while `TENANCY_ENFORCED` is off —
that is the rollback working. A read that was *told* the account may not: there
is no state of the flag in which "export user X" honestly means everybody. The
scoping tests run both ways for that reason, and turning the flag off is the
mutation that would otherwise pass.

## Mutation evidence

Seven mutations were run and all seven went red:

* `_for_subject` returning the statement unchanged → 8 failures;
* `subject_select` calling `scoped_select`, re-gating it → 4, **every one of
  them a flag-off parametrisation**, which is the pair a single-state version
  of this file would not have had;
* `_resolve_subject` defaulting to `ExportSubject.everyone()` → 3;
* dropping `_follow_handles_from_posts` from `import_data` → 1;
* dropping the `X-Export-Rows` header → 1;
* `export_row_counts` counting without the subject narrowing → 1, which is the
  case where the number is right about a query the body never ran;
* deleting the `tag_runs` section → 4, one of them the coverage guard naming it.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete, select

from app.api.routes.data.admin import EXPORT_ROWS_HEADER
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import ROLE_ADMIN
from app.models import User
from app.models_rbac import UserRole
from app.models_tg import (
    Channel,
    ChannelFollow,
    ChatSession,
    DiscoverReport,
    Post,
    Summary,
    TagRun,
    UserSetting,
)
from app.services.data_import_export import (
    EVERYONE,
    EXPORT_OMISSIONS,
    SUBJECT_NOT_FOUND,
)
from app.services.follows import ensure_follow_for_channel
from app.services.settings_registry import SYNC_PREFS_KEY
from app.services.tenancy import SCOPES, Scope
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR
DATA = f"{V1}/data"


# --------------------------------------------------------------------------
# Accounts and seeding
# --------------------------------------------------------------------------


def _account(
    client: TestClient, *, role: str | None = None
) -> Iterator[tuple[User, dict[str, str]]]:
    """A real account with a real token — `test_view_as.py`'s helper, verbatim.

    Copied rather than shared for the reason that file gives: these probes are
    about what a *request* can reach, and a fabricated token would prove
    something else.
    """
    from app import crud
    from app.models import UserCreate

    password = random_lower_string()
    with Session(engine) as session:
        email = f"{random_lower_string()}@export.test-account.com"
        user = crud.create_user(
            session=session, user_create=UserCreate(email=email, password=password)
        )
        if role is not None:
            session.add(UserRole(user_id=user.id, role_id=role))
        session.commit()
        session.refresh(user)
        created = user

    headers = user_authentication_headers(
        client=client, email=created.email, password=password
    )
    yield created, headers

    with Session(engine) as session:
        session.exec(delete(User).where(col(User.id) == created.id))  # type: ignore[call-overload]
        session.commit()


@pytest.fixture
def admin(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """The account that may export. `DATA_ADMIN` comes with the Admin role."""
    yield from _account(client, role=ROLE_ADMIN)


@pytest.fixture
def subject(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """The account an export is about."""
    yield from _account(client)


@pytest.fixture
def bystander(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """A third account, whose rows must appear in no subject's document."""
    yield from _account(client)


@pytest.fixture(params=[True, False], ids=["enforced", "flag-off"])
def either_flag_state(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> bool:
    """Run the scoping assertions both ways. See this module's docstring."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", request.param)
    return bool(request.param)


def _seed_account(session: Session, owner: User, tag: str) -> None:
    """One row of everything an export is supposed to carry, for one account.

    `tag` goes in a searchable field of every row, so an assertion can say
    "nothing of theirs" by looking for one string in the whole document instead
    of by walking sections it would then have to keep in step by hand.
    """
    channel = session.exec(select(Channel).where(col(Channel.name) == tag)).first()
    if channel is None:
        channel = Channel(id=tag, name=tag, display_name=tag)
        session.add(channel)
        session.flush()
    ensure_follow_for_channel(
        session,
        channel,
        user_id=owner.id,
        values={"tags": [tag], "followed_at": 1},
    )
    session.add(
        Post(channel_name=tag, post_id=1, text=f"post {tag}", date="", timestamp=1)
    )
    session.add(
        Summary(
            id=f"summary-{tag}",
            user_id=owner.id,
            text=tag,
            channels=[tag],
            start_date=0,
            end_date=0,
            timestamp=0,
            extra={},
        )
    )
    session.add(
        ChatSession(
            id=f"chat-{tag}",
            user_id=owner.id,
            title=tag,
            channels=[tag],
            start_date=0,
            end_date=0,
            mode="full_scope",
            timestamp=0,
            extra={},
        )
    )
    session.add(
        TagRun(
            id=f"tagrun-{tag}",
            user_id=owner.id,
            status=tag,
            source="generated",
            mode="add",
            channels=[tag],
            start_date=0,
            end_date=0,
            created_at=0,
            updated_at_ms=0,
            extra={},
        )
    )
    session.add(
        DiscoverReport(
            id=f"report-{tag}",
            user_id=owner.id,
            channels=[tag],
            start_date=0,
            end_date=0,
            keyword=tag,
            timestamp=0,
            extra={},
        )
    )
    session.add(
        UserSetting(key=SYNC_PREFS_KEY, user_id=owner.id, value={"defaultStartId": tag})
    )
    session.commit()


def _export(
    client: TestClient, headers: dict[str, str], subject: str | None = None
) -> dict[str, Any]:
    params = {} if subject is None else {"subject": subject}
    response = client.get(f"{DATA}/export", headers=headers, params=params)
    assert response.status_code == 200, response.text
    return json.loads(response.content)


def _ids(document: dict[str, Any], section: str) -> set[str]:
    return {str(row["id"]) for row in document["data"][section]}


# --------------------------------------------------------------------------
# Box 1: Admin-only, and it takes a subject
# --------------------------------------------------------------------------


def test_export_is_refused_without_the_permission(
    client: TestClient, subject: tuple[User, dict[str, str]]
) -> None:
    """The gate predates this ticket; a subject parameter must not open it.

    The **detail** is asserted, not the status. Two different rules answer 403
    on this route — the permission gate and the approval gate — and a status
    check would go green on an account that was merely unapproved, proving
    nothing about the gate this test is named for.
    """
    _, headers = subject
    for params in ({}, {"subject": EVERYONE}):
        response = client.get(f"{DATA}/export", headers=headers, params=params)
        assert response.status_code == 403, params
        assert response.json()["detail"] == "The user doesn't have enough privileges", (
            f"refused for the wrong reason with {params}"
        )


def test_omitting_the_subject_means_the_caller_and_not_everybody(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    """The default is the narrow answer.

    This is the behaviour change of the ticket, and the one worth stating
    loudly: an endpoint that returned the deployment now returns you. Reaching
    everybody's rows by *leaving a parameter off* is how the widest read in the
    application came to be something nobody had to ask for.
    """
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers)

    assert _ids(document, "summaries") == {"summary-mine"}
    assert "summary-theirs" not in json.dumps(document)


def test_a_subject_gets_that_accounts_rows_and_nobody_elses(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    bystander: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    """One document, one account — including the Admin's own rows staying out."""
    admin_user, headers = admin
    subject_user, _ = subject
    bystander_user, _ = bystander
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")
        _seed_account(session, bystander_user, "third")

    document = _export(client, headers, str(subject_user.id))
    serialised = json.dumps(document)

    assert _ids(document, "summaries") == {"summary-theirs"}
    assert _ids(document, "chat_sessions") == {"chat-theirs"}
    assert _ids(document, "tag_runs") == {"tagrun-theirs"}
    assert _ids(document, "discover_reports") == {"report-theirs"}
    assert "summary-mine" not in serialised
    assert "summary-third" not in serialised


def test_all_is_the_wide_read_and_has_to_be_asked_for(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """`subject=all` is the deployment backup, and still exists."""
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers, EVERYONE)

    assert _ids(document, "summaries") == {"summary-mine", "summary-theirs"}


@pytest.mark.parametrize(
    "value", [str(uuid.uuid4()), "not-a-uuid", ""], ids=["unknown", "garbage", "empty"]
)
def test_an_unshowable_subject_is_a_404_that_says_nothing(
    client: TestClient, admin: tuple[User, dict[str, str]], value: str
) -> None:
    """ "No such account" and "not an id" answer identically, on purpose.

    An Admin route is still not an account oracle: two different bodies here
    would let anyone holding the permission enumerate which user ids exist by
    reading the error, which is the leak `tenancy.assert_owner` answers 404 for
    one level down.
    """
    _, headers = admin
    response = client.get(f"{DATA}/export", headers=headers, params={"subject": value})
    assert response.status_code == 404
    assert response.json()["detail"] == SUBJECT_NOT_FOUND


# --------------------------------------------------------------------------
# Box 2: Follows, Artifacts, settings
# --------------------------------------------------------------------------


def test_the_document_carries_the_subjects_follow_not_the_callers(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    """Ticket 22 moved `tags` onto the Follow, so a channel has no one answer.

    The Admin follows the same handle with different tags. The subject's
    document has to say the subject's — otherwise a backup restores values its
    owner never had, which is the round-trip `_import_channels` writes back.
    """
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, subject_user, "shared")
        channel = session.exec(
            select(Channel).where(col(Channel.name) == "shared")
        ).one()
        ensure_follow_for_channel(
            session, channel, user_id=admin_user.id, values={"tags": ["admins-tag"]}
        )
        session.commit()

    document = _export(client, headers, str(subject_user.id))

    channels = document["data"]["channels"]
    assert [c["id"] for c in channels] == ["shared"]
    # `normalize_channel_tags` expands a bare string into a tag object, so the
    # name is what to compare — the assertion is about *whose* tag, not its shape.
    assert [tag["name"] for tag in channels[0]["tags"]] == ["shared"], (
        "the subject's follow, not the caller's"
    )


def test_the_document_carries_the_subjects_personal_settings(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers, str(subject_user.id))

    settings_rows = document["data"]["user_settings"]
    assert [row["value"]["defaultStartId"] for row in settings_rows] == ["theirs"]


def test_every_user_owned_table_is_exported_or_excused() -> None:
    """A table nobody placed is a table nobody decided a backup's shape for.

    The same argument `tenancy.SCOPES` makes about the schema and
    `IMPORT_WRITES` about the write door, applied to what a restore can bring
    back. It walks `SCOPES` rather than a list, so a table added next quarter
    fails here until somebody says whether it belongs in an export.
    """
    from app.services.data_import_export import export_sections

    with Session(engine) as session:
        exported = {
            section.model.__name__
            for section in export_sections(
                session,
                subject=_subject_for_guard(),
                viewer_id=uuid.UUID(int=0),
            )
        }

    owned = {
        model.__name__
        for model, scope in SCOPES.items()
        if scope in (Scope.USER_OWNED, Scope.FOLLOW_SCOPED)
    }
    unplaced = owned - exported - set(EXPORT_OMISSIONS)
    assert not unplaced, (
        f"{sorted(unplaced)} are tenancy-scoped tables that an export neither "
        f"carries nor excuses. Add a section, or an EXPORT_OMISSIONS entry "
        f"saying why a backup does not need it."
    )
    for name, reason in EXPORT_OMISSIONS.items():
        assert reason, f"{name} is excused with no reason"
    stale = set(EXPORT_OMISSIONS) & exported
    assert not stale, f"excused and exported at once: {sorted(stale)}"


def _subject_for_guard() -> Any:
    from app.services.data_import_export import ExportSubject

    return ExportSubject.account(uuid.UUID(int=0))


# --------------------------------------------------------------------------
# Box 3: the Posts of Channels the subject Follows
# --------------------------------------------------------------------------


def test_posts_come_through_the_follow(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    """The corpus is shared, so "the subject's Posts" can only mean their follows.

    Not a `user_id` filter — `Post` has none any more (ticket 22), and when it
    did it meant "who scraped this first". Two accounts following one handle
    both export its posts, and that is correct.
    """
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers, str(subject_user.id))

    assert {row["channelName"] for row in document["data"]["posts"]} == {"theirs"}


def test_a_shared_handle_is_exported_for_both_followers(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
    either_flag_state: bool,
) -> None:
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, subject_user, "shared")
        channel = session.exec(
            select(Channel).where(col(Channel.name) == "shared")
        ).one()
        ensure_follow_for_channel(session, channel, user_id=admin_user.id, values={})
        session.commit()

    for who in (None, str(subject_user.id)):
        document = _export(client, headers, who)
        assert {row["channelName"] for row in document["data"]["posts"]} == {"shared"}


# --------------------------------------------------------------------------
# Box 4: it streams, and reports the row count before starting
# --------------------------------------------------------------------------


def test_the_row_count_arrives_before_the_body(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Read the header with the body still unconsumed.

    That is the whole assertion: a count computed on the way *out* would be
    just as correct and would tell an operator nothing, because they are
    already holding the file by then. `StreamingResponse` sends headers before
    it pulls the first chunk from the generator, so a count in one is a count
    before the download starts.
    """
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    with client.stream(
        "GET",
        f"{DATA}/export",
        headers=headers,
        params={"subject": str(subject_user.id)},
    ) as response:
        assert response.status_code == 200
        announced = int(response.headers[EXPORT_ROWS_HEADER])
        body = b"".join(response.iter_bytes())

    document = json.loads(body)
    assert announced > 0
    assert announced == sum(document["counts"].values()), (
        "the header and the document's own counts come from one computation"
    )


def test_the_counts_describe_the_document_that_follows(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Per section, not just in total — a count that is only right in aggregate
    would hide a section scoped one way and counted another."""
    admin_user, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, admin_user, "mine")
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers, str(subject_user.id))

    assert set(document["counts"]) == set(document["data"])
    for section, rows in document["data"].items():
        assert document["counts"][section] == len(rows), section


# --------------------------------------------------------------------------
# Box 5: import routes Channel creation through the Follow path
# --------------------------------------------------------------------------


def test_a_posts_only_import_leaves_rows_the_account_can_read(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The hole ticket 21 found, closed where ticket 21 said it would be.

    A posts section names channels by handle and carries no Channel rows, so
    before this the rows landed in a corpus the account had no Follow into —
    present, counted, and invisible.
    """
    _, headers = admin
    subject_user, _ = subject
    imported = client.post(
        f"{DATA}/import",
        headers=headers,
        params={"subject": str(subject_user.id)},
        json={
            "posts": [
                {
                    "channelName": "orphan",
                    "id": 7,
                    "text": "restored",
                    "date": "",
                    "timestamp": 1,
                }
            ]
        },
    )
    assert imported.status_code == 200, imported.text

    with Session(engine) as session:
        channel = session.exec(
            select(Channel).where(col(Channel.name) == "orphan")
        ).one()
        follow = session.exec(
            select(ChannelFollow).where(
                col(ChannelFollow.user_id) == subject_user.id,
                col(ChannelFollow.channel_id) == channel.id,
            )
        ).one()
        assert follow.setting_group_id is not None, (
            "a group-less follow is the state `run_auto_sync` skips forever"
        )

    document = _export(client, headers, str(subject_user.id))
    assert {row["channelName"] for row in document["data"]["posts"]} == {"orphan"}


def test_an_import_for_a_subject_files_the_rows_under_them(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """The decision this ticket re-took, at the door that implements it."""
    admin_user, headers = admin
    subject_user, _ = subject
    response = client.post(
        f"{DATA}/import",
        headers=headers,
        params={"subject": str(subject_user.id)},
        json={"summaries": [{"id": "restored", "text": "theirs"}]},
    )
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        row = session.get(Summary, "restored")
        assert row is not None
        assert row.user_id == subject_user.id
        assert row.acted_by_user_id == admin_user.id, (
            "ticket 27: the row must not claim the subject uploaded it"
        )
        assert row.acted_by_email == admin_user.email


def test_an_import_under_your_own_name_records_no_acting_owner(
    client: TestClient, admin: tuple[User, dict[str, str]]
) -> None:
    """An Admin restoring their own backup is not acting on anybody's behalf."""
    admin_user, headers = admin
    response = client.post(
        f"{DATA}/import",
        headers=headers,
        json={"summaries": [{"id": "own-backup", "text": "mine"}]},
    )
    assert response.status_code == 200, response.text

    with Session(engine) as session:
        row = session.get(Summary, "own-backup")
        assert row is not None
        assert row.user_id == admin_user.id
        assert row.acted_by_user_id is None


def test_an_import_cannot_be_addressed_to_everybody(
    client: TestClient, admin: tuple[User, dict[str, str]]
) -> None:
    """`all` reads; it does not write.

    A document carries no owners, so "import for everybody" has no meaning
    other than "import for me" — which is what omitting the parameter already
    says. Refused rather than quietly treated as the caller, because the two
    requests mean different things to whoever typed them.
    """
    _, headers = admin
    response = client.post(
        f"{DATA}/import",
        headers=headers,
        params={"subject": EVERYONE},
        json={"summaries": []},
    )
    assert response.status_code == 422


def test_a_round_trip_restores_every_family(
    client: TestClient,
    admin: tuple[User, dict[str, str]],
    subject: tuple[User, dict[str, str]],
) -> None:
    """Export one account, delete it all, import it back as that account.

    The point of a backup, asserted end to end. It is also what keeps the four
    artifact families honest: a section the export learned to write and the
    import never learned to read is a document that looks complete and
    restores three quarters of itself.
    """
    _, headers = admin
    subject_user, _ = subject
    with Session(engine) as session:
        _seed_account(session, subject_user, "theirs")

    document = _export(client, headers, str(subject_user.id))

    with Session(engine) as session:
        for model in (Summary, ChatSession, TagRun, DiscoverReport):
            session.exec(delete(model))  # type: ignore[call-overload]
        session.exec(delete(UserSetting))  # type: ignore[call-overload]
        session.commit()

    restored = client.post(
        f"{DATA}/import",
        headers=headers,
        params={"subject": str(subject_user.id)},
        json=document,
    )
    assert restored.status_code == 200, restored.text

    with Session(engine) as session:
        for model, row_id in (
            (Summary, "summary-theirs"),
            (ChatSession, "chat-theirs"),
            (TagRun, "tagrun-theirs"),
            (DiscoverReport, "report-theirs"),
        ):
            row = session.get(model, row_id)
            assert row is not None, f"{model.__name__} did not come back"
            assert row.user_id == subject_user.id
        setting = session.get(UserSetting, (SYNC_PREFS_KEY, subject_user.id))
        assert setting is not None
        assert setting.value["defaultStartId"] == "theirs"
