"""A Summary's Publication: the plan the publish panel previews (SUMTAB-09)."""

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.models_tg import Summary
from app.schemas.publications import (
    PublicationOptions,
    PublicationPartResponse,
    PublicationPlanResponse,
)
from app.services.publication_parts import TELEGRAM_MESSAGE_LIMIT
from app.services.publications import plan_publication
from app.services.summaries import SUMMARY_NOT_FOUND
from app.services.tenancy import assert_owner

router = APIRouter()


# A read expressed as POST, so the options travel in a body; it writes nothing
# and sends nothing, which is why View-as may call it unelevated.
@router.post("/summaries/{summary_id}/publication/plan")
def plan_summary_publication(
    summary_id: str,
    body: PublicationOptions,
    session: SessionDep,
    current_user: CurrentUser,
) -> PublicationPlanResponse:
    """The Parts a Publication of this Summary would send, and its default metadata."""
    summary = session.get(Summary, summary_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    assert_owner(summary.user_id, current_user.id, detail=SUMMARY_NOT_FOUND)
    plan = plan_publication(
        session,
        summary,
        user_id=current_user.id,
        include_metadata=body.include_metadata,
        metadata_in_first_part=body.metadata_in_first_part,
    )
    return PublicationPlanResponse(
        parts=[
            PublicationPartResponse(
                kind=p.kind, text=p.text, length=p.length, cutInside=p.cut_inside
            )
            for p in plan.parts
        ],
        defaultMetadata=plan.default_metadata,
        limit=TELEGRAM_MESSAGE_LIMIT,
    )
