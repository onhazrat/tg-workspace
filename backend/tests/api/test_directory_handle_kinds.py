"""Every Directory entry says what its handle is (HKD-01, ADR-047).

A probe asks for `t.me/s/<handle>`. A handle with no preview redirects to
`t.me/<handle>`, and that page names the Handle kind: its title's verb
(`View`, `Launch`, `Contact`), its header line and whether a name shows. The
probe keeps the page it already fetched, so the kind costs no Request.

Telegram is faked at the HTTP transport, below the fetch layer, so the
redirect and the soft-block parsing run for real. Each case serves one real
page captured on 2026-11-02 (`tests/fixtures/live/kind_*.html`; the Hidden
Channel and the user are renamed) and reads the entry back through the
Directory read API. These are the restyle guard too: a page Telegram restyles
fails here instead of silently unlisting Channels.

## Watched to fail

* classify by the handle's `bot` suffix -> the Channel spelled like a bot
* drop the page from the plain soft block -> every no-preview kind but the
  Hidden Channel reads `unknown`
* read the count from the Channel counters only -> the Hidden Channel, the
  group and the bot lose their counts
* leave the status `private` -> the Hidden Channel's status
* call a nameless Contact page a user -> the free handle
* leave the verdict off the panel's entry -> the Hidden Channel's entry
* search the header lines for a count's word -> the user named for one
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session

from app import crud
from app.core.config import settings
from app.core.db import engine
from app.jobs import discover_probe
from app.models import UserUpdate
from app.services import directory_reads, network
from app.services.proxy_pool import get_proxy_pool
from app.services.telegram_web import telegram_web_domain
from tests.utils.sleep import asyncio_without_sleep
from tests.utils.user import create_random_user, user_authentication_headers

DIRECTORY = f"{settings.API_V1_STR}/data/directory"
LIVE = Path(__file__).resolve().parents[1] / "fixtures" / "live"


def _page(kind: str) -> str:
    return (LIVE / f"kind_{kind}.html").read_text()


class FakeTelegram:
    """`t.me` behind the lane's client: a preview page is served as it is, any
    other page is the redirect Telegram answers with, then the page itself."""

    def __init__(self) -> None:
        self.pages: dict[str, str] = {}
        self.calls: list[str] = []

    def handle(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if request.url.host != telegram_web_domain():
            return httpx.Response(404)  # a photo, which no case here reads
        self.calls.append(path)
        if path.startswith("/s/"):
            handle = path.removeprefix("/s/")
            page = self.pages.get(handle, "")
            if "tgme_widget_message_date" in page:
                return httpx.Response(200, text=page)
            target = request.url.copy_with(path=f"/{handle}")
            return httpx.Response(302, headers={"location": str(target)})
        return httpx.Response(200, text=self.pages.get(path.removeprefix("/"), ""))


@pytest.fixture
def telegram(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeTelegram]:
    fake = FakeTelegram()
    lane = get_proxy_pool().direct_lane()
    client = httpx.AsyncClient(
        transport=httpx.MockTransport(fake.handle), follow_redirects=True
    )
    monkeypatch.setattr(lane, "client", client)
    monkeypatch.setattr(network, "asyncio", asyncio_without_sleep())
    yield fake


@pytest.fixture
def reader(client: TestClient) -> dict[str, str]:
    """An Account that is not a `DATA_ADMIN`: it is listed Channels only."""
    directory_reads.forget_cached_counts()
    with Session(engine) as session:
        user = create_random_user(session)
        crud.update_user(
            session=session, db_user=user, user_in=UserUpdate(password="hkd-pass")
        )
        email = user.email
    return user_authentication_headers(client=client, email=email, password="hkd-pass")


def _probe(telegram: FakeTelegram, handle: str, kind: str, page: str = "") -> None:
    telegram.pages[handle] = page or _page(kind)
    asyncio.run(discover_probe.probe_one_handle(handle))


def _listed(
    client: TestClient, headers: dict[str, str], columns: list[str], **body: Any
) -> dict[str, dict[str, Any]]:
    response = client.post(
        f"{DIRECTORY}/list", json={"columns": columns, **body}, headers=headers
    )
    assert response.status_code == 200, response.text
    return {row["handle"]: row for row in response.json()["rows"]}


@pytest.mark.parametrize(
    ("page", "handle", "status", "kind", "subscribers", "listed"),
    [
        ("readable_channel", "durov", "ok", "channel", "some", True),
        ("hidden_channel", "example_hidden", "hidden", "channel", 5_493, True),
        ("group", "vsevcapoeira_group", "unavailable", "group", 25, False),
        ("bot", "BotFather", "unavailable", "bot", 7_966_382, False),
        ("user", "example_person", "unavailable", "user", None, False),
        ("free", "zzqq_no_such_handle_8812", "unavailable", "free", None, False),
    ],
)
def test_a_probe_records_what_the_page_says_the_handle_is(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    reader: dict[str, str],
    telegram: FakeTelegram,
    page: str,
    handle: str,
    status: str,
    kind: str,
    subscribers: int | str | None,
    listed: bool,
) -> None:
    _probe(telegram, handle, page)
    key = handle.lower()

    every = _listed(client, superuser_token_headers, ["status", "kind", "subscribers"])
    row = every[key]
    assert (row["status"], row["kind"]) == (status, kind)
    if subscribers == "some":
        assert isinstance(row["subscribers"], int) and row["subscribers"] > 0
    else:
        assert row.get("subscribers") == subscribers
    assert (key in _listed(client, reader, ["status"])) is listed
    # Each kind is a Condition the server accepts.
    cond = {"type": "is", "field": "kind", "value": kind}
    tree = {"kind": "group", "op": "and", "children": [{"kind": "atom", "cond": cond}]}
    assert key in _listed(client, superuser_token_headers, [], filter=tree)
    if listed:
        # The panel's entry says when a listed Channel is hidden.
        entry = client.get(f"{DIRECTORY}/{key}/entry", headers=reader)
        assert entry.json()["status"] == status
    # One Request: the preview URL, and the redirect it answered with.
    assert telegram.calls[0] == f"/s/{handle}"
    assert len(telegram.calls) == (1 if status == "ok" else 2)


def test_a_channel_spelled_like_a_bot_is_a_channel(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    reader: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """574 readable Channels on staging end in "bot"; the spelling is no evidence."""
    _probe(telegram, "durov_newsbot", "readable_channel")

    row = _listed(client, reader, ["status"])["durov_newsbot"]
    assert row["status"] == "ok"
    every = _listed(client, superuser_token_headers, ["kind"])
    assert every["durov_newsbot"]["kind"] == "channel"


def test_a_user_named_for_a_count_is_a_user(
    client: TestClient,
    superuser_token_headers: dict[str, str],
    telegram: FakeTelegram,
) -> None:
    """A bot's or a user's page has a header line holding `@handle` above the
    count. A handle that spells "subscribers" is still a person, and is not
    a Hidden Channel."""
    handle = "subscribers_members"
    _probe(telegram, handle, "user", _page("user").replace("example_person", handle))

    row = _listed(client, superuser_token_headers, ["status", "kind"])[handle]
    assert (row["status"], row["kind"]) == ("unavailable", "user")
