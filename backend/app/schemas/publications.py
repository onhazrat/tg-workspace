"""Request and response models for a Summary's Publication (SUMTAB-09)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PublicationOptions(BaseModel):
    """What the publish panel chose; both off unless asked, as a send is."""

    model_config = ConfigDict(populate_by_name=True)

    include_metadata: bool = Field(default=False, alias="includeMetadata")
    metadata_in_first_part: bool = Field(default=False, alias="metadataInFirstPart")


class PublicationSendRequest(PublicationOptions):
    bot_id: str = Field(alias="botId")
    destination_id: str = Field(alias="destinationId")


class PublicationPartResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["metadata", "summary", "both"]
    #: The markdown that goes through the entity parser on its way out.
    text: str
    #: UTF-16 length after entity parsing, the number Telegram holds to its limit.
    length: int
    #: The cut ending this Part fell inside a word or a formatting pair.
    cut_inside: bool = Field(alias="cutInside")


class PublicationPlanResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    parts: list[PublicationPartResponse]
    #: The generated metadata, for the editor's rows and its reset.
    default_metadata: str = Field(alias="defaultMetadata")
    limit: int


class PublicationSendResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["success", "failed"]
    error: str | None
    parts_sent: int = Field(alias="partsSent")
    parts_total: int = Field(alias="partsTotal")
