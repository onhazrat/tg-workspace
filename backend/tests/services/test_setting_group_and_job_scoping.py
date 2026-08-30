"""Ticket 35: the last three unaudited `USER_OWNED` reads, and the doors beside them.

Ticket 32 claimed it had closed "the last unscoped read family in `app/`" and was
wrong; its author corrected the claim in four places rather than quietly fixing
it. These are what remained: `list_setting_groups`, `load_groups_by_id` and
`_running_job_from_row`. All three are `USER_OWNED` in `SCOPES` and none went
through the seam.

Four things here are not the wiring.

**`list_setting_groups` was already narrowing on the shipping config.** It
hand-rolled `user_id == me OR user_id IS NULL`, which filters in *both* flag
states — the one thing the seam's batches are not allowed to do, and the reason
~40 other read paths could adopt the seam without any of them changing a
response. So the flag-off answer here genuinely moves: it becomes unfiltered,
deliberately, on ticket 17's precedent for `/data/artifacts`. A single-operator
deployment has one account, and the alternative leaves a fifth NULL rule for
ticket 21 to reconcile against four that already disagree with it.
`test_list_is_unfiltered_while_the_flag_is_off` is the test that catches a
hand-rolled filter reintroduced later: such a filter passes the enforced test
with full marks and fails that one.

**`load_groups_by_id` is excused rather than scoped, and the excuse is
functional.** It is a resolution map — `groups_by_id.get(channel.setting_group_id)`
at all seven call sites — for ids the caller already holds from rows it has
already been allowed to see. A second filter there cannot hide a row; it can only
blank the *policy* of a channel you legitimately follow, and three call sites read
a missing group as "skip this channel" (`auto_sync` continues, `bulk_channels`
refuses the reset, `get_group_for_channel` raises a 500). That is a channel
silently dropping out of auto-sync, which is why the seam's `unscoped_select`
escape hatch is the right tool and a bare `select()` is not: the reason has to be
written down and greppable, because an unscoped read is otherwise
indistinguishable from a forgotten one.

**The `SyncJob` fix is not only the row read.** `_running_job_from_row` was the
function the ticket named, but `get_active_sync_job_summary` prefers `_active_jobs`
and falls back to it — so scoping only the fallback leaves the in-memory path
answering across accounts, on the one process where it is populated. Guarding the
named function and leaving its caller unguarded is the `/password-recovery` shape
this repo keeps re-finding. Both halves are pinned.

**The three write doors were found by auditing the reads, and they are the
larger hole.** `update_setting_group`, `delete_setting_group` and
`bulk_assign_setting_group` each resolved a group by client-visible id with no
owner check at all, behind routes any signed-in account can reach: rename another
account's group and recompute their channels' sync schedules, delete it, or
govern your own channels by their policy row. They take `assert_owner_on_write`,
which is deliberately *not* flag-gated — so every one of those tests is
parametrised over both flag states, and a gated guard fails exactly the flag-off
half. That asymmetry is the signature of the half-fix ticket 31 names.
"""

from __future__ import annotations

import inspect
import uuid
from collections.abc import Callable
from typing import Any

import pytest
from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import Channel, ChannelFollow, ChannelSettingGroup, SyncJob
from app.services.channel_setting_groups import (
    bulk_assign_setting_group,
    delete_setting_group,
    list_setting_groups,
    load_groups_by_id,
    update_setting_group,
)
from app.services.scraper_jobs import _running_job_from_row
from tests.utils.user import create_random_user

GROUP_NOT_FOUND = "Setting group not found"


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture(autouse=True)
def _clean(session: Session) -> None:
    """Wipe the four tables before *and* after, so order never decides an answer.

    Ticket 34's review found two guards that passed only because an earlier test
    in the file happened to truncate the rows its migrations had seeded. The
    setting-group table is the same hazard here: `l4m5n6o7p8q9` and
    `n6o7p8q9r0s1` seed three global-scope presets into every database migrated
    from empty, and a test that counts groups sees them unless something has
    already removed them.
    """
    _truncate(session)
    yield
    _truncate(session)


def _truncate(session: Session) -> None:
    session.exec(delete(ChannelFollow))
    session.exec(delete(SyncJob))
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
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


