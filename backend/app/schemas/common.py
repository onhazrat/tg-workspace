"""Response models shared across resource families.

Extracted during B1 (`docs/architecture-simplification-plan.md`) because the
same shapes recur in nearly every family — summaries, tag-runs, bot-credentials,
chat-destinations and the log endpoints all answer a delete with
``{"status": "deleted"}``. Declaring it once keeps the generated client from
growing a near-identical anonymous object per endpoint.
"""

from __future__ import annotations

from typing import Any, Self

from pydantic import BaseModel, Field, model_validator


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


class ZoomRequest(BaseModel):
    """A zoomed spread: bin only `[lo, hi]`, the whole spread's fields kept.

    Both ends or neither; neither is the whole spread.
    """

    lo: float | None = None
    hi: float | None = None

    @model_validator(mode="after")
    def _a_range(self) -> Self:
        if (self.lo is None) != (self.hi is None):
            raise ValueError("Give both lo and hi, or neither")
        if self.lo is not None and self.hi is not None and self.lo >= self.hi:
            raise ValueError("lo must be below hi")
        return self

    @property
    def zoom(self) -> tuple[float, float] | None:
        return None if self.lo is None or self.hi is None else (self.lo, self.hi)
