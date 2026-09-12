"""Saved summaries and tag runs.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.common import StatusResponse
from app.schemas.summaries import (
    SummaryListItemResponse,
    SummaryResponse,
    SummarySubmitRequest,
    SummaryUpsertRequest,
)
from app.schemas.tag_runs import TagRunListItemResponse, TagRunResponse
from app.services.summaries import (
    DEFAULT_SUMMARY_PAGE_SIZE,
    MAX_SUMMARY_PAGE_SIZE,
)
from app.services.summaries import (
    delete_summary as delete_summary_impl,
)
from app.services.summaries import (
    get_summary as get_summary_impl,
)
from app.services.summaries import (
    list_summaries as list_summaries_impl,
)
from app.services.summaries import (
    submit_summary as submit_summary_impl,
)
from app.services.summaries import (
    upsert_summary as upsert_summary_impl,
)
from app.services.sync_meta import touch_sync
from app.services.tag_runs import (
    DEFAULT_TAG_RUN_PAGE_SIZE,
    MAX_TAG_RUN_PAGE_SIZE,
)
from app.services.tag_runs import (
    delete_tag_run as delete_tag_run_impl,
)
from app.services.tag_runs import (
    get_tag_run as get_tag_run_impl,
)
from app.services.tag_runs import (
    list_tag_runs as list_tag_runs_impl,
)
from app.services.tag_runs import (
    upsert_tag_run as upsert_tag_run_impl,
)

router = APIRouter()


@router.get("/summaries")
def list_summaries(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(
        default=DEFAULT_SUMMARY_PAGE_SIZE, ge=1, le=MAX_SUMMARY_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
) -> list[SummaryListItemResponse]:
    """List in the light projection — see `summary_to_camel_light`.

    `search` matches channels/text/promptText/model/note in SQL, so prompt
    bodies stay searchable without being shipped to the client.
    """
    return [
        SummaryListItemResponse.model_validate(row)
        for row in list_summaries_impl(
            session, limit=limit, offset=offset, search=search, user_id=current_user.id
        )
    ]


# AW-05. POST rather than another PUT because it is not idempotent: it freezes
# the Analysis window against the server's current minute, so the same body sent
# twice describes two different windows — and the second is a 409 for that
# reason rather than a merge.
#
# In a comment rather than a docstring: a handler docstring becomes the
# `openapi.json` description and a JSDoc block in the generated client.
@router.post("/summaries")
def submit_summary(
    body: SummarySubmitRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> SummaryResponse:
    """Open a summary at a frozen Scope, before any AI work begins."""
    result = submit_summary_impl(
        session,
        user_id=current_user.id,
        summary_id=body.id,
        submission=body.scope,
        language=body.language,
        model=body.model,
        post_count=body.post_count,
        extra=body.extra,
    )
    touch_sync(session, "summaries")
    return SummaryResponse.model_validate(result)


@router.get("/summaries/{summary_id}")
def get_summary(
    summary_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> SummaryResponse:
    """Full summary including citedPosts/promptText/chatMessages."""
    return SummaryResponse.model_validate(
        get_summary_impl(session, summary_id, user_id=current_user.id)
    )


@router.put("/summaries/{summary_id}")
def upsert_summary(
    summary_id: str,
    body: SummaryUpsertRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> SummaryResponse:
    result = upsert_summary_impl(
        session, summary_id, body.to_service_body(), user_id=current_user.id
    )
    touch_sync(session, "summaries")
    return SummaryResponse.model_validate(result)


@router.delete("/summaries/{summary_id}")
def delete_summary(
    summary_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> StatusResponse:
    delete_summary_impl(session, summary_id, user_id=current_user.id)
    touch_sync(session, "summaries")
    return StatusResponse(status="deleted")


@router.get("/tag-runs")
def list_tag_runs(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(
        default=DEFAULT_TAG_RUN_PAGE_SIZE, ge=1, le=MAX_TAG_RUN_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
) -> list[TagRunListItemResponse]:
    """List runs in the light projection — see `tag_run_to_camel_light`."""
    return [
        TagRunListItemResponse.model_validate(row)
        for row in list_tag_runs_impl(
            session, limit=limit, offset=offset, user_id=current_user.id
        )
    ]


@router.get("/tag-runs/{tag_run_id}")
def get_tag_run(
    tag_run_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> TagRunResponse:
    """Full run including promptText/responseText/suggestions."""
    return TagRunResponse.model_validate(
        get_tag_run_impl(session, tag_run_id, user_id=current_user.id)
    )


@router.put("/tag-runs/{tag_run_id}")
def upsert_tag_run(
    tag_run_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> TagRunResponse:
    result = upsert_tag_run_impl(session, tag_run_id, body, user_id=current_user.id)
    touch_sync(session, "tag_runs")
    return TagRunResponse.model_validate(result)


@router.delete("/tag-runs/{tag_run_id}")
def delete_tag_run(
    tag_run_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> StatusResponse:
    delete_tag_run_impl(session, tag_run_id, user_id=current_user.id)
    touch_sync(session, "tag_runs")
    return StatusResponse(status="deleted")
