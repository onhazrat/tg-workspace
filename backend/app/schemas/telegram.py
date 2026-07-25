from typing import Any

from pydantic import BaseModel, Field, model_validator


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
    credential_id: str | None = Field(None, alias="credentialId")
    token: str | None = None
    method: str
    params: dict[str, Any] | None = None

    @model_validator(mode="after")
    def require_credential_or_token(self) -> BotInfoRequest:
        if not self.credential_id and not self.token:
            raise ValueError("credentialId or token is required")
        return self


class PublishRequest(ProxyConfig):
    credential_id: str | None = Field(None, alias="credentialId")
    token: str | None = None
    chat_id: str = Field(..., alias="chatId")
    text: str
    metadata_text: str | None = Field(None, alias="metadataText")

    @model_validator(mode="after")
    def require_credential_or_token(self) -> PublishRequest:
        if not self.credential_id and not self.token:
            raise ValueError("credentialId or token is required")
        return self


class TestProxyRequest(BaseModel):
    proxy_url: str = Field(..., alias="proxyUrl")

    model_config = {"populate_by_name": True}


class TorNewIdentityRequest(BaseModel):
    port: int | None = None


class ResolveStartTimeRequest(ProxyConfig):
    channel_name: str = Field(..., alias="channelName")
    target_time_ms: int = Field(..., alias="targetTimeMs")


class ResolveStartTimeResponse(BaseModel):
    start_id: int = Field(..., alias="startId")

    model_config = {"populate_by_name": True}
