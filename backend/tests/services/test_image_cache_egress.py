"""Guard: an image cache fetch leaves through the caller's proxy, never a bare client.

Ticket 36 / [ADR-012](../../../docs/migration/ADR-012-egress-seam.md): every
request to Telegram leaves through an acquired Lane. Media is not an exception
and never was. `post_thumbnails.cache_post_thumb` has said so in a comment since
it was written -- *page fetches and the media they reference must leave from the
same egress, or scraping over Tor still hands Telegram's CDN the real IP* -- and
its twin `channel_photos.cache_channel_photo` opened an `httpx.AsyncClient` with
no proxy and fetched every channel avatar from the deployment's real address.

**This file is parametrised over both modules on purpose.** `CLAUDE.md`'s rule is
that a fix applied to one of two twins is half a fix, and this pair is the
worked example it cites: same `_META_SUFFIX`, same `_meta_path`/`_read_meta`/
`_find_image_path`/`has_cached_*`, same bounded extension set. The lookup-cost
guard next door (`test_photo_cache_lookup_cost.py`) is parametrised for the same
reason, after the glob fix reached one twin and not the other for two months.

The tests assert the *reason* rather than the mechanism: the fetch must carry the
caller's egress settings, and the module must not be able to open a client of its
own. They hold whether the transport stays `fetch_with_retry` or becomes
something else, and they fail if either twin drifts back.
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
from collections.abc import Callable, Coroutine
from typing import Any

import pytest

from app.services import channel_photos, post_thumbnails
from app.services.network import MEDIA_FETCH_RETRIES

APP_ROOT = pathlib.Path(channel_photos.__file__).resolve().parents[1]

#: A proxy that must appear in the fetch, and settings that must ride with it.
#: Values are deliberately unlike any default, so a forwarded argument cannot be
#: confused with one the transport invented.
PROXIES = ["socks5://guard.example:9050"]
PROXY_CONCURRENCY = (7, {"socks5://guard.example:9050": 3})
TOR_ROTATION_THRESHOLD = 11


class _FetchRecorder:
    """Stands in for `fetch_with_retry` and remembers how it was called.

    Answers an **empty body**, so the cache function returns before it writes
    anything to disk. The assertion is about the request, not the file, and a
    guard that needs a temp directory to make its point acquires a second reason
    to fail.
    """

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def __call__(self, url: str, **kwargs: Any) -> tuple[tuple[bytes, str], None]:
        self.calls.append({"url": url, **kwargs})
        return (b"", "image/jpeg"), None


#: The two twins, and how to reach each one's fetch. The signatures differ (a
#: channel avatar is keyed by channel, a thumb by channel *and* post), so the
#: inventory carries a caller rather than a set of arguments.
CACHES: dict[str, tuple[Any, Callable[..., Coroutine[Any, Any, bool]]]] = {
    "channel_photos": (
        channel_photos,
        lambda **kw: channel_photos.cache_channel_photo(
            "-100123", "https://cdn.example/avatar.jpg", force=True, **kw
        ),
    ),
    "post_thumbnails": (
        post_thumbnails,
        lambda **kw: post_thumbnails.cache_post_thumb(
            "somechannel", 42, "https://cdn.example/thumb.jpg", force=True, **kw
        ),
    ),
}


def _module_source(module: Any) -> ast.Module:
    return ast.parse(pathlib.Path(module.__file__).read_text())


@pytest.mark.parametrize("name", sorted(CACHES))
def test_the_recorder_can_actually_observe_a_fetch(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation: make `_FetchRecorder` stop recording and every test below passes.

    The lookup-cost guard next door earns its keep with the same test, for the
    same reason: a guard whose instrument is broken is a guard that cannot fail.
    """
    module, call = CACHES[name]
    recorder = _FetchRecorder()
    monkeypatch.setattr(module, "fetch_with_retry", recorder)

    asyncio.run(call())

    assert len(recorder.calls) == 1, (
        f"{name}'s cache made no observable fetch, so nothing below this line "
        "is being checked"
    )