@pytest.fixture
def unenforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam off, rather than assuming the environment has it off.

    The off-state tests assert what the seam does *not* do, so they are the ones
    a run with `TENANCY_ENFORCED=True` set would fail — for the right reason and
    in the wrong run.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", False)


@pytest.fixture
def set_flag(monkeypatch: pytest.MonkeyPatch) -> Callable[[str], None]:
    from app.core import config

    def _set(flag_state: str) -> None:
        monkeypatch.setattr(
            config.settings, "TENANCY_ENFORCED", flag_state == "enforced"
        )

    return _set


# --------------------------------------------------------------------------
# Seeding
# --------------------------------------------------------------------------


def _group(
    session: Session,
    group_id: str,
    owner: uuid.UUID | None,
    *,
    name: str | None = None,
) -> ChannelSettingGroup:
    row = ChannelSettingGroup(id=group_id, user_id=owner, name=name or group_id)
    session.add(row)
    session.commit()
    return row


def _followed_channel(
    session: Session, channel_id: str, owner: uuid.UUID, *, group_id: str
) -> Channel:
    channel = Channel(
        id=channel_id, name=channel_id, user_id=owner, setting_group_id=group_id
    )
    session.add(channel)
    session.add(ChannelFollow(user_id=owner, channel_id=channel_id))
    session.commit()
    return channel


def _job(
    session: Session, job_id: str, owner: uuid.UUID | None, created_at: int
) -> None:
    session.add(
        SyncJob(
            id=job_id,
            user_id=owner,
            status="running",
            source="test",
            channels=[],
            created_at=created_at,
        )
    )
    session.commit()


def _ids(rows: list[dict[str, Any]]) -> set[str]:
    return {str(row["id"]) for row in rows}


# --------------------------------------------------------------------------
# list_setting_groups
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_list_hides_another_accounts_group(
    session: Session, user: User, other_user: User
) -> None:
    _group(session, "t35-mine", user.id)
    _group(session, "t35-theirs", other_user.id)

    assert "t35-theirs" not in _ids(list_setting_groups(session, user_id=user.id))


@pytest.mark.usefixtures("unenforced")
def test_list_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User
) -> None:
    """The test a hand-rolled owner filter fails.

    The old `_operator_group_scope_filter` reached the right answer under
    enforcement and the wrong one here, because it narrowed in a state where the
    seam promises not to. That is a changed response on the config this
    deployment actually ships, which is the failure the batching rule exists to
    prevent — so it is the flag-*off* assertion that earns its place, not the
    flag-on one.
    """
    _group(session, "t35-mine", user.id)
    _group(session, "t35-theirs", other_user.id)

    assert {"t35-mine", "t35-theirs"} <= _ids(
        list_setting_groups(session, user_id=user.id)
    )


@pytest.mark.usefixtures("enforced")
def test_your_own_group_still_reaches_you(session: Session, user: User) -> None:
    """The failure mode of a scoping change is a list that scopes to nothing."""
    _group(session, "t35-mine", user.id)

    assert "t35-mine" in _ids(list_setting_groups(session, user_id=user.id))


def test_list_setting_groups_takes_a_required_user_id() -> None:
    """Ticket 16's rule. It took `operator_id: uuid.UUID | None` before.

    An optional owner leaves every existing call site passing nothing and still
    passing its tests; a nullable one invites `None` to mean "the global scope",
    which is the fifth NULL rule this ticket deletes.
    """
    parameter = inspect.signature(list_setting_groups).parameters["user_id"]

    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty
    assert parameter.annotation in (uuid.UUID, "uuid.UUID")


@pytest.mark.usefixtures("enforced")
def test_a_group_your_own_channel_references_is_still_listed(
    session: Session, user: User, other_user: User
) -> None:
    """The orphan rescue, scoped through the follow rather than `Channel.user_id`.

    A channel you follow may name a group you do not own — auto-follow creates
    the Channel under whoever scraped it first. Dropping the group from the list
    leaves the channel rendering a policy the settings screen cannot show, so the
    rescue stays. It reaches the group through `scoped_select(..., Channel, ...)`,
    which is an EXISTS against the follow table: `Channel.user_id` is a "who
    scraped this first" stamp and ticket 22 drops it.
    """
    _group(session, "t35-theirs", other_user.id)
    _followed_channel(session, "t35-chan", user.id, group_id="t35-theirs")

    assert "t35-theirs" in _ids(list_setting_groups(session, user_id=user.id))


