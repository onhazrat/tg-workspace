import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import col, func, select

from app import crud
from app.api.deps import (
    CurrentUser,
    SessionDep,
    require_permission,
)
from app.core.config import settings
from app.core.permissions import Permission
from app.core.security import get_password_hash, verify_password
from app.models import (
    Message,
    UpdatePassword,
    User,
    UserCreate,
    UserPublic,
    UserRegister,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)
from app.services import rbac
from app.services.channel_setting_groups import release_groups_of_deleted_account
from app.utils import generate_new_account_email, send_email

router = APIRouter(prefix="/users", tags=["users"])

#: The one reply `POST /signup` gives, whatever the address. Named rather than
#: inlined so a test asserting "known and unknown are identical" cannot pass by
#: comparing two copies of a string that drifted from the route.
REGISTRATION_RECEIVED = (
    "Registration received. If approval is required, an administrator will "
    "review your account."
)


@router.get(
    "/",
    dependencies=[Depends(require_permission(Permission.USERS_READ))],
    response_model=UsersPublic,
)
def read_users(session: SessionDep, skip: int = 0, limit: int = 100) -> Any:
    """
    Retrieve users.
    """

    count_statement = select(func.count()).select_from(User)
    count = session.exec(count_statement).one()

    statement = (
        select(User).order_by(col(User.created_at).desc()).offset(skip).limit(limit)
    )
    users = session.exec(statement).all()

    users_public = [UserPublic.model_validate(user) for user in users]
    return UsersPublic(data=users_public, count=count)


@router.post(
    "/",
    dependencies=[Depends(require_permission(Permission.USERS_MANAGE))],
    response_model=UserPublic,
)
def create_user(*, session: SessionDep, user_in: UserCreate) -> Any:
    """
    Create new user.
    """
    user = crud.get_user_by_email(session=session, email=user_in.email)
    if user:
        raise HTTPException(
            status_code=400,
            detail="The user with this email already exists in the system.",
        )

    user = crud.create_user(session=session, user_create=user_in)
    if settings.emails_enabled and user_in.email:
        email_data = generate_new_account_email(
            email_to=user_in.email, username=user_in.email, password=user_in.password
        )
        send_email(
            email_to=user_in.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return user


@router.patch("/me", response_model=UserPublic)
def update_user_me(
    *, session: SessionDep, user_in: UserUpdateMe, current_user: CurrentUser
) -> Any:
    """
    Update own user.
    """

    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != current_user.id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )
    user_data = user_in.model_dump(exclude_unset=True)
    current_user.sqlmodel_update(user_data)
    session.add(current_user)
    session.commit()
    session.refresh(current_user)
    return current_user


@router.patch("/me/password", response_model=Message)
def update_password_me(
    *, session: SessionDep, body: UpdatePassword, current_user: CurrentUser
) -> Any:
    """
    Update own password.
    """
    verified, _ = verify_password(body.current_password, current_user.hashed_password)
    if not verified:
        raise HTTPException(status_code=400, detail="Incorrect password")
    if body.current_password == body.new_password:
        raise HTTPException(
            status_code=400, detail="New password cannot be the same as the current one"
        )
    hashed_password = get_password_hash(body.new_password)
    current_user.hashed_password = hashed_password
    session.add(current_user)
    session.commit()
    return Message(message="Password updated successfully")


@router.get("/me", response_model=UserPublic)
def read_user_me(current_user: CurrentUser) -> Any:
    """
    Get current user.
    """
    return current_user


