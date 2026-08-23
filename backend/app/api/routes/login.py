import logging
from datetime import timedelta
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.security import OAuth2PasswordRequestForm

from app import crud
from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.core import security
from app.core.config import settings
from app.models import Message, NewPassword, Token, UserPublic, UserUpdate
from app.utils import (
    generate_password_reset_token,
    generate_reset_password_email,
    send_email,
    verify_password_reset_token,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["login"])


@router.post("/login/access-token")
def login_access_token(
    session: SessionDep, form_data: Annotated[OAuth2PasswordRequestForm, Depends()]
) -> Token:
    """
    OAuth2 compatible token login, get an access token for future requests
    """
    user = crud.authenticate(
        session=session, email=form_data.username, password=form_data.password
    )
    if not user:
        raise HTTPException(status_code=400, detail="Incorrect email or password")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    return Token(
        access_token=security.create_access_token(
            user.id, expires_delta=access_token_expires
        )
    )


@router.post("/login/test-token", response_model=UserPublic)
def test_token(current_user: CurrentUser) -> Any:
    """
    Test access token
    """
    return current_user


# Three things have to hold for the response to be the same for every address,
# and only the first is obvious. Kept as a comment rather than a docstring
# because FastAPI publishes the docstring as the endpoint's OpenAPI description,
# and this reasoning is for whoever edits the handler, not for its callers.
#
# 1. The **body** is one fixed string, whether or not the address has an account.
# 2. Mail is only attempted when it is configured. `send_email` opens with
#    `assert settings.emails_enabled` and `.env.example` ships `SMTP_HOST=`
#    empty, so without that check an unregistered address got 200 and a
#    registered one got 500 — the uniform message, undone by the line that sent
#    it.
# 3. The **latency** does not give it away either. An SMTP send costs hundreds
#    of milliseconds to seconds, so sending inline would make a registered
#    address measurably slower to answer — the same oracle read with a
#    stopwatch. It runs after the response for that reason, and because on a
#    single-worker deployment an inline send lets an anonymous caller pin a
#    threadpool worker per request.
@router.post("/password-recovery/{email}")
def recover_password(
    email: str, session: SessionDep, background: BackgroundTasks
) -> Message:
    """Request a password reset link."""
    user = crud.get_user_by_email(session=session, email=email)

    if not settings.emails_enabled:
        # Deliberately not conditioned on whether the address exists: this line
        # is for the operator who set SMTP_HOST and forgot EMAILS_FROM_EMAIL and
        # would otherwise see a cheerful 200 forever with no mail ever sent. It
        # must not become a log-side account oracle.
        logger.warning(
            "Password recovery requested but mail is not configured; no email sent"
        )
    elif user:
        password_reset_token = generate_password_reset_token(email=email)
        email_data = generate_reset_password_email(
            email_to=user.email, email=email, token=password_reset_token
        )
        background.add_task(
            send_email,
            email_to=user.email,
            subject=email_data.subject,
            html_content=email_data.html_content,
        )
    return Message(
        message="If that email is registered, we sent a password recovery link"
    )


@router.post("/reset-password/")
def reset_password(session: SessionDep, body: NewPassword) -> Message:
    """
    Reset password
    """
    email = verify_password_reset_token(token=body.token)
    if not email:
        raise HTTPException(status_code=400, detail="Invalid token")
    user = crud.get_user_by_email(session=session, email=email)
    if not user:
        # Don't reveal that the user doesn't exist - use same error as invalid token
        raise HTTPException(status_code=400, detail="Invalid token")
    elif not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    user_in_update = UserUpdate(password=body.new_password)
    crud.update_user(
        session=session,
        db_user=user,
        user_in=user_in_update,
    )
    return Message(message="Password updated successfully")


@router.post(
    "/password-recovery-html-content/{email}",
    dependencies=[Depends(get_current_active_superuser)],
    response_class=HTMLResponse,
)
def recover_password_html_content(email: str, session: SessionDep) -> Any:
    """
    HTML Content for Password Recovery
    """
    user = crud.get_user_by_email(session=session, email=email)

    if not user:
        raise HTTPException(
            status_code=404,
            detail="The user with this username does not exist in the system.",
        )
    password_reset_token = generate_password_reset_token(email=email)
    email_data = generate_reset_password_email(
        email_to=user.email, email=email, token=password_reset_token
    )

    return HTMLResponse(
        content=email_data.html_content, headers={"subject:": email_data.subject}
    )