@pytest.mark.usefixtures("enforced")
def test_a_group_only_a_stranger_follows_is_not_rescued(
    session: Session, user: User, other_user: User
) -> None:
    """The mutation that makes the rescue unscoped passes every test above.

    Widening the rescue to every Channel row hands back exactly what the list
    filter just removed, and the only thing that can tell the two apart is a
    channel this account does not follow.
    """
    _group(session, "t35-theirs", other_user.id)
    _followed_channel(session, "t35-chan", other_user.id, group_id="t35-theirs")

    assert "t35-theirs" not in _ids(list_setting_groups(session, user_id=user.id))


def test_an_ownerless_group_can_no_longer_exist(session: Session) -> None:
    """Ticket 21 paid the bill this pair of tests recorded.

    Ticket 35 pinned a global preset from both sides — listed with the flag off,
    hidden under enforcement — and named the second half as ticket 21's
    precondition rather than a bug it could fix: a fresh install migrates before
    its first superuser exists, so the presets the setting-group migrations seed
    have nobody to belong to, and alembic never revisits a revision it stamped.

    PR 3 settles it at the source. Its migration merges a duplicate preset into
    the operator's own group (repointing `tg_channels` and `tg_channel_follows`
    first), adopts one with no counterpart, and drops what is left unreferenced
    on a fresh install — then makes the column `NOT NULL`. So an unowned group
    stops being hidden and starts being impossible, which is the only version of
    this that a later `upgrade head` cannot silently undo.
    """
    with pytest.raises(IntegrityError):
        _group(session, "t35-global", None)
    session.rollback()


# --------------------------------------------------------------------------
# load_groups_by_id — excused, and the excuse is written down
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_load_groups_by_id_resolves_across_accounts_on_purpose(
    session: Session, user: User, other_user: User
) -> None:
    """Scoping this is what would break, not what would fix.

    Every call site does `groups_by_id.get(channel.setting_group_id)` for a
    channel it has already been allowed to see, and three of the seven read a
    missing group as "skip this channel". A filter here therefore cannot hide a
    row from anybody; it can only stop auto-sync from syncing a channel you
    follow.
    """
    _group(session, "t35-theirs", other_user.id)

    assert "t35-theirs" in load_groups_by_id(session)


def test_load_groups_by_id_says_why_it_is_unscoped() -> None:
    """A bare `select()` and a deliberate one are indistinguishable without this.

    The seam's own argument for `unscoped_select`: the value is not what it does
    — it returns the statement untouched — but that the reason is written at the
    call site and greppable from outside it.
    """
    source = inspect.getsource(load_groups_by_id)

    assert "unscoped_select" in source
    assert "reason=" in source


def test_load_groups_by_id_does_not_take_an_owner_it_ignores() -> None:
    """An ignored parameter decays into a used one the first time somebody tidies it.

    Ticket 19 kept exactly such a parameter on `upsert_sync_log` and had to guard
    it, because a uniform importer signature required it. Nothing requires one
    here, so there is none.
    """
    assert "user_id" not in inspect.signature(load_groups_by_id).parameters


# --------------------------------------------------------------------------
# The active sync job behind GET /jobs/runtime-config
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_the_running_job_row_is_the_callers(
    session: Session, user: User, other_user: User
) -> None:
    _job(session, "t35-theirs", other_user.id, created_at=1)
    _job(session, "t35-mine", user.id, created_at=2)

    found = _running_job_from_row(user_id=user.id)

    assert found is not None
    assert found.job_id == "t35-mine"


@pytest.mark.usefixtures("enforced")
def test_another_accounts_job_is_not_reported_at_all(
    session: Session, user: User, other_user: User
) -> None:
    """Not merely outranked — absent. The oldest-first order would hide a
    half-fix that only reordered the candidates."""
    _job(session, "t35-theirs", other_user.id, created_at=1)

    assert _running_job_from_row(user_id=user.id) is None