@pytest.mark.parametrize("name", sorted(CACHES))
def test_the_cache_fetch_carries_the_callers_egress(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation: drop any one of the four keywords at either call site.

    All four travel together. `proxies` alone chooses the exit; the concurrency
    map is how the Lane's limit is honoured, and the two Tor fields are how a
    rotating exit stays rotating. A fetch that took the proxy and left the rest
    behind would leave from the right address at the wrong rate.
    """
    module, call = CACHES[name]
    recorder = _FetchRecorder()
    monkeypatch.setattr(module, "fetch_with_retry", recorder)

    asyncio.run(
        call(
            proxies=PROXIES,
            proxy_concurrency=PROXY_CONCURRENCY,
            tor_auto_rotate=True,
            tor_rotation_threshold=TOR_ROTATION_THRESHOLD,
        )
    )

    (fetch,) = recorder.calls
    assert fetch["proxies"] == PROXIES, f"{name} fetched off the caller's proxy"
    assert fetch["proxy_concurrency"] == PROXY_CONCURRENCY
    assert fetch["tor_auto_rotate"] is True
    assert fetch["tor_rotation_threshold"] == TOR_ROTATION_THRESHOLD


@pytest.mark.parametrize("name", sorted(CACHES))
def test_media_never_climbs_a_retry_ladder(
    name: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """One attempt, because the sync itself is the retry.

    `fetch_with_retry` defaults to 8 attempts with a 3s escalating delay, which
    is sized for a page fetch: lose the page and you lose the sync. Media is not
    that. `_fetch_one_page` re-resolves the avatar on **every page** of a walk,
    so the page loop already retries, and a thumb is cosmetic either way.

    This is not hypothetical. Moving the avatar cache onto the lane pool at the
    default took `tests/api/test_sync_jobs.py` from 13 seconds to 8 minutes,
    which is what a channel with one dead avatar URL would have done to a real
    sync, per page, in production.
    """
    module, call = CACHES[name]
    recorder = _FetchRecorder()
    monkeypatch.setattr(module, "fetch_with_retry", recorder)

    asyncio.run(call())

    (fetch,) = recorder.calls
    assert fetch["retries"] == MEDIA_FETCH_RETRIES, (
        f"{name} fetches media on the page-fetch retry budget"
    )
    assert MEDIA_FETCH_RETRIES == 1, (
        "`retries` is a count of attempts, so anything above 1 is a ladder, and "
        "a ladder under a per-page call multiplies the cost of one bad URL"
    )


@pytest.mark.parametrize("name", sorted(CACHES))
def test_neither_twin_can_open_a_client_of_its_own(name: str) -> None:
    """The structural half, and the one that actually regressed.

    Forwarding arguments is only half the invariant: the avatar cache forwarded
    nothing *because* it had its own `httpx.AsyncClient` to fetch with. A module
    that cannot name `httpx` cannot build one, so this is asserted on the source
    rather than on a patched call -- a behavioural test would have to guess which
    of the many ways to make a request the next regression picks.
    """
    module, _call = CACHES[name]
    names = {
        node.id
        for node in ast.walk(_module_source(module))
        if isinstance(node, ast.Name)
    } | {
        alias.name.split(".")[0]
        for node in ast.walk(_module_source(module))
        if isinstance(node, ast.Import)
        for alias in node.names
    }
    assert "httpx" not in names, (
        f"{name} names `httpx`, so it can open a client that bypasses the proxy "
        "lane -- which is exactly how channel avatars leaked the real IP"
    )


def test_the_avatar_resolver_forwards_what_it_was_given(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`resolve_cached_photo_url` is the entry point both scrapers actually call.

    Guarding `cache_channel_photo` alone would leave the wrapper free to accept
    the settings and drop them, which is a one-line regression with no symptom
    short of a packet capture.
    """
    recorder = _FetchRecorder()
    monkeypatch.setattr(channel_photos, "fetch_with_retry", recorder)

    asyncio.run(
        channel_photos.resolve_cached_photo_url(
            "-100999",
            "https://cdn.example/avatar.jpg",
            proxies=PROXIES,
            proxy_concurrency=PROXY_CONCURRENCY,
            tor_auto_rotate=True,
            tor_rotation_threshold=TOR_ROTATION_THRESHOLD,
        )
    )

    (fetch,) = recorder.calls
    assert fetch["proxies"] == PROXIES
    assert fetch["proxy_concurrency"] == PROXY_CONCURRENCY
    assert fetch["tor_auto_rotate"] is True
    assert fetch["tor_rotation_threshold"] == TOR_ROTATION_THRESHOLD


def test_every_avatar_call_site_passes_a_proxy() -> None:
    """Derived from the AST, because the next call site is the one that forgets.

    Two exist today, in `scraper.get_channel_info` and the orchestrator's page
    walk, and both already held these settings before ADR-012 without passing
    them. A third caller that omits `proxies` compiles, type-checks, and silently
    reopens the leak for whichever path it serves -- so the check is on the call,
    not on the function.
    """
    offenders: list[str] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "alembic" in path.parts or path.name == "channel_photos.py":
            continue
        for node in ast.walk(ast.parse(path.read_text(), filename=str(path))):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            called = (
                func.id
                if isinstance(func, ast.Name)
                else func.attr
                if isinstance(func, ast.Attribute)
                else None
            )
            if called != "resolve_cached_photo_url":
                continue
            if not any(kw.arg == "proxies" for kw in node.keywords):
                offenders.append(f"{path.relative_to(APP_ROOT.parent)}:{node.lineno}")

    assert not offenders, (
        "these calls resolve a channel avatar without naming an egress, so the "
        f"fetch leaves from the deployment's real address: {offenders}"
    )