@router.delete("/me", response_model=Message)
def delete_user_me(session: SessionDep, current_user: CurrentUser) -> Any:
    """
    Delete own user.
    """
    # Phrased as "can you manage accounts", not "are you a superuser": the
    # reason this is refused is that the account is one of the few that can
    # restore access, and that is exactly what the permission names.
    if rbac.has_permission(session, current_user.id, Permission.USERS_MANAGE):
        raise HTTPException(
            status_code=403,
            detail="Account administrators are not allowed to delete themselves",
        )
    # Before the delete, not after: ticket 21's cascading key takes this
    # account's setting groups with it, and the two columns that name a group by
    # id have no key of their own. See `release_groups_of_deleted_account` — a
    # Channel another account still follows would otherwise answer 500.
    release_groups_of_deleted_account(session, current_user.id)
    session.delete(current_user)
    session.commit()
    return Message(message="User deleted successfully")


# Answers the same way for every address, which is why it returns a message
# rather than the created account. It used to reply 400 "already exists" for a
# registered address and 200 for an unregistered one — an account oracle anyone
# could walk an address list through, and the exact leak ticket 01 closed one
# route over on password recovery. Returning the User here would reopen it by
# construction, since a body containing an id is a body that only exists when
# the account was really created.
#
# The cost is real and accepted: someone who mistypes an address they already
# own gets no hint, and finds out when their password does not work. The edge
# rate limit (compose.yml) is what keeps that from being a cheap oracle to probe
# by timing instead.
@router.post("/signup", response_model=Message, status_code=202)
def register_user(session: SessionDep, user_in: UserRegister) -> Any:
    """
    Create new user without the need to be logged in.
    """
    if not settings.USERS_OPEN_REGISTRATION:
        raise HTTPException(status_code=403, detail="Open registration is disabled")

    existing = crud.get_user_by_email(session=session, email=user_in.email)
    if existing is None:
        user_create = UserCreate.model_validate(
            user_in,
            # An Admin creating an account vouches for it; a stranger signing up
            # does not, so only this path can land unapproved.
            update={"is_approved": not settings.USERS_REQUIRE_APPROVAL},
        )
        crud.create_user(session=session, user_create=user_create)

    return Message(message=REGISTRATION_RECEIVED)


@router.get("/{user_id}", response_model=UserPublic)
def read_user_by_id(
    user_id: uuid.UUID, session: SessionDep, current_user: CurrentUser
) -> Any:
    """
    Get a specific user by id.
    """
    user = session.get(User, user_id)
    if user == current_user:
        return user
    if not rbac.has_permission(session, current_user.id, Permission.USERS_READ):
        raise HTTPException(
            status_code=403,
            detail="The user doesn't have enough privileges",
        )
    if user is None:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.patch(
    "/{user_id}",
    dependencies=[Depends(require_permission(Permission.USERS_MANAGE))],
    response_model=UserPublic,
)
def update_user(
    *,
    session: SessionDep,
    user_id: uuid.UUID,
    user_in: UserUpdate,
) -> Any:
    """
    Update a user.
    """

    db_user = session.get(User, user_id)
    if not db_user:
        raise HTTPException(
            status_code=404,
            detail="The user with this id does not exist in the system",
        )
    if user_in.email:
        existing_user = crud.get_user_by_email(session=session, email=user_in.email)
        if existing_user and existing_user.id != user_id:
            raise HTTPException(
                status_code=409, detail="User with this email already exists"
            )

    db_user = crud.update_user(session=session, db_user=db_user, user_in=user_in)
    return db_user


@router.delete(
    "/{user_id}",
    dependencies=[Depends(require_permission(Permission.USERS_MANAGE))],
)
def delete_user(
    session: SessionDep, current_user: CurrentUser, user_id: uuid.UUID
) -> Message:
    """
    Delete a user.
    """
    user = session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user == current_user:
        # Reaching this route already required USERS_MANAGE, so anyone here is
        # an account administrator; the old "Super users" wording named a role
        # that authorisation no longer consults.
        raise HTTPException(
            status_code=403,
            detail="Account administrators are not allowed to delete themselves",
        )
    # See `delete_user_me`: the same repoint, because the same cascade runs.
    release_groups_of_deleted_account(session, user_id)
    session.delete(user)
    session.commit()
    return Message(message="User deleted successfully")
