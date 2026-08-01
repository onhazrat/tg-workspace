"""Response models for the Telegram scrape/publish endpoints.

Part of B6 in `docs/architecture-simplification-plan.md`. Named
`telegram_ops` because `app/schemas/telegram.py` already holds this family's
*request* models.

Two things stay deliberately loose, both for the same reason — the payload is
someone else's:

* **`telemetry`** is per-attempt fetch detail assembled by `network.py`, whose
  shape varies with the retry path taken. Nothing renders it structurally; it is
  logged.
* **`BotInfoResponse`** is the raw Telegram Bot API reply, spread into the
  response. `POST /telegram/bot-info` proxies an *arbitrary* Bot API method
  chosen by the caller, so its keys are whatever that method returns. Only
  `telemetry`, which we add ourselves, can be declared.

Everything else here is closed.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

#: Per-attempt fetch detail from `services/network.py`. Deliberately untyped —
#: see the module docstring.
type Telemetry = Any


class ScrapeChannelResponse(BaseModel):
    """A scraped page range plus the channel meta that came with it.

    The counter fields (`subscribers`, `photos`, …) are the strings Telegram
    renders ("12.3K"), not parsed numbers, and default to `""` here rather than
    `null`: `scrape_channel` coerces every one with `or ""`, so the empty string
    is what the wire has always carried when a counter is missing.
    """

    model_config = ConfigDict(populate_by_name=True)

    channel_name: str = Field(alias="channelName")
    display_name: str = Field(default="", alias="displayName")
    photo_url: str = Field(default="", alias="photoUrl")
    bio: str = ""
    subscribers: str = ""
    photos: str = ""
    videos: str = ""
    files: str = ""
    links: str = ""
    #: An `int`, not a string — `_extract_telegram_chat_id` parses it out of
    #: the page and the `Channel.telegram_chat_id` column is `int | None` too.
    telegram_chat_id: int | None = Field(default=None, alias="telegramChatId")
    #: Raw parsed posts. **Not** `PostResponse`: these come off the HTML parser
    #: before persistence and carry no `channelName`, so they are a different
    #: shape from a stored post despite the overlap.
    posts: list[dict[str, Any]] = Field(default_factory=list)
    latest_id: int = Field(default=0, alias="latestId")
    telemetry: list[Telemetry] = Field(default_factory=list)


class ChannelInfoResponse(BaseModel):
    """What one fetch of a channel's meta page reports.

    Unlike `ScrapeChannelResponse`, the counters here are `str | None`:
    `_parse_channel_meta` returns them straight from the parsed page without the
    `or ""` coercion that the scrape path applies. Same fields, different
    nullability — that difference is real and is why these are two models.
    """

    model_config = ConfigDict(populate_by_name=True)

    channel_name: str = Field(alias="channelName")
    display_name: str = Field(default="", alias="displayName")
    photo_url: str | None = Field(default=None, alias="photoUrl")
    bio: str | None = None
    subscribers: str | None = None
    photos: str | None = None
    videos: str | None = None
    files: str | None = None
    links: str | None = None
    latest_id: int = Field(default=0, alias="latestId")
    telegram_chat_id: int | None = Field(default=None, alias="telegramChatId")
    #: Structural fact: the page exists but cannot be followed.
    is_unavailable_on_web_view: bool = Field(
        default=False, alias="isUnavailableOnWebView"
    )
    is_telegram_page: bool = Field(default=False, alias="isTelegramPage")
    #: HTML heuristic — `channel` | `group` | `bot` | `user` | `unknown`.
    kind: str = "unknown"
    telemetry: Telemetry = None


class ResolveStartTimeResponse(BaseModel):
    """The first post id at or after a target timestamp."""

    model_config = ConfigDict(populate_by_name=True)

    start_id: int = Field(alias="startId")


class BotInfoResponse(BaseModel):
    """A proxied Telegram Bot API reply.

    Open by necessity: the caller picks the Bot API method, so the keys are
    whatever that method returns. Only `telemetry` is ours.
    """

    model_config = ConfigDict(extra="allow")

    telemetry: Telemetry = None


class PublishResponse(BaseModel):
    """Result of sending a summary, one entry per 4000-character chunk.

    `results` holds the raw Bot API replies — same reasoning as
    `BotInfoResponse`, so they stay untyped.
    """

    success: bool = True
    results: list[Any] = Field(default_factory=list)
    telemetry: list[Telemetry] = Field(default_factory=list)
