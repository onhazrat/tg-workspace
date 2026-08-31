"""A caller id for tests that read through the tenancy seam but are not about it.

Ticket 16 made `user_id` a required argument on `list_feed`, `lookup_posts`,
`count_posts_in_scope` and `compute_discover_candidates`. Tests covering
filters, caps, sort orders or report shapes still have to pass one.

A fixed constant rather than a fresh `uuid4()` per call site, for two reasons: a
failure prints the same id every run, and a test that *does* come to depend on
the value has to reach for something other than the name `ANY_READER` to get it.

## It is a real account now, and that changed for a reason

Its docstring used to say "not a real account", and that was true and cheap
while `TENANCY_ENFORCED` was off and `user_id` was a nullable column nothing
constrained. Ticket 21 ended both halves:

* **PR 3 adds a cascading foreign key to `"user"(id)`.** A fabricated uuid stops
  being merely meaningless and starts being *rejected* — 118 `ForeignKeyViolation`
  failures across the suite the first time the constraint went on.
* **PR 4 flips the flag.** A scoped read for an account that does not exist
  returns nothing, so 113 assertions would have gone green-to-empty and the
  tests would have passed for the wrong reason on the way to failing.

So `any_reader_account` seeds the row, autouse and session-scoped, and the
constant keeps its name and its value. Tests that assert *on scoping* still
build their own Users and Follows — see `test_post_tenancy_scoping.py`. Do not
reach for this constant there: it now names an account with no follows, so a
scoped read finds nothing for it and the test would still pass for the wrong
reason, just a different wrong reason than before.
"""

from __future__ import annotations

import uuid
from collections.abc import Iterator

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.models import User

#: Readable in a failure message as "ticket 16's any-user".
ANY_READER = uuid.UUID("00000000-0000-0000-0000-000000000016")

#: Deterministic, and named so a failure printing it is obviously a fixture
#: rather than somebody's account. It has to be a *deliverable* address —
#: `UserPublic.email` is an `EmailStr`, and `email-validator` refuses the
#: reserved TLDs, so the obvious `@tests.invalid` made `GET /users/` fail to
#: serialise the moment this account joined the table.
ANY_READER_EMAIL = "any-reader-ticket16@tenancy-fixture.com"


@pytest.fixture(scope="session", autouse=True)
def any_reader_account() -> Iterator[None]:
    """Give `ANY_READER` a real row, once per run.

    Autouse because the constant is imported directly by thirteen modules and
    read inside helper functions rather than requested as a fixture — making
    every one of those ask for this by name would be a hundred-odd edits to say
    something that is true for the whole suite.

    Session-scoped and left in place: `_clean_tg_tables_after_test` truncates
    `tg_*` and never `"user"`, so the row survives between tests, and the
    session-scoped `db` fixture clears the user table at the end of the run.
    """
    with Session(engine) as session:
        existing = session.exec(select(User).where(User.id == ANY_READER)).first()
        if existing is None:
            session.add(
                User(
                    id=ANY_READER,
                    email=ANY_READER_EMAIL,
                    hashed_password="not-a-real-hash",
                    is_active=True,
                    is_superuser=False,
                )
            )
            session.commit()
    yield


def follow_channels(
    session: Session,
    *channel_names: str,
    user_id: uuid.UUID | None = None,
) -> None:
    """Give an account a Channel and a Follow for each name, so it can read them.

    Ticket 21 PR 4 flips `TENANCY_ENFORCED`, and `Post` is `FOLLOW_SCOPED` — a
    scoped read correlates an `EXISTS` against `tg_channel_follows` on
    `channel_name`. So a test that seeds bare `Post` rows, or posts them through
    `POST /data/posts/bulk`, writes rows **no account can see**: there is no
    Channel and no follow, and the EXISTS finds nothing.

    That is the seam working rather than a bug in it. The corpus is shared and
    reachable through a follow; posts belonging to a handle nobody follows are
    exactly the rows ticket 05 made retention collect. What these tests were
    asserting was pre-tenancy behaviour, and this is what says so out loud
    instead of leaving thirty files quietly reading an empty list.

    **The owner defaults to the operator, not to `ANY_READER`.** The failing
    tests are overwhelmingly API tests reading as `FIRST_SUPERUSER` through the
    test client, and a follow owned by the any-reader account would leave them
    exactly as invisible as no follow at all — passing for a new wrong reason.
    Service tests that read as `ANY_READER` pass it explicitly.

    An existing Channel is left alone: several callers seed one with fields they
    then assert on, and overwriting it here would make this helper the thing
    that broke them.
    """
    from app.models_tg import Channel
    from app.services.channel_setting_groups import ensure_default_group
    from app.services.follows import ensure_follow_for_channel, get_operator_user_id

    owner = user_id or get_operator_user_id(session) or ANY_READER
    group = ensure_default_group(session, user_id=owner)
    session.flush()
    for name in channel_names:
        channel = session.get(Channel, name)
        if channel is None:
            channel = Channel(id=name, name=name)
            session.add(channel)
            session.flush()
        # The group goes on the follow since ticket 22 — the Channel no longer
        # names one, so a follow written without it resolves to no group and
        # every scheduler-facing test would skip the channel it just seeded.
        ensure_follow_for_channel(
            session,
            channel,
            user_id=owner,
            values={"setting_group_id": group.id},
        )
    session.commit()
