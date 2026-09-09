"""An Account's AI Keys (BYOK-01).

Beside `credentials.py` deliberately: the two families are the same object, a
secret somebody pasted in and never sees again, and keeping them adjacent is
what makes the twin guard in `test_credential_tenancy_scoping.py` obvious rather
than clever.

Thin, like every route module here. The rule about who pays lives in
`services/ai_keys.resolve_ai_key`, not in any handler.
"""

from typing import Any

from fastapi import APIRouter

from app.ai.registry import forget_cached_models, validate_credential
from app.api.deps import CurrentUser, SessionDep
from app.core.secrets import decrypt_token
from app.models_tg import AICredential
from app.schemas.ai_keys import AIKeyResponse, AIKeySaveResponse
from app.schemas.common import StatusResponse
from app.services.ai_keys import (
    delete_ai_key as delete_ai_key_impl,
)
from app.services.ai_keys import (
    key_to_camel,
    list_ai_keys,
    record_validation,
    upsert_ai_key,
)

router = APIRouter()


@router.get("/ai-keys")
def list_ai_credentials(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[AIKeyResponse]:
    return [
        AIKeyResponse.model_validate(row)
        for row in list_ai_keys(session, user_id=current_user.id)
    ]


# The row is written **before** the Provider check and kept whichever way the
# check goes. A Provider that is briefly unreachable would otherwise throw away
# a key somebody has just pasted, and the state a failed check leaves behind —
# stored, `lastValidated` null — is exactly the state the settings surface
# already knows how to flag.
#
# In a comment rather than a docstring: a handler docstring becomes the
# `openapi.json` description and a JSDoc block in the generated client, so
# internal reasoning would ship to every consumer of the SDK.
@router.put("/ai-keys/{key_id}")
async def upsert_ai_credential(
    key_id: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> AIKeySaveResponse:
    """Save an AI key and validate it against its provider."""
    row = upsert_ai_key(session, key_id, body, user_id=current_user.id)
    # Read every attribute the provider call needs into plain values *before*
    # awaiting it. `expire_on_commit` is on, so touching `row.provider` after
    # the save's commit re-opens a transaction — which would then sit `idle in
    # transaction` for the whole network round-trip, pinning the xmin horizon.
    # That is the invariant CLAUDE.md states, and the one that left
    # `tg_sync_meta` with 10 live rows and 4,743 dead.
    stored_id, provider, secret, base_url = (
        row.id,
        row.provider,
        decrypt_token(row.key_encrypted),
        row.base_url,
    )
    session.close()

    # A save can move the base URL, and a cached catalogue outliving that edit
    # is a dropdown offering models the new endpoint has never heard of.
    forget_cached_models(f"{stored_id}|")

    valid = await validate_credential(
        provider=provider, api_key=secret, base_url=base_url
    )

    record_validation(session, stored_id, valid=valid)
    saved = session.get(AICredential, stored_id)
    assert saved is not None  # noqa: S101  (just written, in this transaction)
    return AIKeySaveResponse(
        key=AIKeyResponse.model_validate(key_to_camel(saved)), validated=valid
    )


@router.delete("/ai-keys/{key_id}")
def delete_ai_credential(
    key_id: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> StatusResponse:
    delete_ai_key_impl(session, key_id, user_id=current_user.id)
    return StatusResponse(status="deleted")
