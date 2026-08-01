"""Response models for bot credentials and their chat destinations.

Part of B6b.

**The security property these models encode:** a bot token is never on the wire.
`BotCredentialResponse` carries `hasToken`, a boolean derived from whether
`token_encrypted` is populated — the token itself is stored encrypted and only
decrypted server-side at publish time. A closed model is doing real work here:
it makes leaking the token a *schema* change, visible in review and in the
generated client, rather than something a stray `**row` could do silently.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class BotCredentialResponse(BaseModel):
    """A stored bot, without its token."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    #: Whether a token is stored. **Never the token.** See the module docstring.
    has_token: bool = Field(default=False, alias="hasToken")
    username: str | None = None
    photo_url: str | None = Field(default=None, alias="photoUrl")
    last_validated: int | None = Field(default=None, alias="lastValidated")


class ChatDestinationResponse(BaseModel):
    """A chat a summary can be published to."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    name: str
    chat_id: str = Field(alias="chatId")


class MigrateCredentialsResponse(BaseModel):
    """Result of importing credentials from the client's local store.

    Returns the ids as well as the count so the caller can reconcile which of
    its local entries were accepted — entries without an id or token are skipped
    silently rather than failing the batch.
    """

    migrated: int = 0
    ids: list[str] = Field(default_factory=list)
