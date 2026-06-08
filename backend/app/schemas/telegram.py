from typing import Any

from pydantic import BaseModel, Field


class ProxyConfig(BaseModel):
    proxy_enabled: bool = Field(False, alias="proxyEnabled")
    proxies: list[str] | None = None
    tor_auto_rotate: bool = Field(False, alias="torAutoRotate")
    tor_rotation_threshold: int = Field(10, alias="torRotationThreshold")

    model_config = {"populate_by_name": True}


class ScrapeRequest(ProxyConfig):
    url: str
    known_latest_id: int | None = Field(None, alias="knownLatestId")
    known_display_name: str | None = Field(None, alias="knownDisplayName")
    known_photo_url: str | None = Field(None, alias="knownPhotoUrl")


class ChannelInfoRequest(ProxyConfig):
    channel_name: str = Field(..., alias="channelName")


class BotInfoRequest(ProxyConfig):
    token: str
    method: str
    params: dict[str, Any] | None = None


class PublishRequest(ProxyConfig):
    token: str
    chat_id: str = Field(..., alias="chatId")
    text: str
    metadata_text: str | None = Field(None, alias="metadataText")


class TestProxyRequest(BaseModel):
    proxy_url: str = Field(..., alias="proxyUrl")

    model_config = {"populate_by_name": True}


class TorNewIdentityRequest(BaseModel):
    port: int | None = None
