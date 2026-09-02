from collections.abc import Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jwt.exceptions import InvalidTokenError
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.core.permissions import Permission
from app.models import TokenPayload, User
from app.services import rbac

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token"
)


def get_db() -> Generator[Session]:
    with Session(engine) as session:
        yield session


SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]


#: Methods that cannot change anything by definition. A View-as session may use
#: these freely; everything else has to argue for itself below.
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})

#: Mutating operations that do not mutate, each with the reason.
#:
#: Refusing every non-safe method is the simple rule, and on its own it is the
#: wrong one here: five routes in this API are **reads expressed as POST**,
#: purely so the channel selection travels in the body rather than overflowing a
#: request line — every one of them says so in its own docstring. Refusing them
#: would leave a View-as session unable to open the Posts tab, which is the
#: screen a reported problem is usually about.
#:
#: This is an inventory rather than a handful of special cases, and
#: `tests/api/test_view_as.py` is what makes that true: it walks every mutating
#: operation the app mounts and fails on one that is neither refused nor named
#: here. A route added next quarter cannot join the API without somebody
#: answering "does this write?" — which is the one moment that question is
#: cheap.
#:
#: The bar is deliberately narrow: reads a row, writes none, reaches no external
#: service, spends no Budget. `POST /rag/search` is *not* here although it looks
#: like a read — it calls an embedding provider, which costs the deployment
#: money and leaves a log row behind.
VIEW_AS_READ_ONLY_PATHS: dict[str, str] = {
    f"{settings.API_V1_STR}/data/posts": (
        "one page of the feed; POST only because the channel selection can be "
        "the whole account and travels in the body"
    ),
    f"{settings.API_V1_STR}/data/posts/counts": (
        "a GROUP BY over the same scope, for the same reason"
    ),
    f"{settings.API_V1_STR}/data/posts/lookup": (
        "resolves (channel, post id) pairs a Summary cites"
    ),
    f"{settings.API_V1_STR}/data/discover/candidates": (
        "aggregated counts over a scope; the report that *stores* an answer is "
        "POST /data/discover/reports, which is refused"
    ),
    f"{settings.API_V1_STR}/login/test-token": (
        "echoes the caller back; the app uses it to confirm who it is acting as"
    ),
}

#: What a refused write says. One string, so the browser can recognise it and
#: explain rather than showing a bare permission error on a button click.
VIEW_AS_READ_ONLY_DETAIL = "This View-as session is read-only"

#: The target was deleted mid-session (ticket 26's last checkbox).
#:
#: **Deliberately not `"User not found"`.** `api/base.ts::isAuthFailure` reads
#: that exact string as a dead session and hard-navigates to `/login`, which
#: would sign the *Owner* out over something that happened to somebody else's
#: account — the opposite of "returns the Owner to their own account".
VIEW_AS_TARGET_MISSING_DETAIL = "Viewed account no longer exists"

#: The target was disabled mid-session. A separate string because they are
#: separate facts and the Owner is the person who has to act on the difference;
#: the browser treats both the same way, which is what `VIEW_AS_ENDED_DETAILS`
#: is for.
VIEW_AS_TARGET_INACTIVE_DETAIL = "Viewed account has been disabled"

#: Every way a View-as session can end because of the account it was watching.
#: Mirrored in `frontend/src/lib/storage/scoped.ts`; both are asserted.
VIEW_AS_ENDED_DETAILS = frozenset(
    {VIEW_AS_TARGET_MISSING_DETAIL, VIEW_AS_TARGET_INACTIVE_DETAIL}
)


def view_as_allows(method: str, path: str) -> bool:
    """Whether a read-only View-as session may make this request.

    The one function that answers it, for the reason `tenancy.tenancy_enforced`
    is the one reader of its flag: the failure mode of a rule like this is
    always the second place it got asked, and the two spellings disagreeing is
    how a write gets through while every test still passes.

    Matched on the **raw path**, not on a route template, because that is what
    exists here — and because every allowlisted path is literal, with no
    parameters for the two to disagree about. A missing trailing slash is
    treated as the path that has one, the same tolerance `is_public_path` needs
    and for the same reason: the router's redirect never runs if this has
    already refused.
    """
    if method.upper() in SAFE_METHODS:
        return True
    return path in VIEW_AS_READ_ONLY_PATHS or f"{path}/" in VIEW_AS_READ_ONLY_PATHS


