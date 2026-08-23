"""The auth endpoints are rate limited at the edge, and only they are.

Nothing in front of this deployment counted requests. `POST /login/access-token`
does a bcrypt verify per call and `POST /users/signup` writes a row, both
unauthenticated by definition, so an open instance could be walked or flooded at
whatever rate one client could manage.

The limit belongs in Traefik rather than in the app: it has to reject before the
request costs anything, and the app runs a single worker where a queued flood is
exactly what hurts. Traefik attaches middlewares per *router*, not per path, so
enforcing it on the auth paths alone means a second router with a narrower rule
and a higher priority — which is easy to get subtly wrong, hence this guard.

It asserts the shape, not the numbers: a router that (a) matches every path with
no auth dependency of its own, (b) chains the rate limiter, and (c) still chains
compression, so rate-limiting a path does not silently un-gzip it. The limit
values themselves are an operator's call and deliberately not pinned.
"""

from __future__ import annotations

import pathlib

import pytest
import yaml

_COMPOSE = pathlib.Path(__file__).resolve().parents[3] / "compose.yml"

# Kept in step with `app.middleware.api_key`: the paths a logged-out client is
# meant to reach, and therefore the ones an anonymous caller can spend our CPU
# on. `test_public_route_exemptions.py` guards the middleware side of this list.
RATE_LIMITED_PATHS = [
    "/api/v1/login",
    "/api/v1/users/signup",
    "/api/v1/password-recovery",
    "/api/v1/reset-password",
]


def _backend_labels() -> dict[str, str]:
    compose = yaml.safe_load(_COMPOSE.read_text())
    labels = compose["services"]["backend"]["labels"]
    parsed = dict(label.split("=", 1) for label in labels)
    assert parsed, "no backend labels in compose.yml — this guard sees nothing"
    return parsed


def _routers_carrying(middleware_suffix: str, labels: dict[str, str]) -> list[str]:
    """Router names whose `middlewares=` chain includes a middleware ending in X."""
    found = []
    for key, value in labels.items():
        if not key.endswith(".middlewares"):
            continue
        if any(entry.endswith(middleware_suffix) for entry in value.split(",")):
            found.append(
                key.removeprefix("traefik.http.routers.").removesuffix(".middlewares")
            )
    return found


@pytest.fixture
def labels() -> dict[str, str]:
    return _backend_labels()


def test_a_rate_limit_middleware_is_declared(labels: dict[str, str]) -> None:
    averages = [
        value for key, value in labels.items() if key.endswith(".ratelimit.average")
    ]
    assert averages, (
        "no `ratelimit.average` label on the backend service; registration and "
        "login are unlimited at the edge"
    )
    assert all(int(value) > 0 for value in averages), (
        "a rate limit of 0 means unlimited in Traefik, not blocked"
    )


def test_the_rate_limit_is_attached_to_a_router(labels: dict[str, str]) -> None:
    """A declared middleware nothing references does nothing at all."""
    assert _routers_carrying("-ratelimit", labels), (
        "the rate-limit middleware is declared but no router chains it, so it "
        "is never applied"
    )


@pytest.mark.parametrize("path", RATE_LIMITED_PATHS)
def test_the_rate_limited_router_covers_the_auth_paths(
    labels: dict[str, str], path: str
) -> None:
    rules = [
        labels[f"traefik.http.routers.{router}.rule"]
        for router in _routers_carrying("-ratelimit", labels)
        if f"traefik.http.routers.{router}.rule" in labels
    ]
    assert any(path in rule for rule in rules), (
        f"{path} is served by a router with no rate limit. Rules found: {rules}"
    )


def test_the_rate_limited_router_still_compresses(labels: dict[str, str]) -> None:
    """Splitting a router off the catch-all drops whatever the catch-all carried."""
    limited = set(_routers_carrying("-ratelimit", labels))
    compressed = set(_routers_carrying("-compress", labels))
    assert limited <= compressed, (
        f"rate-limited routers that lost compression: {sorted(limited - compressed)}"
    )


def test_the_rate_limited_router_points_at_the_backend_service(
    labels: dict[str, str],
) -> None:
    """A router split off the catch-all no longer infers its service.

    Traefik only guesses the service when a container has exactly one router;
    add a second and both need `.service=` or the new one 404s everything.
    """
    for router in _routers_carrying("-ratelimit", labels):
        key = f"traefik.http.routers.{router}.service"
        assert key in labels, f"{router} declares no service and will not route"
        assert labels[key].endswith("-backend")


def test_the_rate_limited_router_outranks_the_catch_all(labels: dict[str, str]) -> None:
    """Priority is explicit, not inherited from Traefik's rule-length heuristic.

    Traefik breaks ties by rule length, which happens to favour the narrower
    rule today. That is a coincidence of how the two rules are written, not a
    guarantee: shorten this one and the catch-all silently wins, taking the rate
    limit with it and failing nothing.
    """
    priorities = {
        key.removeprefix("traefik.http.routers.").removesuffix(".priority"): int(value)
        for key, value in labels.items()
        if key.endswith(".priority")
    }
    for router in _routers_carrying("-ratelimit", labels):
        assert priorities.get(router, 0) > 0, (
            f"{router} declares no explicit priority; it relies on Traefik's "
            "rule-length tie-break to beat the catch-all router"
        )
