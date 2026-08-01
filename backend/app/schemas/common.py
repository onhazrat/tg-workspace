"""Response models shared across resource families.

Extracted during B1 (`docs/architecture-simplification-plan.md`) because the
same shapes recur in nearly every family — summaries, tag-runs, bot-credentials,
chat-destinations and the log endpoints all answer a delete with
``{"status": "deleted"}``. Declaring it once keeps the generated client from
growing a near-identical anonymous object per endpoint.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class StatusResponse(BaseModel):
    """A bare outcome acknowledgement, e.g. ``{"status": "deleted"}``."""

    status: str


class AppSettingResponse(BaseModel):
    """A settings row: `{"key": …, "value": {…}}`.

    Shipped with B6b. `value` stays an open JSON object on purpose — the
    settings surface is a bag of sections whose shapes are owned by their own
    loaders (`jobs`, `sync`, `retention`, `translation`, `network`), and pinning
    them here would put five unrelated schemas behind one endpoint. The
    *envelope* is what callers depend on, and that is now typed.
    """

    key: str
    value: dict[str, Any] = Field(default_factory=dict)


class ImportDataResponse(BaseModel):
    """Per-section row counts from an import.

    Only sections present in the document appear, so this is a mapping rather
    than a model with a field per table — importing a channels-only export must
    not report zeros for everything else.
    """

    imported: dict[str, int] = Field(default_factory=dict)
