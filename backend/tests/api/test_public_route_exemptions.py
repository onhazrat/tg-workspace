"""Routes with no auth dependency are exempt from the auth middleware, and vice versa.

Two independent gates decide whether a logged-out browser reaches an endpoint:
`APIKeyMiddleware`, which runs *before* routing and 401s anything it does not
recognise as public, and the route's own dependencies. Both are hand-maintained,
and they drifted. `/password-recovery/{email}` and `/reset-password/` are
declared on a prefix-less router mounted at `/api/v1`, so the middleware's
`/api/v1/login` prefix never matched them: forgot-password answered 401 in
staging and production for as long as those routes existed, and no test saw it,
because the whole suite runs with `ENVIRONMENT=local` where the middleware
short-circuits before it ever consults its public paths.

So this guard asserts the two lists agree, in **both** directions:

1. every route that declares no auth dependency is public to the middleware —
   otherwise it is dead outside `local`;
2. every path the middleware exempts is matched by such a route — otherwise the
   exemption is a hole left behind by a deleted or newly-protected endpoint.

Direction 2 is the half that would have caught the reverse mistake, and it is
why `is_public_path` is asserted through the real function rather than by
re-deriving the rule here: a guard that reimplements what it checks can only
ever agree with itself.
"""

from __future__ import annotations

import ast
import pathlib
import re

import pytest
from fastapi.routing import APIRoute
from starlette.routing import BaseRoute

from app.api.deps import get_current_user
from app.main import app
from app.middleware.api_key import (
    PUBLIC_API_PATHS,
    PUBLIC_API_PREFIXES,
    is_public_path,
)

#: Identity is enough here, and ticket 07 did not change that even though it
#: added `require_permission`, which builds a fresh object per call site. A
#: permission check has to know *who* is asking, so every one of those resolves
#: `CurrentUser` — and therefore `get_current_user` — through its own signature.
#: `test_a_permission_dependency_authenticates_first` pins that, because it is
#: the reason this one-element set is sufficient rather than a happy accident.
_AUTH_DEPENDENCIES = {get_current_user}


_PARAM = re.compile(r"\{[^}]+\}")

_ROUTER_ASSEMBLY = (
    pathlib.Path(__file__).resolve().parents[2] / "app" / "api" / "main.py"
)

# The template's unauthenticated debug router. It is exempt from the rule above
# because it is only *mounted* when `ENVIRONMENT == "local"` — the one setting
# where the middleware waves everything through — so it is not reachable
# unauthenticated anywhere the middleware is doing its job. That reasoning holds
# only while the mounting stays conditional, which
# `test_the_private_router_is_still_local_only` asserts.
_LOCAL_ONLY_PREFIX = "/api/v1/private/"


def _walk(routes: list[BaseRoute], prefix: str = "") -> list[tuple[str, APIRoute]]:
    """`(full path, route)` for every `APIRoute`, however deeply included.

    This FastAPI version keeps an included router nested as an `_IncludedRouter`
    rather than flattening its routes into `app.routes`, so the obvious loop
    finds nothing at all — see the note in `test_route_inventory.py`. That test
    dodges the problem by reading `app.openapi()`; this one cannot, because it
    needs the `dependant` tree, which the schema does not carry.
    """
    found: list[tuple[str, APIRoute]] = []
    for route in routes:
        if isinstance(route, APIRoute):
            found.append((prefix + route.path, route))
        elif type(route).__name__ == "_IncludedRouter":
            context = route.include_context  # type: ignore[attr-defined]
            found.extend(
                _walk(route.original_router.routes, prefix + context.prefix)  # type: ignore[attr-defined]
            )
    return found


def _requires_auth(route: APIRoute) -> bool:
    stack = list(route.dependant.dependencies)
    while stack:
        dependant = stack.pop()
        if dependant.call in _AUTH_DEPENDENCIES:
            return True
        stack.extend(dependant.dependencies)
    return False


def _concrete(path: str) -> str:
    """A template path as a request would actually arrive.

    `is_public_path` sees the raw URL, not the route template, because
    `BaseHTTPMiddleware` runs before the router has matched anything. Filling the
    parameters in is what makes the assertion honest: a prefix that only matches
    the literal `{email}` would pass a naive check and 401 every real address.
    """
    return _PARAM.sub("sample", path)


def _open_routes() -> list[tuple[str, APIRoute]]:
    return [
        (path, route)
        for path, route in _walk(app.routes)
        if not _requires_auth(route) and not path.startswith(_LOCAL_ONLY_PREFIX)
    ]


def test_the_private_router_is_still_local_only() -> None:
    """The reason `/private` is exempt from the rule, asserted rather than assumed.

    `routes/private.py` creates arbitrary users with no credentials at all. It is
    harmless only because it is mounted behind `if settings.ENVIRONMENT ==
    "local"`. Mount it unconditionally and the exclusion above quietly turns from
    "not applicable" into "unguarded hole", so this reads the assembly.
    """
    tree = ast.parse(_ROUTER_ASSEMBLY.read_text())

    def includes_private(nodes: list[ast.stmt]) -> bool:
        return any(
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "include_router"
            and "private" in ast.dump(node)
            for parent in nodes
            for node in ast.walk(parent)
        )

    guarded = [
        node.body
        for node in ast.walk(tree)
        if isinstance(node, ast.If) and "ENVIRONMENT" in ast.dump(node.test)
    ]
    assert any(includes_private(body) for body in guarded), (
        "`private.router` is no longer mounted behind an `ENVIRONMENT` check, so "
        "its unauthenticated routes are exempted from the exemption guard for a "
        "reason that no longer holds"
    )
    unguarded = [
        node
        for node in tree.body
        if not (isinstance(node, ast.If) and "ENVIRONMENT" in ast.dump(node.test))
    ]
    assert not includes_private(unguarded), (
        "`private.router` is included unconditionally as well as conditionally"
    )


