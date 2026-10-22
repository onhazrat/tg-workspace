"""The unified artifact list.

Its own module rather than an addition to an existing family, because it spans
four families and belongs to none of them. `/data/tag-runs` living inside
`routes/data/summaries.py` is what that looks like when it goes the other way.
"""

from typing import Annotated

from fastapi import APIRouter, Query
from pydantic import TypeAdapter

from app.api.deps import CurrentUser, SessionDep
from app.schemas.artifacts import (
    ArtifactCountsQuery,
    ArtifactCountsResponse,
    ArtifactListItemResponse,
    ArtifactPageQuery,
    ArtifactSpreadQuery,
    ArtifactSpreadResponse,
)
from app.services.artifacts import artifact_spread, count_artifacts
from app.services.artifacts import (
    list_artifacts as list_artifacts_impl,
)
from app.services.logs import resolve_log_bound

router = APIRouter()

#: An `Annotated` union alias has no `.model_validate`, so validation goes
#: through an adapter. A `TypeAdapter` is not a `BaseModel` subclass, so
#: `test_route_module_hygiene` does not read it as a model declared in a route
#: module.
_ARTIFACT_ADAPTER: TypeAdapter[ArtifactListItemResponse] = TypeAdapter(
    ArtifactListItemResponse
)


@router.get("/artifacts")
def list_artifacts(
    session: SessionDep,
    current_user: CurrentUser,
    query: Annotated[ArtifactPageQuery, Query()],
) -> list[ArtifactListItemResponse]:
    """One page of every saved artifact, whatever its kind, newest Written first.

    A `UNION ALL` over four tables projecting **named columns only**. It must not
    open `tg_summary_payloads` or `tg_chat_session_payloads`, and must not select
    the corpus-sized columns of `tg_tag_runs` / `tg_discover_reports` — pinned by
    `tests/services/test_artifact_list_payload_cost.py`.

    `search` deliberately does not reach summary prompt bodies; that would mean
    opening a payload table. `/data/summaries?search=` still does.

    `mode`, `start` and `end` bound `moment`: when an artifact was Written,
    `[start, end)`, or its Analysis window, which matches when it overlaps the
    bound. `sort` is Written or the window's start; a missing window sorts last
    either way.
    """
    return [
        _ARTIFACT_ADAPTER.validate_python(row)
        for row in list_artifacts_impl(
            session,
            kind=query.kind,
            search=query.search,
            starred=query.starred,
            status=query.status,
            moment=query.moment,
            bound=resolve_log_bound(query.bound()),
            sort=query.sort,
            descending=query.descending,
            limit=query.limit,
            offset=query.offset,
            user_id=current_user.id,
        )
    ]


# Declared after the list, whose path has no parameter to take "counts".
@router.get("/artifacts/counts")
def count_artifacts_route(
    session: SessionDep,
    current_user: CurrentUser,
    query: Annotated[ArtifactCountsQuery, Query()],
) -> ArtifactCountsResponse:
    """The list's total, and how many each Kind and Status choice would show.

    Each Kind is counted under every filter but Kind, each Status under every
    filter but Status, and the total under all of them.
    """
    return ArtifactCountsResponse.model_validate(
        count_artifacts(
            session,
            kind=query.kind,
            search=query.search,
            starred=query.starred,
            status=query.status,
            moment=query.moment,
            bound=resolve_log_bound(query.bound()),
            user_id=current_user.id,
        )
    )


@router.get("/artifacts/spread")
def get_artifact_spread_route(
    session: SessionDep,
    current_user: CurrentUser,
    query: Annotated[ArtifactSpreadQuery, Query()],
) -> ArtifactSpreadResponse:
    """When artifacts were Written, or their windows started: 32 bars over epoch ms.

    Under every filter but the Time bound, so the editor shows what lies around
    it. Under `window`, an artifact with no window is left out. A zoom (`lo`,
    `hi`) bins only that range; `total`, `min`, `max` and `median` stay the
    whole spread's.
    """
    spread = artifact_spread(
        session,
        kind=query.kind,
        search=query.search,
        starred=query.starred,
        status=query.status,
        moment=query.moment,
        zoom=query.zoom,
        user_id=current_user.id,
    )
    return ArtifactSpreadResponse.model_validate(spread, from_attributes=True)
