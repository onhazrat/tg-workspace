"""Response models for an Account's AI Keys (BYOK-01).

**The security property these models encode:** the key is never on the wire.
`AIKeyResponse` carries `hasKey`, a boolean derived from whether
`key_encrypted` is populated — the same shape, and the same argument, as
`BotCredentialResponse.hasToken`. A closed model is doing real work: it makes
leaking the secret a *schema* change, visible in review and in the generated
client, rather than something a stray `**row` could do silently.
"""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class AIKeyResponse(BaseModel):
    """A stored AI Key, without its secret."""

    model_config = ConfigDict(populate_by_name=True)

    id: str
    label: str
    #: `gemini` or `openai_compatible`. BYOK-01 implements the first only.
    provider: str
    base_url: str | None = Field(default=None, alias="baseUrl")
    #: Whether a secret is stored. **Never the secret.** See the module docstring.
    has_key: bool = Field(default=False, alias="hasKey")
    #: Milliseconds since the epoch when a Provider last accepted this Key, or
    #: `null` for one never checked *or* one a Provider has since rejected. The
    #: settings surface reads the null to flag it; the two cases share a fix.
    last_validated: int | None = Field(default=None, alias="lastValidated")


class AIKeySaveResponse(BaseModel):
    """A saved Key, plus what the save-time validation found.

    `validated` is redundant with `key.lastValidated` and is here anyway,
    because the form needs to say "we tried and your provider said no" in the
    moment. A `null` timestamp alone cannot distinguish that from "not checked".
    """

    model_config = ConfigDict(populate_by_name=True)

    key: AIKeyResponse
    validated: bool
