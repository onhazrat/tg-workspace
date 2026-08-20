"""The unified artifact list.

Its own module rather than an addition to an existing family, because it spans
four families and belongs to none of them. `/data/tag-runs` living inside
`routes/data/summaries.py` is what that looks like when it goes the other way.
"""

from typing import Literal

from fastapi import APIRouter, Query
from pydantic import TypeAdapter

from app.api.deps import CurrentUser, SessionDep
from app.schemas.artifacts import ArtifactListItemResponse
from app.services.artifacts import (
    DEFAULT_ARTIFACT_PAGE_SIZE,
    MAX_ARTIFACT_PAGE_SIZE,
)
from app.services.artifacts import (
    list_artifacts as list_artifacts_impl,
)

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
    _current_user: CurrentUser,
    kind: Literal["summary", "chat", "tag", "discovery"] | None = Query(default=None),
    search: str | None = Query(default=None),
    starred: bool = Query(default=False),
    limit: int = Query(
        default=DEFAULT_ARTIFACT_PAGE_SIZE, ge=1, le=MAX_ARTIFACT_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
) -> list[ArtifactListItemResponse]:
    """One newest-first page of every saved artifact, whatever its kind.

    A `UNION ALL` over four tables projecting **named columns only**. It must not
    open `tg_summary_payloads` or `tg_chat_session_payloads`, and must not select
    the corpus-sized columns of `tg_tag_runs` / `tg_discover_reports` — pinned by
    `tests/services/test_artifact_list_payload_cost.py`.

    `search` deliberately does not reach summary prompt bodies; that would mean
    opening a payload table. `/data/summaries?search=` still does.
    """
    return [
        _ARTIFACT_ADAPTER.validate_python(row)
        for row in list_artifacts_impl(
            session,
            kind=kind,
            search=search,
            starred=starred,
            limit=limit,
            offset=offset,
            user_id=_current_user.id,
        )
    ]
