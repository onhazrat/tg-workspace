"""`POST /password-recovery/{email}` answers identically for any address.

The handler already returned one uniform message for both cases, and then
defeated itself: it called `send_email` unconditionally, and `send_email` opens
with `assert settings.emails_enabled`. Ship the documented `SMTP_HOST=` (empty,
as `.env.example` does) and an unknown address returned 200 while a registered
one raised — a clean account oracle built out of the code written to prevent
one.
"""

from __future__ import annotations

from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api.routes import login as login_route
from app.core.config import settings

PREFIX = settings.API_V1_STR

UNKNOWN = "definitely-not-registered@example.com"


@pytest.fixture
def mail_unconfigured(monkeypatch: pytest.MonkeyPatch) -> None:
    """The shipped default: no SMTP host, so `emails_enabled` is False."""
    monkeypatch.setattr(login_route.settings, "SMTP_HOST", "")


@pytest.fixture
def sent_mail(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture what would have gone out, without an SMTP server."""
    captured: list[dict[str, Any]] = []
    monkeypatch.setattr(
        login_route,
        "send_email",
        lambda **kwargs: captured.append(kwargs),
    )
    return captured


@pytest.mark.security
def test_known_and_unknown_addresses_are_indistinguishable_without_mail(
    client: TestClient, mail_unconfigured: None
) -> None:
    known = client.post(f"{PREFIX}/password-recovery/{settings.FIRST_SUPERUSER}")
    unknown = client.post(f"{PREFIX}/password-recovery/{UNKNOWN}")

    assert known.status_code == 200
    assert unknown.status_code == 200
    assert known.json() == unknown.json()


@pytest.mark.security
def test_no_mail_is_attempted_when_mail_is_unconfigured(
    client: TestClient, mail_unconfigured: None, sent_mail: list[dict[str, Any]]
) -> None:
    client.post(f"{PREFIX}/password-recovery/{settings.FIRST_SUPERUSER}")
    assert sent_mail == []


@pytest.mark.parametrize("email", [UNKNOWN, settings.FIRST_SUPERUSER])
def test_unconfigured_mail_is_reported_to_the_operator(
    client: TestClient,
    mail_unconfigured: None,
    caplog: pytest.LogCaptureFixture,
    email: str,
) -> None:
    """A cheerful 200 that sends nothing must not be silent.

    An operator who sets `SMTP_HOST` and forgets `EMAILS_FROM_EMAIL` satisfies
    neither half of `emails_enabled`, and every user would see "we sent a link"
    forever with nothing in the logs. Parametrised over both a known and an
    unknown address on purpose: the warning must not become the account oracle
    the response body was hardened against.
    """
    with caplog.at_level("WARNING"):
        client.post(f"{PREFIX}/password-recovery/{email}")

    warnings = [r.getMessage() for r in caplog.records if r.levelname == "WARNING"]
    assert any("mail is not configured" in message for message in warnings), warnings
    assert not any(email in message for message in warnings), (
        "the warning names the address, turning the log into an account oracle"
    )


@pytest.mark.security
def test_the_mail_send_happens_after_the_response(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Otherwise the latency answers the question the body refuses to.

    An inline SMTP send costs hundreds of milliseconds to seconds, so a
    registered address would return measurably slower than an unregistered one —
    the same oracle, read with a stopwatch. Asserted structurally rather than by
    timing: the handler must hand the send to `BackgroundTasks`, which runs
    after the response is written.
    """
    monkeypatch.setattr(login_route.settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(login_route.settings, "EMAILS_FROM_EMAIL", "from@example.com")

    order: list[str] = []
    monkeypatch.setattr(
        login_route, "send_email", lambda **_kwargs: order.append("sent")
    )

    response = client.post(f"{PREFIX}/password-recovery/{settings.FIRST_SUPERUSER}")
    assert response.status_code == 200

    # Deferring must not mean dropping: the mail still goes out. Whether it went
    # out *before or after* the response is the half `TestClient` cannot show —
    # it drains background tasks before returning — so the next test reads the
    # handler for that.
    assert order == ["sent"]


@pytest.mark.security
def test_the_handler_declares_the_send_as_a_background_task() -> None:
    """The half `TestClient` cannot show: that the send is *deferred*.

    `TestClient` runs background tasks before it hands the response back, so an
    inline send and a deferred one look identical through it. This reads the
    handler instead.
    """
    import ast
    import inspect
    import textwrap

    source = textwrap.dedent(inspect.getsource(login_route.recover_password))
    tree = ast.parse(source)

    deferred = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "add_task"
        and any(
            isinstance(arg, ast.Name) and arg.id == "send_email" for arg in node.args
        )
    ]
    assert deferred, (
        "`recover_password` no longer defers `send_email` to a background task; "
        "an inline SMTP send makes a registered address answer measurably slower"
    )


@pytest.mark.security
def test_a_registered_address_is_mailed_once_mail_is_configured(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    sent_mail: list[dict[str, Any]],
) -> None:
    monkeypatch.setattr(login_route.settings, "SMTP_HOST", "smtp.example.com")
    monkeypatch.setattr(login_route.settings, "EMAILS_FROM_EMAIL", "from@example.com")

    known = client.post(f"{PREFIX}/password-recovery/{settings.FIRST_SUPERUSER}")
    assert known.status_code == 200
    assert [mail["email_to"] for mail in sent_mail] == [settings.FIRST_SUPERUSER]

    sent_mail.clear()
    unknown = client.post(f"{PREFIX}/password-recovery/{UNKNOWN}")
    assert unknown.status_code == 200
    assert sent_mail == []
    assert unknown.json() == known.json()
