"""Admin-facing inventory of every configuration layer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

ConfigurationLayerId = Literal[
    "deployment",
    "global",
    "user",
    "specialized",
    "frontend",
]


class ConfigurationEntry(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    id: str
    key: str
    label: str
    layer: ConfigurationLayerId
    value: Any = None
    default_value: Any = Field(default=None, alias="defaultValue")
    source: str
    description: str = ""
    sensitive: bool = False
    configured: bool = False
    editable: bool = False
    restart_required: bool = Field(default=False, alias="restartRequired")
    owner_id: str | None = Field(default=None, alias="ownerId")


class ConfigurationLayer(BaseModel):
    id: ConfigurationLayerId
    label: str
    description: str
    entries: list[ConfigurationEntry] = Field(default_factory=list)


class ConfigurationCatalogResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    schema_version: int = Field(default=1, alias="schemaVersion")
    layers: list[ConfigurationLayer]