@pytest.mark.usefixtures("unenforced")
def test_the_running_job_row_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User
) -> None:
    _job(session, "t35-theirs", other_user.id, created_at=1)

    found = _running_job_from_row(user_id=user.id)

    assert found is not None
    assert found.job_id == "t35-theirs"


def test_running_job_from_row_takes_a_required_user_id() -> None:
    parameter = inspect.signature(_running_job_from_row).parameters["user_id"]

    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty


@pytest.mark.usefixtures("enforced")
def test_the_in_memory_job_is_scoped_too(
    session: Session, user: User, other_user: User
) -> None:
    """The half-fix this ticket is most likely to ship.

    `get_active_sync_job_summary` prefers `_active_jobs` and only falls back to
    the row, so scoping the function the ticket names leaves the preferred path
    answering across accounts. On the API process `_active_jobs` is empty since
    ticket 10, which is exactly why the hole would go unnoticed there.
    """
    from app.services.scraper_jobs import (
        SyncJobState,
        _active_jobs,
        get_active_sync_job_summary,
    )

    _active_jobs["t35-theirs"] = SyncJobState(
        job_id="t35-theirs",
        source="test",
        status="running",
        user_id=str(other_user.id),
    )
    try:
        summary = get_active_sync_job_summary(allowed_concurrency=1, user_id=user.id)
    finally:
        _active_jobs.pop("t35-theirs", None)

    assert summary is None


@pytest.mark.usefixtures("unenforced")
def test_the_in_memory_job_is_unfiltered_while_the_flag_is_off(
    session: Session, user: User, other_user: User
) -> None:
    """The half `may_act_on` would have got wrong, and the guard that says so.

    The first cut filtered `_active_jobs` with `may_act_on`, which does not
    consult the flag on its non-NULL branch — so another account's job vanished
    from `activeSyncJob` on the shipping config. `test_auto_publish_scoping.py`'s
    declared-caller list caught it, which is exactly the case its error message
    describes: a read must reach the seam's rule, not the write path's.
    """
    from app.services.scraper_jobs import (
        SyncJobState,
        _active_jobs,
        get_active_sync_job_summary,
    )

    _active_jobs["t35-theirs"] = SyncJobState(
        job_id="t35-theirs",
        source="test",
        status="running",
        user_id=str(other_user.id),
    )
    try:
        summary = get_active_sync_job_summary(allowed_concurrency=1, user_id=user.id)
    finally:
        _active_jobs.pop("t35-theirs", None)

    assert summary is not None
    assert summary["jobId"] == "t35-theirs"


@pytest.mark.usefixtures("unenforced")
def test_an_ownerless_in_memory_job_is_still_reported_while_the_flag_is_off(
    session: Session, user: User
) -> None:
    """The scheduler's own jobs carry no owner, and they are the common case.

    Under enforcement they disappear, matching what the scoped row read does to
    the same rows. That is one more line on ticket 21's owner-backfill bill, not
    a decision taken here — and it is pinned so 21 finds a red test rather than
    an operator finding an empty diagnostics panel.
    """
    from app.services.scraper_jobs import (
        SyncJobState,
        _active_jobs,
        get_active_sync_job_summary,
    )

    _active_jobs["t35-auto"] = SyncJobState(
        job_id="t35-auto", source="scheduler", status="running", user_id=None
    )
    try:
        summary = get_active_sync_job_summary(allowed_concurrency=1, user_id=user.id)
    finally:
        _active_jobs.pop("t35-auto", None)

    assert summary is not None
    assert summary["jobId"] == "t35-auto"


def test_active_sync_job_summary_takes_a_required_user_id() -> None:
    from app.services.scraper_jobs import get_active_sync_job_summary

    parameter = inspect.signature(get_active_sync_job_summary).parameters["user_id"]

    assert parameter.kind is inspect.Parameter.KEYWORD_ONLY
    assert parameter.default is inspect.Parameter.empty


# --------------------------------------------------------------------------
# The three write doors — ungated, so both flag states
# --------------------------------------------------------------------------


