from datetime import UTC, datetime, timedelta
from typing import Any

import jwt
from pwdlib import PasswordHash
from pwdlib.hashers.argon2 import Argon2Hasher
from pwdlib.hashers.bcrypt import BcryptHasher

from app.core.config import settings

password_hash = PasswordHash(
    (
        Argon2Hasher(),
        BcryptHasher(),
    )
)


ALGORITHM = "HS256"


def create_access_token(subject: str | Any, expires_delta: timedelta) -> str:
    expire = datetime.now(UTC) + expires_delta
    to_encode = {"exp": expire, "sub": str(subject)}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


#: The mode a View-as session runs in. `read_only` is the whole of ticket 26;
#: ticket 27 adds an elevated one, which is why this is a string rather than a
#: boolean — a second answer to "what may this session do" would have to be a
#: second field, and two fields that must agree eventually do not.
VIEW_AS_READ_ONLY = "read_only"


def create_view_as_token(
    *,
    subject_id: str | Any,
    subject_email: str,
    actor_id: str | Any,
    actor_email: str,
    expires_delta: timedelta,
    mode: str = VIEW_AS_READ_ONLY,
) -> str:
    """Mint the token that *is* a View-as session (ticket 26).

    `sub` is the **target**, not the Owner, and that is the design rather than a
    shortcut. Every read path in this application already answers for `sub` —
    the tenancy seam, the follow scoping, the browser's storage namespace — so
    putting the target there makes "looks at the app exactly as that User sees
    it" true of routes nobody remembered to think about. Putting the Owner there
    and passing the target alongside would mean auditing ~40 read paths for a
    second identity, which is the shape of change that is 95% done for a year.

    `act` is the acting Owner, named after RFC 8693's actor claim. It is what
    makes the session distinguishable from an ordinary one, and every guard
    downstream keys on its presence rather than on `mode` — an unrecognised
    mode must not read as "not a View-as session".

    The two email claims are carried so the ribbon can name the account without
    a request: the spec's decision is that the ribbon is driven by a claim,
    which is what lets it survive a reload with no state of its own.

    The audit row's id is deliberately **not** a claim. It would be the obvious
    thing to carry, and nothing would read it: the row is written before the
    token is minted and read long afterwards by an auditor, never during a
    request. Ticket 27 may need the link when an elevation has to name the
    read-only session it grew out of, and that is the ticket that should add it,
    with the reader that makes it mean something.

    Every argument is keyword-only. `subject_id`/`actor_id` and
    `subject_email`/`actor_email` are the same types in the same order, so a
    transposed positional call would compile, pass, and record the Owner as
    having been viewed by the target.
    """
    expire = datetime.now(UTC) + expires_delta
    to_encode = {
        "exp": expire,
        "sub": str(subject_id),
        "sub_email": subject_email,
        "act": str(actor_id),
        "act_email": actor_email,
        "mode": mode,
    }
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)


def verify_password(
    plain_password: str, hashed_password: str
) -> tuple[bool, str | None]:
    return password_hash.verify_and_update(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return password_hash.hash(password)
