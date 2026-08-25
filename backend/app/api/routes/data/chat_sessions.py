"""Saved chat sessions.

One module per resource family, per `data/__init__.py`. The parent router
supplies the `/data` prefix and the `data` tag, so operation ids are
`data-<function_name>` and the function names below are API surface.
"""

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, SessionDep
from app.schemas.chat_sessions import (
    ChatSessionListItemResponse,
    ChatSessionResponse,
    ChatSessionUpsertRequest,
)
from app.schemas.common import StatusResponse
from app.services.chat_sessions import (
    DEFAULT_CHAT_SESSION_PAGE_SIZE,
    MAX_CHAT_SESSION_PAGE_SIZE,
)
from app.services.chat_sessions import (
    delete_chat_session as delete_chat_session_impl,
)
from app.services.chat_sessions import (
    get_chat_session as get_chat_session_impl,
)
from app.services.chat_sessions import (
    list_chat_sessions as list_chat_sessions_impl,
)
from app.services.chat_sessions import (
    upsert_chat_session as upsert_chat_session_impl,
)
from app.services.sync_meta import touch_sync

router = APIRouter()


@router.get("/chat-sessions")
def list_chat_sessions(
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(
        default=DEFAULT_CHAT_SESSION_PAGE_SIZE, ge=1, le=MAX_CHAT_SESSION_PAGE_SIZE
    ),
    offset: int = Query(default=0, ge=0),
    search: str | None = Query(default=None),
) -> list[ChatSessionListItemResponse]:
    """List in the light projection — see `chat_session_to_camel_light`.

    `search` matches title/channels/model/note in SQL. It does not reach the
    transcript; the title already carries the first user message.
    """
    return [
        ChatSessionListItemResponse.model_validate(row)
        for row in list_chat_sessions_impl(
            session, limit=limit, offset=offset, search=search, user_id=current_user.id
        )
    ]


@router.get("/chat-sessions/{chat_session_id}")
def get_chat_session(
    chat_session_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> ChatSessionResponse:
    """Full chat session including the transcript."""
    return ChatSessionResponse.model_validate(
        get_chat_session_impl(session, chat_session_id, user_id=current_user.id)
    )


@router.put("/chat-sessions/{chat_session_id}")
def upsert_chat_session(
    chat_session_id: str,
    body: ChatSessionUpsertRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> ChatSessionResponse:
    result = upsert_chat_session_impl(
        session, chat_session_id, body.to_service_body(), user_id=current_user.id
    )
    touch_sync(session, "chat_sessions")
    return ChatSessionResponse.model_validate(result)


@router.delete("/chat-sessions/{chat_session_id}")
def delete_chat_session(
    chat_session_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> StatusResponse:
    delete_chat_session_impl(session, chat_session_id, user_id=current_user.id)
    touch_sync(session, "chat_sessions")
    return StatusResponse(status="deleted")
