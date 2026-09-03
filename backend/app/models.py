import uuid
from datetime import UTC, datetime

from pydantic import EmailStr
from sqlalchemy import DateTime
from sqlmodel import Field, SQLModel


def get_datetime_utc() -> datetime:
    return datetime.now(UTC)


# Shared properties
class UserBase(SQLModel):
    email: EmailStr = Field(unique=True, index=True, max_length=255)
    is_active: bool = True
    is_superuser: bool = False
    # Distinct from `is_active` on purpose: "has never been approved" and "an
    # Admin turned this account off" are different states, and the admin screen
    # has to tell them apart. Defaults to approved so that turning on
    # required-approval later cannot retroactively lock out existing accounts.
    # Ticket 07 only makes the flag exist; ticket 25 is what enforces it.
    is_approved: bool = True
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on creation
class UserCreate(UserBase):
    password: str = Field(min_length=8, max_length=128)


class UserRegister(SQLModel):
    email: EmailStr = Field(max_length=255)
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=255)


# Properties to receive via API on update, all are optional
class UserUpdate(SQLModel):
    email: EmailStr | None = Field(default=None, max_length=255)
    is_active: bool | None = None
    is_superuser: bool | None = None
    # Approve and un-approve. Separate from `is_active` because disabling an
    # account an Admin already vetted, and never having vetted it, are different
    # things — and only one of them is resolved by someone clicking approve.
    is_approved: bool | None = None
    full_name: str | None = Field(default=None, max_length=255)
    password: str | None = Field(default=None, min_length=8, max_length=128)


class UserUpdateMe(SQLModel):
    full_name: str | None = Field(default=None, max_length=255)
    email: EmailStr | None = Field(default=None, max_length=255)


class UpdatePassword(SQLModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


# Database model, database table inferred from class name
class User(UserBase, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    hashed_password: str
    created_at: datetime | None = Field(
        default_factory=get_datetime_utc,
        sa_type=DateTime(timezone=True),  # type: ignore
    )


# Properties to return via API, id is always required
class UserPublic(UserBase):
    id: uuid.UUID
    created_at: datetime | None = None


class UsersPublic(SQLModel):
    data: list[UserPublic]
    count: int


# Generic message
class Message(SQLModel):
    message: str


# JSON payload containing access token
class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"


# Contents of JWT token
class TokenPayload(SQLModel):
    sub: str | None = None

    # The View-as claims (ticket 26). All optional, because an ordinary token
    # carries none of them, and `act` alone decides whether this is a View-as
    # session: `mode` is what the session may *do*, and an unrecognised value
    # there must not read as "not a View-as session at all".
    #
    # `sub` is the account being viewed — see `security.create_view_as_token`
    # for why the target rather than the Owner sits in the standard claim.
    act: str | None = None
    act_email: str | None = None
    sub_email: str | None = None
    #: `read_only` or `elevated` (`security.VIEW_AS_MODES`). Read only to widen
    #: what the session may do — never to decide whether it *is* one, which is
    #: `act`'s job, so an unrecognised value falls through to the narrowest
    #: behaviour instead of to no gate at all.
    mode: str | None = None


class NewPassword(SQLModel):
    token: str
    new_password: str = Field(min_length=8, max_length=128)
