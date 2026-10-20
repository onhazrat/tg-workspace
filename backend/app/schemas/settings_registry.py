"""The Settings page's wire shapes (SET-02).

Closed models: a row's value is typed as a JSON value rather than an open
dictionary, so the generated client keeps every field it can name.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

SettingRowScope = Literal["browser", "account", "deployment", "env", "code"]
SettingRowType = Literal["boolean", "integer", "number", "string", "enum", "json"]


class SettingOption(BaseModel):
    value: str
    label: str


class SettingRow(BaseModel):
    """One Setting as the calling Account sees it."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    title: str
    description: str
    topic: str
    scope: SettingRowScope
    type: SettingRowType
    options: list[SettingOption] = Field(default_factory=list)
    min: float | None = None
    max: float | None = None
    value: JsonValue = None
    #: What a reset returns the row to. Null on a browser row, whose default
    #: the frontend schema holds.
    default: JsonValue = None
    default_source: Literal["code", "env", "deployment"] = Field(alias="defaultSource")
    modified: bool
    can_edit: bool = Field(alias="canEdit")
    #: Why `canEdit` is false, in the Account's words.
    lock_reason: str | None = Field(alias="lockReason")
    applies: Literal["now", "restart", "rebuild", "deploy"] = "now"
    #: Where the value is kept, for display.
    storage: str
    #: The settings key and field a declared Setting is kept in (its storage
    #: key, for a browser one), for the page to act on; null on Configuration.
    key: str | None = None
    field: str | None = None
    sensitive: bool = False
    env_name: str | None = Field(default=None, alias="envName")
    source_ref: str | None = Field(default=None, alias="sourceRef")


class SettingTopic(BaseModel):
    id: str
    title: str


class SettingsRegistryResponse(BaseModel):
    topics: list[SettingTopic]
    rows: list[SettingRow]
    #: The caller's Permissions, so the page shows the panels they can use.
    permissions: list[str]


class SettingWriteRequest(BaseModel):
    """`{"value": …}` to change a Setting, `{"reset": true}` to reset it."""

    value: JsonValue = None
    reset: bool = False
