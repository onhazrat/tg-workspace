"""Response models shared across resource families.

Extracted during B1 (`docs/architecture-simplification-plan.md`) because the
same shapes recur in nearly every family — summaries, tag-runs, bot-credentials,
chat-destinations and the log endpoints all answer a delete with
``{"status": "deleted"}``. Declaring it once keeps the generated client from
growing a near-identical anonymous object per endpoint.
"""

from __future__ import annotations

from pydantic import BaseModel


class StatusResponse(BaseModel):
    """A bare outcome acknowledgement, e.g. ``{"status": "deleted"}``."""

    status: str
