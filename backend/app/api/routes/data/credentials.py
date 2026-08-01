"""Bot credentials and the chat destinations they publish to.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.
"""

from typing import Any

from fastapi import APIRouter

from app.api.deps import CurrentUser, SessionDep
from app.schemas.common import StatusResponse
from app.schemas.credentials import (
    BotCredentialResponse,
    ChatDestinationResponse,
    MigrateCredentialsResponse,
)
from app.services.credentials import (
    delete_bot_credential as delete_bot_credential_impl,
)
from app.services.credentials import (
    delete_chat_destination as delete_chat_destination_impl,
)
from app.services.credentials import (
    list_bot_credentials as list_bot_credentials_impl,
)
from app.services.credentials import (
    list_chat_destinations as list_chat_destinations_impl,
)
from app.services.credentials import (
    migrate_bot_credentials as migrate_bot_credentials_impl,
)
from app.services.credentials import (
    upsert_bot_credential as upsert_bot_credential_impl,
)
from app.services.credentials import (
    upsert_chat_destination as upsert_chat_destination_impl,
)

router = APIRouter()


@router.get("/bot-credentials")
def list_bot_credentials(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[BotCredentialResponse]:
    return [
        BotCredentialResponse.model_validate(row)
        for row in list_bot_credentials_impl(session)
    ]


@router.put("/bot-credentials/{bot_id}")
def upsert_bot_credential(
    bot_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> BotCredentialResponse:
    return BotCredentialResponse.model_validate(
        upsert_bot_credential_impl(session, bot_id, body, user_id=_current_user.id)
    )


@router.delete("/bot-credentials/{bot_id}")
def delete_bot_credential(
    bot_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> StatusResponse:
    delete_bot_credential_impl(session, bot_id)
    return StatusResponse(status="deleted")


@router.post("/bot-credentials/migrate")
def migrate_bot_credentials(
    body: list[dict[str, Any]],
    session: SessionDep,
    _current_user: CurrentUser,
) -> MigrateCredentialsResponse:
    return MigrateCredentialsResponse.model_validate(
        migrate_bot_credentials_impl(session, body, user_id=_current_user.id)
    )


@router.get("/chat-destinations")
def list_chat_destinations(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[ChatDestinationResponse]:
    return [
        ChatDestinationResponse.model_validate(row)
        for row in list_chat_destinations_impl(session)
    ]


@router.put("/chat-destinations/{dest_id}")
def upsert_chat_destination(
    dest_id: str,
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> ChatDestinationResponse:
    return ChatDestinationResponse.model_validate(
        upsert_chat_destination_impl(session, dest_id, body, user_id=_current_user.id)
    )


@router.delete("/chat-destinations/{dest_id}")
def delete_chat_destination(
    dest_id: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> StatusResponse:
    delete_chat_destination_impl(session, dest_id)
    return StatusResponse(status="deleted")
