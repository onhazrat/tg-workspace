from collections.abc import Generator
from typing import Annotated

import jwt
from fastapi import Depends, HTTPException, status
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


def get_current_user(session: SessionDep, token: TokenDep) -> User:
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
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )
    if not user.is_active:
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
