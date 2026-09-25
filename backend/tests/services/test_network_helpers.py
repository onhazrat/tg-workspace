"""The two small pieces of `network.py` that are ours rather than a transport's.

`parse_telegram_entities` turns the markdown a Summary is written in into the
`(text, entities)` pair the Bot API publishes, so an offset one character off
bolds the wrong word in a channel somebody else reads. `rotate_tor_identity` is
the NEWNYM signal, and its only logic is the reentrancy flag: a flag left set
turns every later rotation into a silent no-op.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.services import network
from app.services.network import parse_telegram_entities, rotate_tor_identity
from app.services.telegram_web import telegram_channel_post_url


@pytest.mark.parametrize(
    ("source", "plain", "entities"),
    [
        pytest.param(
            "a **bold** b",
            "a bold b",
            [{"type": "bold", "offset": 2, "length": 4}],
            id="double-star-bold",
        ),
        pytest.param(
            "*it* x",
            "it x",
            [{"type": "italic", "offset": 0, "length": 2}],
            id="single-star-italic",
        ),
        pytest.param(
            "x _it_",
            "x it",
            [{"type": "italic", "offset": 2, "length": 2}],
            id="underscore-italic",
        ),
        pytest.param(
            "see [chan_1 #42]",
            "see [chan_1 #42]",
            [
                {
                    "type": "text_link",
                    "offset": 4,
                    "length": len("[chan_1 #42]"),
                    "url": telegram_channel_post_url("chan_1", 42),
                }
            ],
            id="post-citation-keeps-its-brackets",
        ),
        pytest.param(
            "[label](https://example.test/p)",
            "label",
            [
                {
                    "type": "text_link",
                    "offset": 0,
                    "length": 5,
                    "url": "https://example.test/p",
                }
            ],
            id="markdown-link",
        ),
        pytest.param(
            "no markup at all",
            "no markup at all",
            [],
            id="plain-text-only",
        ),
        pytest.param(
            # Every offset is measured in the *stripped* text, so the second
            # entity sits four characters left of where it sat in the source.
            "**A** then [l](u) tail",
            "A then l tail",
            [
                {"type": "bold", "offset": 0, "length": 1},
                {"type": "text_link", "offset": 7, "length": 1, "url": "u"},
            ],
            id="offsets-follow-the-stripped-text-and-keep-the-tail",
        ),
        pytest.param(
            # The Bot API counts UTF-16 code units, and an emoji outside the
            # BMP is two of them: one unit for the emoji, one for the space.
            "🎉 **bold** x",
            "🎉 bold x",
            [{"type": "bold", "offset": 3, "length": 4}],
            id="emoji-before-bold-counts-two-units",
        ),
        pytest.param(
            # "go " + two units + " now" is nine units, and the bold after the
            # link inherits the extra one.
            "a [go 🚀 now](https://example.test/p) **b**",
            "a go 🚀 now b",
            [
                {
                    "type": "text_link",
                    "offset": 2,
                    "length": 9,
                    "url": "https://example.test/p",
                },
                {"type": "bold", "offset": 12, "length": 1},
            ],
            id="emoji-inside-link-label-shifts-later-entities",
        ),
    ],
)
def test_parse_telegram_entities(
    source: str, plain: str, entities: list[dict[str, Any]]
) -> None:
    assert parse_telegram_entities(source) == (plain, entities)


@pytest.fixture
def rotations(monkeypatch: pytest.MonkeyPatch) -> list[tuple[int, str]]:
    """Every NEWNYM this process sent, with Tor and the 2s settle stubbed out."""
    sent: list[tuple[int, str]] = []

    def fake_sync(port: int, password: str) -> None:
        sent.append((port, password))

    real_sleep = asyncio.sleep

    async def short_sleep(_seconds: float) -> None:
        # Still yields, because the settle wait is the window a second caller
        # arrives in; a sleep that never suspends would hide the flag.
        await real_sleep(0)

    monkeypatch.setattr(network, "_rotate_tor_identity_sync", fake_sync)
    monkeypatch.setattr(network.asyncio, "sleep", short_sleep)
    monkeypatch.setattr(network, "_is_rotating_tor", False)
    monkeypatch.setattr(network, "_tor_request_counter", 7)
    return sent


def test_a_rotation_resets_the_request_counter(
    rotations: list[tuple[int, str]],
) -> None:
    asyncio.run(rotate_tor_identity(9999, "pw"))

    assert rotations == [(9999, "pw")]
    assert network._tor_request_counter == 0
    assert network._is_rotating_tor is False


def test_a_rotation_already_in_flight_is_not_sent_twice(
    rotations: list[tuple[int, str]],
) -> None:
    async def both() -> None:
        await asyncio.gather(rotate_tor_identity(1, ""), rotate_tor_identity(2, ""))

    asyncio.run(both())

    assert rotations == [(1, "")]


def test_a_failed_rotation_does_not_disable_the_next_one(
    rotations: list[tuple[int, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    """**Mutation:** drop the `finally` and the second call sends nothing."""

    def refuse(_port: int, _password: str) -> None:
        raise ConnectionRefusedError("control port closed")

    monkeypatch.setattr(network, "_rotate_tor_identity_sync", refuse)
    with pytest.raises(ConnectionRefusedError):
        asyncio.run(rotate_tor_identity(9051, ""))
    # The counter only resets on a rotation that happened.
    assert network._tor_request_counter == 7

    monkeypatch.setattr(
        network, "_rotate_tor_identity_sync", lambda p, pw: rotations.append((p, pw))
    )
    asyncio.run(rotate_tor_identity(9051, ""))
    assert rotations == [(9051, "")]


def test_a_rotation_without_arguments_uses_the_configured_port(
    rotations: list[tuple[int, str]], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(network.settings, "TOR_CONTROL_PORT", 9151)
    monkeypatch.setattr(network.settings, "TOR_CONTROL_PASSWORD", "secret")

    asyncio.run(rotate_tor_identity())

    assert rotations == [(9151, "secret")]
