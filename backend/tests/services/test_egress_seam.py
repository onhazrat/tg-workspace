"""Every request out of this process leaves through an acquired Lane.

ADR-012's one rule. The operator asked for a single place in the code that
talks to proxies and to Telegram; before this ticket there were eleven, and
`bound_to` appeared in exactly one of them.

**Enforced twice, on purpose.** The runtime half is `network._fetch_once`,
which takes a required `client` that only `proxy_pool.build_lane_client`
produces — so a caller holding no Lane has nothing to pass. That half is
airtight for anything routed through `network.py` and blind to anything that
opens a client of its own, which is precisely how `cache_channel_photo` sent
every avatar request from the deployment's real address for five weeks while
its twin's docstring argued against exactly that.

So this file is the other half: an inventory. Construction is the signal,
walked from the AST — `httpx.AsyncClient(...)` anywhere in `app/` must belong
to a callable named in `CLIENT_BUILDERS`, with a reason. A grep would not do,
because `httpx` is named legitimately for its exception types in half a dozen
modules and by every type annotation on a client that is passed around.

`client-split.conform.ts` is the pattern: assert the reason, not just the
state. An exemption nothing checks becomes a leftover nobody dares touch.
"""

from __future__ import annotations

import ast
import pathlib

import pytest

APP = pathlib.Path(__file__).resolve().parents[2] / "app"

#: Every callable in `app/` allowed to construct an HTTP client, and why.
#:
#: Two, and they are not interchangeable. One builds the Lanes; the other
#: answers a question a Lane cannot. Anything else that appears here is a new
#: egress that nothing meters, nothing paces and nothing routes through a
#: proxy — add the Lane, do not add the entry.
CLIENT_BUILDERS: dict[str, str] = {
    "build_lane_client": (
        "the Lane's own client. This is the seam: one long-lived client per "
        "proxy, and the only object `_fetch_once` will accept."
    ),
    "_build_diagnostic_client": (
        "`test_proxy` and `get_tor_ip` ask ipify which address one *named* "
        "proxy exits from. Neither reaches Telegram, and neither can use a "
        "Lane — the operator is testing a URL that may not be in the pool, and "
        "answering about a different proxy is worse than not answering."
    ),
}

#: Attributes of `httpx` that open a connection, as opposed to naming a type.
#:
#: The client classes plus the module-level shorthands. `httpx.HTTPStatusError`
#: and friends are named all over the codebase and are not egress.
CLIENT_CALLS = frozenset(
    {"AsyncClient", "Client", "get", "post", "put", "delete", "request", "stream"}
)


def _python_files() -> list[pathlib.Path]:
    return [
        path
        for path in APP.rglob("*.py")
        # Alembic is excluded from lint and type-check here too, and a
        # migration that fetched anything would be a stranger problem than
        # this file is for.
        if "alembic" not in path.parts
    ]


def _enclosing_function(tree: ast.Module, target: ast.AST) -> str | None:
    """The nearest def containing `target`, or None at module level."""
    best: tuple[int, str] | None = None
    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
            continue
        end = node.end_lineno or node.lineno
        if node.lineno <= target.lineno <= end and (
            best is None or node.lineno > best[0]
        ):
            best = (node.lineno, node.name)
    return None if best is None else best[1]


def _client_constructions() -> list[tuple[str, int, str | None]]:
    """`(file, line, enclosing function)` for every httpx call that opens one."""
    found: list[tuple[str, int, str | None]] = []
    for path in _python_files():
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id == "httpx"
                and node.func.attr in CLIENT_CALLS
            ):
                rel = str(path.relative_to(APP.parent))
                found.append((rel, node.lineno, _enclosing_function(tree, node)))
    return found


def test_the_probe_can_see_a_client_being_built() -> None:
    """The instrument check. An AST walk that matched nothing would pass every
    assertion below while the codebase filled up with bare clients."""
    found = _client_constructions()

    assert found, "the AST walk found no httpx client construction at all"
    assert any(fn == "build_lane_client" for _, _, fn in found), (
        "the walk cannot even see the Lane's own client, so it is not looking "
        "where the clients are"
    )


def test_only_the_declared_builders_open_a_client() -> None:
    undeclared = [
        (path, line, fn)
        for path, line, fn in _client_constructions()
        if fn not in CLIENT_BUILDERS
    ]

    assert not undeclared, (
        "an HTTP client is built outside the egress seam at "
        + ", ".join(f"{p}:{ln} (in {fn})" for p, ln, fn in undeclared)
        + ". Nothing meters, paces or proxies a request made through it — a "
        "deployment scraping over Tor hands Telegram its real address. Route "
        "it through `fetch_with_retry`, or add it to CLIENT_BUILDERS with a "
        "reason that says why a Lane cannot answer."
    )


def test_every_declared_builder_still_exists() -> None:
    """The other direction. A reason attached to nothing is a leftover, and
    the next reader treats it as load-bearing rather than dead."""
    live = {fn for _, _, fn in _client_constructions()}

    stale = set(CLIENT_BUILDERS) - live
    assert not stale, (
        f"CLIENT_BUILDERS names {sorted(stale)}, which builds no client any "
        "more — delete the entry rather than leaving a reason for nothing"
    )


def test_the_one_fetch_path_cannot_be_called_without_a_client() -> None:
    """The runtime half. `client` is keyword-only **and has no default**, so
    the ephemeral fallback cannot come back as a one-keyword change."""
    import inspect

    from app.services import network

    sig = inspect.signature(network._fetch_once)
    client = sig.parameters["client"]

    assert client.kind is inspect.Parameter.KEYWORD_ONLY
    assert client.default is inspect.Parameter.empty, (
        "`_fetch_once` has a default client again, so fetching without "
        "acquiring a Lane is one keyword away"
    )
    assert client.annotation != "httpx.AsyncClient | None", (
        "`_fetch_once` accepts None for its client, which is the ephemeral "
        "fallback back in the type if not yet in the body"
    )


@pytest.mark.parametrize("name", sorted(CLIENT_BUILDERS))
def test_each_exemption_states_a_reason(name: str) -> None:
    reason = CLIENT_BUILDERS[name]

    assert len(reason) > 40 and " " in reason, (
        f"{name}'s exemption does not say why a Lane cannot answer for it"
    )
