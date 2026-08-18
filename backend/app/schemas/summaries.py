"""Request/response models for the summaries endpoints.

First family converted under B1 of `docs/architecture-simplification-plan.md`,
and the reference for the rest. Before this, every summaries route returned
``dict[str, Any]``, which OpenAPI renders as ``{"additionalProperties": true}``
and the TypeScript generator as ``Record<string, unknown>`` — so the frontend
hand-maintained its own `Summary` interface with no compiler-enforced link to
the server.

**Why these models declare only part of the payload.** A summary is a fixed
base plus an open-ended ``extra`` JSON column holding UI flags that come and go
(``isStarred``, ``autoPublish``, ``note``, …). Enumerating ``extra`` would
either be wrong tomorrow or silently drop keys today, so these models declare
the columns that are always present and let the rest through via
``extra="allow"``.

The corpus-sized fields (``citedPosts``, ``promptText``, ``chatMessages``) are
not in ``extra`` — they are a second table, ``tg_summary_payloads``. That is a
storage split only: ``SummaryResponse`` reassembles them, so the detail payload
looks exactly as it always did. See the ``SummaryPayload`` model docstring for
the measurements.

That is a deliberate trade: the wire format stays **byte-identical** — a key
that is absent today stays absent rather than becoming an explicit ``null`` —
while the always-present fields become typed and the operation gains a real
``$ref`` instead of a bare object. Conditional keys such as ``promptExcerpt``
are documented here rather than declared, precisely because declaring them
would change the payload.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class SummaryResponse(BaseModel):
    """One summary in the full projection, as `summary_to_camel` builds it.

    Carries every key of ``extra``, including the corpus-sized
    ``citedPosts`` / ``promptText`` / ``chatMessages``.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    id: str
    text: str
    channels: list[str] = Field(default_factory=list)
    start_date: int = Field(default=0, alias="startDate")
    end_date: int = Field(default=0, alias="endDate")
    language: str = "English"
    model: str | None = None
    post_count: int | None = Field(default=None, alias="postCount")
    timestamp: int = 0


class SummaryListItemResponse(SummaryResponse):
    """List projection, as `summary_to_camel_light` builds it.

    Omits the three corpus-sized fields — the list query never opens the table
    they live in — and adds ``chatMessageCount``, which the service always
    sets. ``promptExcerpt`` is *not* declared: it appears only when the summary
    actually has prompt text, and declaring it would emit
    ``"promptExcerpt": null`` for every summary that has none. It still reaches
    the client through ``extra="allow"``.
    """

    chat_message_count: int = Field(default=0, alias="chatMessageCount")


class SummaryUpsertRequest(BaseModel):
    """Body for ``PUT /data/summaries/{id}``.

    Intentionally permissive. The service accepts both camelCase and snake_case
    for the base columns, routes anything unrecognised into ``extra``, and
    treats an explicit ``null`` as "remove this key from ``extra``" — behaviour
    a stricter model would break. Declaring the base fields still documents the
    shape and gives the generated client something better than ``unknown``.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    text: str | None = None
    channels: list[str] | None = None
    start_date: int | None = Field(default=None, alias="startDate")
    end_date: int | None = Field(default=None, alias="endDate")
    language: str | None = None
    model: str | None = None
    post_count: int | None = Field(default=None, alias="postCount")
    timestamp: int | None = None

    def to_service_body(self) -> dict[str, Any]:
        """The raw payload as the service expects it.

        ``upsert_summary`` distinguishes an absent key from an explicit
        ``null``, so this dumps by alias and excludes unset fields rather than
        materialising defaults.
        """
        return self.model_dump(by_alias=True, exclude_unset=True)
