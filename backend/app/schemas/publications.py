"""Request and response models for a Summary's Publication (SUMTAB-09)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class PublicationOptions(BaseModel):
    """What the publish panel chose; both off unless asked, as a send is."""

    model_config = ConfigDict(populate_by_name=True)

    include_metadata: bool = Field(default=False, alias="includeMetadata")
    metadata_in_first_part: bool = Field(default=False, alias="metadataInFirstPart")


class PublicationSendRequest(PublicationOptions):
    """A new Publication names its bot and destination; a resume names only
    the partial Publication, whose stored bot, chat and Parts it keeps."""

    bot_id: str | None = Field(default=None, alias="botId")
    destination_id: str | None = Field(default=None, alias="destinationId")
    publication_id: str | None = Field(default=None, alias="publicationId")

    @model_validator(mode="after")
    def _names_a_target(self) -> PublicationSendRequest:
        if self.publication_id is None and not (self.bot_id and self.destination_id):
            raise ValueError("botId and destinationId are required")
        return self


class TelegramSegmentResponse(BaseModel):
    """A run of a Part as Telegram shows it, from the parser the send uses."""

    kind: Literal["plain", "bold", "italic", "link"]
    text: str
    #: Set on a link, null otherwise.
    url: str | None


class PublicationPartResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    kind: Literal["metadata", "summary", "both"]
    #: The markdown that goes through the entity parser on its way out.
    text: str
    #: UTF-16 length after entity parsing, the number Telegram holds to its limit.
    length: int
    #: The cut ending this Part fell inside a word or a formatting pair.
    cut_inside: bool = Field(alias="cutInside")
    #: `text` as Telegram will show it, for the preview.
    segments: list[TelegramSegmentResponse]


class MetadataRowResponse(BaseModel):
    """One generated metadata row, for the panel's checklist."""

    #: What `metadataOmittedRows` names to leave this row out.
    key: str
    label: str
    value: str
    sent: bool


class PartialPublicationResponse(BaseModel):
    """The Summary's latest Publication, stopped after some of its Parts."""

    model_config = ConfigDict(populate_by_name=True)

    #: The publish-log row; given back as `publicationId` to send the rest.
    id: str
    parts_sent: int = Field(alias="partsSent")
    parts_total: int = Field(alias="partsTotal")


class PublicationPlanResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    parts: list[PublicationPartResponse]
    #: The generated metadata without the rows the Summary leaves out, for
    #: edit-as-text and its reset.
    default_metadata: str = Field(alias="defaultMetadata")
    metadata_rows: list[MetadataRowResponse] = Field(alias="metadataRows")
    limit: int
    #: Set when the Summary's latest Publication is partial, for the panel's
    #: "Send the remaining K".
    partial: PartialPublicationResponse | None


class PublicationSendResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    status: Literal["success", "failed"]
    error: str | None
    parts_sent: int = Field(alias="partsSent")
    parts_total: int = Field(alias="partsTotal")
