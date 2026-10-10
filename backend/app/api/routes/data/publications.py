"""A Summary's Publication: the plan the publish panel previews (SUMTAB-09)."""

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.models_tg import Summary
from app.schemas.publications import (
    PublicationOptions,
    PublicationPartResponse,
    PublicationPlanResponse,
    PublicationSendRequest,
    PublicationSendResponse,
)
from app.services.publication_parts import TELEGRAM_MESSAGE_LIMIT
from app.services.publications import (
    DestinationNotFound,
    plan_publication,
    send_publication,
)
from app.services.publish import BotCredentialNotFound
from app.services.summaries import SUMMARY_NOT_FOUND
from app.services.tenancy import assert_owner, assert_owner_on_write

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


# Sends as the caller's bot, so View-as needs the spend tier for it. A Part
# Telegram refuses is a 200 with `status: failed`: the publish log has the row.
@router.post("/summaries/{summary_id}/publication")
async def send_summary_publication(
    summary_id: str,
    body: PublicationSendRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> PublicationSendResponse:
    """Plan this Summary's Publication and send exactly those Parts."""
    summary = session.get(Summary, summary_id)
    if summary is None:
        raise HTTPException(status_code=404, detail=SUMMARY_NOT_FOUND)
    assert_owner_on_write(summary.user_id, current_user.id, detail=SUMMARY_NOT_FOUND)
    try:
        outcome = await send_publication(
            session,
            summary,
            user_id=current_user.id,
            bot_id=body.bot_id,
            destination_id=body.destination_id,
            include_metadata=body.include_metadata,
            metadata_in_first_part=body.metadata_in_first_part,
        )
    except (BotCredentialNotFound, DestinationNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return PublicationSendResponse(
        status=outcome.status,
        error=outcome.error,
        partsSent=outcome.parts_sent,
        partsTotal=outcome.parts_total,
    )
