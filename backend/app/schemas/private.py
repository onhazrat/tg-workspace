"""Request models for the `local`-only `/private` routes.

`app/api/main.py` mounts this router solely when `ENVIRONMENT == "local"`, so
nothing here reaches a deployed surface. It lives in `schemas/` anyway, because
the rule `tests/api/test_route_module_hygiene.py` enforces is about *where
models live*, and a rule with a "except when it doesn't matter" clause is a rule
that stops being applied.
"""

from __future__ import annotations

from pydantic import BaseModel


class PrivateUserCreate(BaseModel):
    """Create a user directly, bypassing signup — e2e fixtures only."""

    email: str
    password: str
    full_name: str
    is_verified: bool = False
