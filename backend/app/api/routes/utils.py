from fastapi import APIRouter, Depends, HTTPException
from pydantic.networks import EmailStr

from app.api.deps import CurrentUser, require_permission
from app.core.config import settings
from app.core.permissions import Permission
from app.models import Message
from app.schemas.analysis_window import ServerTimeResponse
from app.services.analysis_window import current_minute_start, server_now_ms
from app.utils import generate_test_email, send_email

router = APIRouter(prefix="/utils", tags=["utils"])


@router.post(
    "/test-email/",
    dependencies=[Depends(require_permission(Permission.UTILS_ADMIN))],
    status_code=201,
)
def test_email(email_to: EmailStr) -> Message:
    """
    Test emails.
    """
    # `send_email` opens with `assert settings.emails_enabled`, so calling it
    # unconfigured raises AssertionError and the caller gets a 500 with no idea
    # why. On an endpoint whose entire purpose is checking the mail setup, that
    # is the least useful possible answer. Ticket 01 fixed the same crash on
    # password recovery; this is the sibling call site it did not reach.
    if not settings.emails_enabled:
        raise HTTPException(
            status_code=400,
            detail=(
                "Email is not configured. Set SMTP_HOST and EMAILS_FROM_EMAIL "
                "to send mail."
            ),
        )
    email_data = generate_test_email(email_to=email_to)
    send_email(
        email_to=email_to,
        subject=email_data.subject,
        html_content=email_data.html_content,
    )
    return Message(message="Test email sent")


@router.get("/health-check/")
async def health_check() -> bool:
    return True


# AW-02. A Live Analysis window resolves against the start of the *server's*
# current minute, and the browser has to draw that same window before any
# request is made — the collapsed Posts summary, the four editor fields, the
# timer that refreshes the feed on each minute boundary. Reading its own clock
# is what this ticket removed, so it reads this and keeps the difference.
#
# The estimate is for drawing only. Nothing here decides which Posts an
# operation uses: `services/analysis_window.py` resolves every Scope again at
# submission. A slow response therefore makes a label repaint late and cannot
# make a selection wrong, which is why this is a plain read rather than a
# round-trip-compensated time protocol.
#
# Mounted with the health check rather than behind the approval gate: an
# unapproved account still renders a window, and refusing it would make that
# page wrong for no security gain — the value is the wall clock. Authenticated
# all the same, because every caller that needs it already is.
#
# The reasoning above is in a comment because a handler docstring becomes the
# `openapi.json` description and a JSDoc block in the generated client, and
# none of it is a consumer's business. The one line that *is* a consumer's
# business stays a docstring on purpose, and ships as that description.
@router.get("/server-time")
def server_time(_current_user: CurrentUser) -> ServerTimeResponse:
    """The server's current time, for a client estimating its clock offset."""
    now = server_now_ms()
    return ServerTimeResponse(now=now, minuteStart=current_minute_start(now))