@pytest.mark.parametrize("flag_state", ["enforced", "unenforced"])
def test_update_refuses_another_accounts_group(
    session: Session,
    user: User,
    other_user: User,
    set_flag: Callable[[str], None],
    flag_state: str,
) -> None:
    """`PUT /data/setting-groups/{id}` had no owner check of any kind.

    It renames the group *and* recomputes `next_regular_sync_at` for every
    channel in it, so a stranger could reschedule another account's syncs. Both
    flag states, because `assert_owner_on_write` is not gated: a gated guard
    passes the enforced half and fails this one on the shipping config.
    """
    set_flag(flag_state)
    _group(session, "t35-theirs", other_user.id)

    with pytest.raises(HTTPException) as excinfo:
        update_setting_group(session, "t35-theirs", {"name": "stolen"}, user_id=user.id)

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == GROUP_NOT_FOUND


@pytest.mark.parametrize("flag_state", ["enforced", "unenforced"])
def test_delete_refuses_another_accounts_group(
    session: Session,
    user: User,
    other_user: User,
    set_flag: Callable[[str], None],
    flag_state: str,
) -> None:
    set_flag(flag_state)
    _group(session, "t35-theirs", other_user.id)

    with pytest.raises(HTTPException) as excinfo:
        delete_setting_group(session, "t35-theirs", user_id=user.id)

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == GROUP_NOT_FOUND
    assert session.get(ChannelSettingGroup, "t35-theirs") is not None


@pytest.mark.parametrize("flag_state", ["enforced", "unenforced"])
def test_bulk_assign_refuses_another_accounts_group(
    session: Session,
    user: User,
    other_user: User,
    set_flag: Callable[[str], None],
    flag_state: str,
) -> None:
    """The read here is the leak, not only the write.

    `bulk_assign_setting_group` resolved the target group by id and then copied
    its `auto_sync_interval_minutes` and `dynamic_sync_expected_posts` onto the
    caller's channels — so a stranger's policy row governed your syncs, and the
    404 for a missing group made the id space walkable besides.
    """
    set_flag(flag_state)
    _group(session, "t35-mine", user.id)
    _group(session, "t35-theirs", other_user.id)
    _followed_channel(session, "t35-chan", user.id, group_id="t35-mine")

    with pytest.raises(HTTPException) as excinfo:
        bulk_assign_setting_group(
            session,
            channel_ids=["t35-chan"],
            setting_group_id="t35-theirs",
            user_id=user.id,
        )

    assert excinfo.value.status_code == 404
    assert excinfo.value.detail == GROUP_NOT_FOUND


@pytest.mark.parametrize("flag_state", ["enforced", "unenforced"])
def test_an_import_cannot_attach_a_channel_to_another_accounts_group(
    session: Session,
    user: User,
    other_user: User,
    set_flag: Callable[[str], None],
    flag_state: str,
) -> None:
    """The fourth door, and the one the ticket did not name.

    `_import_channels` resolves `setting_group_id` from the document and, before
    ticket 35, attached the caller's brand-new Channel to whatever it named — so
    a stranger's policy row governed your syncs, which is exactly
    `bulk_assign_setting_group`'s hole reached through the import.

    The refusal is a **fall-through, not a raise**: an import is one transaction,
    and aborting a whole restore over a field a document can be wrong about is
    worse than the branch that already exists for an absent group. So the
    assertion is that the channel lands on the caller's own default, not that
    anything threw.
    """
    set_flag(flag_state)
    from app.services.data_import_export import _import_channels

    _group(session, "t35-theirs", other_user.id)
    _import_channels(
        session,
        [
            {
                "id": "t35-imported",
                "name": "t35-imported",
                "settingGroupId": "t35-theirs",
            }
        ],
        user_id=user.id,
    )
    session.commit()

    channel = session.get(Channel, "t35-imported")
    assert channel is not None
    assert channel.setting_group_id != "t35-theirs"

    landed = session.get(ChannelSettingGroup, channel.setting_group_id)
    assert landed is not None
    assert landed.user_id == user.id


