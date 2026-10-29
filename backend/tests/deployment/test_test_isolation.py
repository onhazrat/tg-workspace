"""One test's state never reaches the next.

Two leaks cost a session hours before these guards existed. `network`'s proxy
pace is module state: a soft block in one test widened the direct egress's
wait, and a later file's fetches served it on real sleeps, a run at 0% CPU for
over ten minutes. And `monkeypatch.setattr(network.asyncio, "sleep", ...)`
reads as patching one module but patches the shared `asyncio` module, so the
event loop stops sleeping and a task cancel lands somewhere else.
"""

from __future__ import annotations

import ast
import pathlib
import re
from collections.abc import Iterator

from app.services import network
from app.services.proxy_pacing import ProxyPace

TESTS = pathlib.Path(__file__).resolve().parents[1]


# Order matters: pytest runs a file's tests in the order written, so the second
# reads what the first left behind.
def test_a_test_may_widen_the_pace_and_park_a_proxy() -> None:
    network._proxy_pace[network.DIRECT_EGRESS_KEY] = ProxyPace(wait_ms=30_000.0)
    network._bad_proxies["http://proxy.example:8080"] = float("inf")


def test_the_next_test_starts_with_no_pace_and_no_cooldown() -> None:
    """Mutation: drop `_clean_proxy_state` from `tests/conftest.py`."""
    assert network._proxy_pace == {}
    assert network._bad_proxies == {}


_ASYNCIO_SLEEP = re.compile(r"(^|\.)asyncio\.sleep$")


def _is_asyncio(node: ast.expr) -> bool:
    return (isinstance(node, ast.Name) and node.id == "asyncio") or (
        isinstance(node, ast.Attribute) and node.attr == "asyncio"
    )


def _global_sleep_patches(tree: ast.AST) -> Iterator[int]:
    """Lines patching `sleep` on the shared `asyncio` module, in any spelling."""
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        args = node.args
        if (
            args
            and isinstance(args[0], ast.Constant)
            and isinstance(args[0].value, str)
        ):
            if _ASYNCIO_SLEEP.search(args[0].value):
                yield node.lineno
        elif (
            len(args) >= 2
            and _is_asyncio(args[0])
            and isinstance(args[1], ast.Constant)
            and args[1].value == "sleep"
        ):
            yield node.lineno


def test_no_test_patches_the_shared_asyncio_sleep() -> None:
    """Mutation: patch `network.asyncio`'s `sleep` in any test.

    Patch the module's `asyncio` with `tests/utils/sleep.asyncio_without_sleep`
    instead, so only that module stops sleeping.
    """
    offenders = [
        f"{path.relative_to(TESTS.parent)}:{line}"
        for path in sorted(TESTS.rglob("*.py"))
        for line in _global_sleep_patches(ast.parse(path.read_text()))
    ]
    assert offenders == [], (
        "patch the module's `asyncio` with asyncio_without_sleep, not its sleep"
    )


def test_the_guard_sees_every_spelling() -> None:
    spellings = [
        'monkeypatch.setattr(network.asyncio, "sleep", f)',
        'monkeypatch.setattr(asyncio, "sleep", f)',
        'monkeypatch.setattr("asyncio.sleep", f)',
        'patch("app.services.scraper.asyncio.sleep", f)',
        'patch.object(scraper.asyncio, "sleep", f)',
    ]
    for code in spellings:
        assert list(_global_sleep_patches(ast.parse(code))), code
    assert not list(
        _global_sleep_patches(
            ast.parse(
                'monkeypatch.setattr(network, "asyncio", asyncio_without_sleep())'
            )
        )
    )
