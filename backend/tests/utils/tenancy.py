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