def test_the_walk_sees_every_route_the_schema_does() -> None:
    """Fail loudly if FastAPI's internals move under this guard.

    Without this, a rename of `_IncludedRouter` turns `_walk` into a function
    that returns an empty list, and every assertion below passes vacuously.
    """
    walked = {
        (method.upper(), path)
        for path, route in _walk(app.routes)
        for method in route.methods
        if method.upper() != "HEAD"
    }
    documented = {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
    }
    assert walked == documented, (
        "the route walk and the OpenAPI schema disagree; `_walk` can no longer "
        "see the application's routes and this guard is not checking anything"
    )


def test_a_permission_dependency_authenticates_first() -> None:
    """Why checking only for `get_current_user` catches permission-gated routes.

    `require_permission` never appears in `_AUTH_DEPENDENCIES`, and does not
    need to: it cannot decide whether *you* hold a permission without resolving
    who you are, so `get_current_user` is always somewhere beneath it. Take
    `CurrentUser` out of its signature and this guard would start reporting
    every admin route as a public one the middleware must exempt — so the
    relationship is asserted here rather than assumed.
    """
    from fastapi import Depends
    from fastapi.dependencies.utils import get_dependant

    from app.api.deps import require_permission
    from app.core.permissions import Permission

    def route(_: object = Depends(require_permission(Permission.USERS_READ))) -> None:
        return None

    dependant = get_dependant(path="/probe", call=route)

    stack = list(dependant.dependencies)
    seen = set()
    while stack:
        node = stack.pop()
        seen.add(node.call)
        stack.extend(node.dependencies)

    assert get_current_user in seen, (
        "`require_permission` no longer resolves the current user, so routes "
        "guarded only by a permission now look unauthenticated to this guard"
    )


def test_there_are_open_routes_to_check() -> None:
    """`_open_routes()` returning nothing would make the next test vacuous."""
    assert _open_routes(), (
        "no route declares itself public — is `_requires_auth` broken?"
    )


@pytest.mark.security
def test_every_route_without_auth_is_exempt_from_the_middleware() -> None:
    """Direction 1: a public route the middleware does not know about is dead."""
    unreachable = [
        f"{sorted(route.methods)[0]} {path}"
        for path, route in _open_routes()
        if not is_public_path(_concrete(path))
    ]
    assert not unreachable, (
        "these routes declare no auth dependency, so they are meant to be "
        "reachable logged out, but `APIKeyMiddleware` will 401 them outside "
        "`local`:\n  " + "\n  ".join(sorted(unreachable))
    )


@pytest.mark.security
def test_every_middleware_exemption_matches_a_route_without_auth() -> None:
    """Direction 2: an exemption with no open route behind it is a stale hole."""
    open_paths = [path for path, _ in _open_routes()]
    orphaned = [
        exemption
        for exemption in sorted(PUBLIC_API_PATHS)
        if exemption not in open_paths
    ]
    orphaned += [
        prefix
        for prefix in sorted(PUBLIC_API_PREFIXES)
        if not any(path.startswith(prefix) for path in open_paths)
    ]
    assert not orphaned, (
        "`APIKeyMiddleware` exempts paths that no auth-free route serves any "
        "more. Either the route moved or it grew an auth dependency; drop the "
        f"exemption:\n  {orphaned}"
    )


@pytest.mark.security
@pytest.mark.parametrize("prefix", sorted(PUBLIC_API_PREFIXES))
def test_a_public_prefix_stops_at_a_path_separator(prefix: str) -> None:
    """No prefix may exempt a *sibling* whose name merely starts the same way.

    Parametrised over the list rather than written out per prefix, because the
    danger is in the one nobody thought about. `/api/v1/password-recovery`
    without a trailing separator swallows `/password-recovery-html-content/`,
    the superuser-only route that renders a live reset token for an arbitrary
    address; `/api/v1/login` without one would swallow a `/login-history` on the
    day someone adds it. Both are the same mistake, and only one of them exists
    yet — which is exactly why this is a rule about the shape of the list.
    """
    assert prefix.endswith("/"), (
        f"{prefix!r} does not end at a path separator, so it also exempts any "
        f"route whose name merely begins with {prefix.rsplit('/', 1)[-1]!r}"
    )
    assert is_public_path(f"{prefix}something")
    assert not is_public_path(f"{prefix.rstrip('/')}-sibling/something")


@pytest.mark.security
def test_the_superuser_only_recovery_variant_is_not_swept_in_by_the_prefix() -> None:
    """The concrete pair the rule above exists for, named so it cannot be lost.

    `/password-recovery-html-content/{email}` renders a live password-reset token
    for any address the caller names. It sits directly beside
    `/password-recovery/{email}` in the same module and shares its first 26
    characters.
    """
    assert is_public_path("/api/v1/password-recovery/someone@example.com")
    assert not is_public_path(
        "/api/v1/password-recovery-html-content/someone@example.com"
    )


@pytest.mark.security
def test_a_public_path_is_public_with_or_without_its_trailing_slash() -> None:
    """The middleware and the router must agree on what the path is.

    FastAPI answers `/reset-password` with a 307 to `/reset-password/`, but the
    router never runs if this middleware has already said 401 — so a caller who
    omits the slash would get an authentication error for a public endpoint.
    """
    assert is_public_path("/api/v1/reset-password/")
    assert is_public_path("/api/v1/reset-password")
