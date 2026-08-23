"""Every `send_email` call site checks that mail is configured first.

`app/utils.py::send_email` opens with `assert settings.emails_enabled`, and
`.env.example` ships `SMTP_HOST=` empty, so calling it on a default deployment
raises `AssertionError` and the caller gets a bare 500.

This has now been the same bug twice. Ticket 01 found it on
`POST /password-recovery/{email}`, where it was worse than a crash: an
unregistered address returned 200 and a registered one 500, which is an account
oracle assembled out of the code written to prevent one. That fix guarded *that*
call site. `POST /utils/test-email/` — an endpoint whose entire purpose is
checking the mail setup — kept the crash and was still returning 500 in staging
afterwards.

So this guards the *set*, not the site, which is the lesson `channel_photos.py`
and `post_thumbnails.py` already taught this codebase: a fix applied to one of a
pair is half a fix, and the guard belongs on the pair.
"""

from __future__ import annotations

import ast
import pathlib

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = settings.API_V1_STR

_APP = pathlib.Path(__file__).resolve().parents[2] / "app"


def _enclosing_function(tree: ast.Module, target: ast.AST) -> ast.AST | None:
    """The function definition containing `target`, if any."""
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef) and any(
            child is target for child in ast.walk(node)
        ):
            return node
    return None


def _unguarded_send_email_calls(path: pathlib.Path) -> list[str]:
    """Calls to `send_email` whose enclosing function never mentions the flag.

    Deliberately coarse: it asks whether `emails_enabled` appears anywhere in
    the same function, not whether it dominates the call. A precise check would
    need real flow analysis, and the failure this exists to prevent is "nobody
    thought about it at all", which a mention reliably catches.
    """
    tree = ast.parse(path.read_text())
    offenders = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call)):
            continue
        func = node.func
        called = (
            func.id
            if isinstance(func, ast.Name)
            else func.attr
            if isinstance(func, ast.Attribute)
            else None
        )
        # `background.add_task(send_email, ...)` passes it as an argument
        # rather than calling it, which is exactly what the recovery route
        # does — treat that as a call site too.
        deferred = called == "add_task" and any(
            isinstance(arg, ast.Name) and arg.id == "send_email" for arg in node.args
        )
        if called != "send_email" and not deferred:
            continue
        enclosing = _enclosing_function(tree, node)
        if enclosing is None:
            offenders.append(f"{path.name}: module level")
            continue
        if "emails_enabled" not in ast.dump(enclosing):
            offenders.append(f"{path.name}::{enclosing.name}")  # type: ignore[attr-defined]
    return offenders


def test_there_are_send_email_call_sites_to_check() -> None:
    """Otherwise the guard below passes by finding nothing."""
    found = [
        path
        for path in (_APP / "api").rglob("*.py")
        if "send_email" in path.read_text()
    ]
    assert found, "no route module calls send_email — is this guard still aimed right?"


@pytest.mark.security
def test_no_route_sends_mail_without_checking_it_is_configured() -> None:
    offenders = sorted(
        offender
        for path in (_APP / "api").rglob("*.py")
        for offender in _unguarded_send_email_calls(path)
    )
    assert not offenders, (
        "these call `send_email` without checking `settings.emails_enabled`, so "
        "they raise AssertionError and return 500 on any deployment with no "
        "SMTP host configured:\n  " + "\n  ".join(offenders)
    )


@pytest.mark.security
def test_the_test_email_route_explains_itself_instead_of_crashing(
    client: TestClient, superuser_token_headers: dict[str, str]
) -> None:
    """The behaviour, not just the source shape.

    Asserting the status code *and* that the body names the two settings, since
    the whole point of the change is that the operator learns what to fix.
    """
    response = client.post(
        f"{PREFIX}/utils/test-email/?email_to=nobody-here@example.com",
        headers=superuser_token_headers,
    )
    assert response.status_code == 400, response.status_code
    detail = response.json()["detail"]
    assert "SMTP_HOST" in detail and "EMAILS_FROM_EMAIL" in detail, detail
