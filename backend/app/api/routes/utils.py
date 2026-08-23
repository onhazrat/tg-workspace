from fastapi import APIRouter, Depends, HTTPException
from pydantic.networks import EmailStr

from app.api.deps import require_permission
from app.core.config import settings
from app.core.permissions import Permission
from app.models import Message
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