def get_current_user(request: Request, session: SessionDep, token: TokenDep) -> User:
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except InvalidTokenError, ValidationError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
        )

    # A View-as session (ticket 26). `sub` is the account being looked at, so
    # everything below this point — and every read path downstream — answers for
    # the target with no code of its own. `act` names the Owner doing the
    # looking, and its *presence* is what makes this a View-as session; `mode`
    # says what the session may do, and ticket 27 is what widens it.
    #
    # **The refusal lives here and nowhere else.** Every authenticated route in
    # this application resolves its caller through this function, so one gate
    # covers all of them. A middleware would be a second gate that has to be
    # kept in step with this one, which is exactly the drift that left
    # `/password-recovery` unreachable for months.
    is_view_as = token_data.act is not None
    if is_view_as and not view_as_allows(request.method, request.url.path):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=VIEW_AS_READ_ONLY_DETAIL,
        )

    user = session.get(User, token_data.sub)
    if not user:
        if is_view_as:
            # 404 rather than 401, and its own detail: the Owner's session is
            # perfectly good, it is the account they were watching that is gone.
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=VIEW_AS_TARGET_MISSING_DETAIL,
            )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not user.is_active:
        if is_view_as:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=VIEW_AS_TARGET_INACTIVE_DETAIL,
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


#: The `detail` an unapproved account gets. A distinct string, not the generic
#: privileges message, because the frontend routes on it: "you are waiting" and
#: "you may not do this" are different states and only one of them resolves by
#: someone else clicking a button.
PENDING_APPROVAL_DETAIL = "Account is awaiting administrator approval"


def require_approved_user(current_user: CurrentUser) -> User:
    """Refuse an account that has not been approved yet.

    Mounted on whole routers in `app/api/main.py` rather than on ~90 individual
    routes — being unapproved is a property of the *session*, not of any one
    endpoint, and a rule applied per route is a rule someone forgets on the
    ninety-first. `users`, `login` and `utils` deliberately do not carry it, so
    a pending person can still read `/users/me` (which is how the app knows to
    show them the pending page) and sign out.
    """
    if not current_user.is_approved:
        raise HTTPException(status_code=403, detail=PENDING_APPROVAL_DETAIL)
    return current_user


class require_permission:  # noqa: N801 — reads as a dependency at call sites
    """A route dependency that demands one named permission.

    A callable object rather than a function, because a dependency that takes an
    argument has to be *built* per call site, and FastAPI reads the signature of
    `__call__` for an instance exactly as it reads a function's. Used as::

        @router.get(
            "/",
            dependencies=[Depends(require_permission(Permission.USERS_READ))],
        )

    Naming the *permission* rather than a role is the whole point of ticket 07:
    a fourth role becomes a row in `rbac_roles`, and no call site here changes.

    Taking `CurrentUser` is not incidental: deciding whether *you* hold a
    permission requires resolving who you are, so `get_current_user` always sits
    beneath one of these. `test_public_route_exemptions.py` relies on that to
    tell an authenticated route from a deliberately public one, and asserts it
    rather than assuming it.
    """

    def __init__(self, permission: Permission) -> None:
        self.required_permission = permission

    def __call__(self, session: SessionDep, current_user: CurrentUser) -> User:
        if not rbac.has_permission(session, current_user.id, self.required_permission):
            # Says nothing about which permission was missing, deliberately: the
            # caller cannot act on that, and it maps out the authorisation model
            # for anyone probing. Same text the template's superuser check used.
            raise HTTPException(
                status_code=403, detail="The user doesn't have enough privileges"
            )
        return current_user