def test_the_write_guards_no_longer_have_an_ownerless_case(
    session: Session, user: User
) -> None:
    """The other half of the same removal, kept for the same reason.

    `assert_owner_on_write`'s one asymmetry between the flag states is the NULL
    owner: writable while enforcement is off, refused under it. Ticket 35 pinned
    both directions over `update_setting_group`. Neither is reachable through
    this table any more, so what is left worth asserting is that the guard is
    still a guard — a foreign group is refused, which
    `test_a_foreign_group_is_refused_in_both_flag_states` covers, and the row
    the asymmetry was about cannot be constructed to begin with.

    Written against the *door* rather than the model, because that is what the
    deleted tests were about: a `_group(..., None)` that the database refuses
    means `update_setting_group` never sees a NULL owner, whatever the flag says.
    """
    with pytest.raises(IntegrityError):
        _group(session, "t35-global", None)
    session.rollback()

    assert session.get(ChannelSettingGroup, "t35-global") is None


@pytest.mark.parametrize("flag_state", ["enforced", "unenforced"])
def test_your_own_group_is_still_writable(
    session: Session,
    user: User,
    set_flag: Callable[[str], None],
    flag_state: str,
) -> None:
    """The failure mode of a write guard is a door that refuses everybody."""
    set_flag(flag_state)
    _group(session, "t35-mine", user.id)

    assert (
        update_setting_group(session, "t35-mine", {"name": "renamed"}, user_id=user.id)[
            "name"
        ]
        == "renamed"
    )
    assert delete_setting_group(session, "t35-mine", user_id=user.id) == {
        "status": "deleted"
    }


def test_the_refusal_reuses_the_absent_row_detail() -> None:
    """A 404 is only half an answer; the body is the other half.

    `assert_owner`'s rule. Both branches of every door above answer the exact
    string the family already gives for a group that is not there, so "somebody
    else owns it" and "there is nothing here" stay indistinguishable — otherwise
    the enumeration oracle the 404 closes just moves into the payload.
    """
    for func in (update_setting_group, delete_setting_group, bulk_assign_setting_group):
        assert GROUP_NOT_FOUND in inspect.getsource(func)


# --------------------------------------------------------------------------
# The filter that stays, and why it is not the seam
# --------------------------------------------------------------------------


def test_no_hand_rolled_visibility_filter_survives_in_the_module() -> None:
    """`_operator_group_scope_filter` is gone; what replaced it answers identity.

    The remaining helper decides whether a *name* is taken, which mirrors the
    unique index `(COALESCE(user_id::text, 'global'), lower(name))` — that is
    which row is yours, not which rows you may see, and ticket 30's rule is that
    a flag cannot gate identity. Naming it for visibility is how the next reader
    would "adopt the seam" there and change what a duplicate name means.
    """
    from app.services import channel_setting_groups

    source = inspect.getsource(channel_setting_groups)

    assert "_operator_group_scope_filter" not in source
    assert "scoped_select" in source


@pytest.mark.usefixtures("enforced")
def test_a_duplicate_name_is_still_rejected_under_enforcement(
    session: Session, user: User
) -> None:
    """The identity helper must not start deferring to the flag.

    If the name check adopted `scoped_select` it would keep working here and
    silently stop rejecting collisions against the global-scope presets, which
    the unique index still enforces — and the failure would arrive as a 500 from
    Postgres rather than the 400 the route promises.
    """
    from app.services.channel_setting_groups import create_setting_group

    create_setting_group(session, {"name": "Reports"}, user_id=user.id)

    with pytest.raises(HTTPException) as excinfo:
        create_setting_group(session, {"name": "reports"}, user_id=user.id)

    assert excinfo.value.status_code == 409


@pytest.mark.usefixtures("enforced")
def test_the_scope_name_index_still_exists(session: Session) -> None:
    """Ticket 34's lesson, kept alive where it can still bite.

    A guard that exercises a statement's predicate says nothing about the
    constraints the statement has to satisfy. The name check above is only
    load-bearing while this index is.
    """
    found = session.exec(
        text(
            "SELECT indexdef FROM pg_indexes "
            "WHERE tablename = 'tg_channel_setting_groups'"
        )
    ).all()
    unique = [row[0] for row in found if "UNIQUE" in row[0] and "pkey" not in row[0]]

    assert unique, "the scope/name unique index is gone"
    assert all("COALESCE" in definition for definition in unique)
    assert all("lower(" in definition for definition in unique)
