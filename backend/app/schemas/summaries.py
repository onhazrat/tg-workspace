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

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.scope import FrozenScope, ScopeSubmission


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
    #: The Scope this summary was frozen at, or ``null`` on a row that predates
    #: AW-05 (which AW-07 deletes rather than backfills). Declared — unlike the
    #: conditional keys this module leaves to ``extra`` — because the client has
    #: to render it, and a ``FrozenScope | undefined`` is the type that says so.
    scope: FrozenScope | None = None


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


#: How a derived Scope relates to the Artifact it was read off.
#:
#: `successor` opens where the predecessor closed and runs the same Duration
#: forward, which is auto-regeneration. `repeat` is the predecessor's own window
#: again, which is the Regenerate button.
DerivationMode = Literal["successor", "repeat"]


class SummaryDerivation(BaseModel):
    """The Artifact a submission reads its Scope off, and how."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    summary_id: str = Field(alias="summaryId")
    mode: DerivationMode


class SummarySubmitRequest(BaseModel):
    """Body for ``POST /data/summaries`` — opens a summary at a frozen Scope."""

    model_config = ConfigDict(populate_by_name=True, extra="forbid")

    #: Client-chosen, for the reason the interactive path already chose one: it
    #: is the whole primary key of ``tg_summaries``, so it is a UUID and a
    #: collision is a 409 rather than a silent merge into somebody else's row.
    id: str
    #: The Scope this Summary is opened at, stated in full. Exactly one of this
    #: and `successorOf`.
    scope: ScopeSubmission | None = None
    #: The Summary this one reads its Scope off, when the Scope is *derived*
    #: rather than stated (AW-06).
    #:
    #: Both derivations produce a window whose end is routinely in the future,
    #: which `resolve_analysis_window` refuses — deliberately — for anything a
    #: caller states. So a caller that needs one names the Artifact and the
    #: server derives it; see `services/summaries.py::derived_scope`.
    #:
    #: A field on this request rather than a route of its own, because the
    #: question it answers is "where did this submission's Scope come from",
    #: and that belongs to the submission contract the other three families
    #: joined in AW-06. A second route would have been a second way to open a
    #: Summary, with its own id handling, its own 409 and its own drift.
    #:
    #: A small object rather than a bare id, because there are two derivations
    #: and a caller has to say which. A bare `successorOf` was the first cut and
    #: it forced the Regenerate button back onto the stated-window door, where
    #: its own recorded end is in the future and is refused.
    derived_from: SummaryDerivation | None = Field(default=None, alias="derivedFrom")
    language: str = "English"
    model: str | None = None
    post_count: int | None = Field(default=None, alias="postCount")
    #: The small UI flags a new summary starts with (``sendMetadata``,
    #: ``aiKeyId``, ``postSearch``, …). Open for the same reason
    #: ``SummaryResponse`` is: they come and go, and an allowlist here would
    #: silently drop the next one.
    extra: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _exactly_one_scope_source(self) -> SummarySubmitRequest:
        """A Scope is stated or derived, never both and never neither.

        Both would need a precedence rule, and a precedence rule over "which
        Posts did this use" is the ambiguity the whole Analysis-window effort
        was written against. Neither is a submission with no Scope, which is
        the thing AW-05 made impossible.
        """
        if (self.scope is None) == (self.derived_from is None):
            raise ValueError(
                "Send exactly one of `scope` (the window stated in full) or "
                "`derivedFrom` (the Summary this one reads its window off)."
            )
        return self


class SummaryUpsertRequest(BaseModel):
    """Body for ``PUT /data/summaries/{id}``.

    Intentionally permissive. The service accepts both camelCase and snake_case
    for the base columns, routes anything unrecognised into ``extra``, and
    treats an explicit ``null`` as "remove this key from ``extra``" — behaviour
    a stricter model would break. Declaring the base fields still documents the
    shape and gives the generated client something better than ``unknown``.

    **It no longer carries the window or the channels** (AW-05). Those are the
    Scope the text was produced from, frozen at submission; a client that
    round-trips a list item back through here must not be able to move them,
    and a field that is not on the request is the version of that rule nobody
    has to remember.
    """

    model_config = ConfigDict(extra="allow", populate_by_name=True)

    text: str | None = None
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
