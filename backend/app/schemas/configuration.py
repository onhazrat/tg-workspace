"""Admin-facing inventory of every configuration layer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ConfigurationLayerId = Literal[
    "deployment",
    "global",
    "user",
    "specialized",
    "frontend",
]


class ConfigurationEntry(BaseModel):
    id: str
    key: str
    label: str
    layer: ConfigurationLayerId
    value: Any = None
    default_value: Any = None
    source: str
    description: str = ""
    sensitive: bool = False
    configured: bool = False
    editable: bool = False
    restart_required: bool = False
    owner_id: str | None = None


class ConfigurationLayer(BaseModel):
    id: ConfigurationLayerId
    label: str
    description: str
    entries: list[ConfigurationEntry] = Field(default_factory=list)


class ConfigurationCatalogResponse(BaseModel):
    schema_version: int = 1
    layers: list[ConfigurationLayer]
