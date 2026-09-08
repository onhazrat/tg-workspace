"""An Account's AI Keys, and the one function that answers who pays.

Aggregate. Sole writer of `tg_ai_credentials`, declared as such in
`tests/services/test_service_kinds.py`.

**The rule this module makes true (ADR-016):** an Artifact is paid for by the
Account that asked for it; everything that is not an Artifact is paid for by the
deployment. `resolve_ai_key` is the single place that rule lives, the shape
`lane_for_job` has for enqueueing and `resolve_charge_owner` has for Requests.
`AI_KEY_CALLERS` is the declared inventory of modules that reach a Provider, and
`tests/services/test_ai_key_payment_rule.py` walks the AST to fail an undeclared
twelfth call site rather than letting it silently charge the Operator.

The plaintext key is returned by no route. `key_to_camel` carries `hasKey`, the
way `bot_to_camel` carries `hasToken`, so leaking the secret is a schema change
visible in review and in the generated client.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fastapi import HTTPException
from sqlmodel import Session, select

from app.core.config import settings
from app.core.secrets import decrypt_token, encrypt_token, is_encrypted
from app.models_tg import AICredential, utc_now
from app.services.serialization import normalize_body
from app.services.sync_meta import touch_sync
from app.services.tenancy import assert_owner_on_write, scoped_select

#: The 404 this family answers for a row that is not there. Named rather than
#: repeated so the owner check below refuses a foreign row with the identical
#: string — `assert_owner_on_write` makes that argument at length.
AI_CREDENTIAL_NOT_FOUND = "AI key not found"

#: The Account holds no Key at all. Distinct from the rejection below because
#: they are different problems with different fixes, and the environment-key
#: check this replaces answered both with one string.
AI_KEY_MISSING_DETAIL = "No AI key saved. Add one in Settings to create summaries."

#: The Account holds a Key its Provider would not accept. `last_validated` is
#: NULL for a Key that was never checked as well as for one that was rejected,
#: and both mean the same thing to the person who has to fix it: re-save it.
AI_KEY_REJECTED_DETAIL = (
    "This AI key was rejected by its provider. Re-save it in Settings."
)

#: The deployment has no Operator Key, so the shared work nobody asked for
#: cannot run. Distinct again: this is the Operator's problem, not the
#: Account's, and telling an Account to add a Key would send them to a form that
#: cannot fix it.
OPERATOR_KEY_MISSING_DETAIL = "The deployment has no AI key configured"

#: The Provider kinds. Only `GEMINI` is implemented in BYOK-01; the second kind
#: is BYOK-02, and the column exists now so that a row written today already
#: says which one it is.
GEMINI = "gemini"
OPENAI_COMPATIBLE = "openai_compatible"
PROVIDER_KINDS = frozenset({GEMINI, OPENAI_COMPATIBLE})


class Purpose(StrEnum):
    """What an AI call is for, which is what decides who pays for it.

    An enum rather than a boolean, because the rule is a *classification* and a
    seventh purpose has to be classified rather than defaulted. `CONTEXT.md`'s
    Artifact definition is doing the work: a durable output somebody
    deliberately asked for is charged to whoever asked; the rest is the
    deployment's.
    """

    #: Artifacts. Charged to the requesting Account's own Key.
    SUMMARY = "summary"
    CHAT = "chat"
    TAG = "tag"
    #: Not Artifacts. Charged to the Operator Key, because each writes or reads
    #: a row shared by every Account that follows the Channel: two Accounts on
    #: different Providers would overwrite each other with vectors from
    #: incompatible spaces, and `run_translation_batch` has no Account at all.
    EMBED = "embed"
    TRANSLATE = "translate"
    #: The query embedding inside a Semantic chat. Forced onto whichever Key
    #: built the corpus, or the question lands in a different vector space.
    RAG_QUERY = "rag_query"


#: The purposes an Account pays for. Written as the *smaller* set with the rest
#: derived, so that a purpose added without a decision falls to the Operator's
#: side loudly (the enum member exists, nothing charges it) rather than quietly
#: charging somebody's card.
ACCOUNT_PAID = frozenset({Purpose.SUMMARY, Purpose.CHAT, Purpose.TAG})

#: Modules that reach an AI Provider, and the purposes each resolves.
#:
#: The declared-caller pattern `RUN_SYNC_JOB_CALLERS` uses, and for the same
#: failure: a rule applied at the door somebody was looking at while a second
#: door stayed open. Here the open door charges the Operator for an Artifact,
#: which is the one thing this feature exists to stop, and it does it silently.
AI_KEY_CALLERS: dict[str, str] = {
    "app/api/routes/ai_routes.py": (
        "the Artifact routes — summary, chat and tag stream on the caller's "
        "Key; the embed and translate endpoints are the shared work, on the "
        "Operator's"
    ),
    "app/api/routes/rag.py": (
        "Semantic search embeds the question with the Key that built the "
        "corpus, so it is `RAG_QUERY` and never the caller's"
    ),
    "app/services/embeddings.py": (
        "corpus embeddings write `tg_post_embeddings`, one shared vector per "
        "Post, so `EMBED` on the Operator Key"
    ),
    "app/jobs/translation_batch.py": (
        "`run_translation_batch` has no Account at all and writes shared rows, "
        "so `TRANSLATE` on the Operator Key"
    ),
    "app/jobs/auto_summary.py": (
        "an unattended regeneration is still the owner's Artifact; BYOK-03 "
        "makes it read the Key id the Summary stored, and until then it "
        "resolves the owner's Key the way an attended run does"
    ),
}


@dataclass(frozen=True)
class ResolvedKey:
    """The credential one AI call will use, and who it belongs to.

    `credential_id` is `None` for the Operator Key, which is the whole
    difference a caller ever needs to know: a failure on a row can clear that
    row's validation stamp, and a failure on the environment cannot.
    """

    provider: str
    api_key: str
    base_url: str | None = None
    credential_id: str | None = None


def _operator_key() -> ResolvedKey:
    if not settings.GEMINI_API_KEY:
        raise HTTPException(status_code=503, detail=OPERATOR_KEY_MISSING_DETAIL)
    return ResolvedKey(provider=GEMINI, api_key=settings.GEMINI_API_KEY)


def resolve_ai_key(
    session: Session,
    *,
    user_id: uuid.UUID | None,
    purpose: Purpose,
    key_id: str | None = None,
) -> ResolvedKey:
    """Which Key pays for this call. The one place that rule lives.

    Artifact purposes resolve the Account's own Key; shared purposes resolve the
    Operator Key from the environment. **There is no fallback in either
    direction** — an Account with no Key cannot create an Artifact, and no
    setting turns that off. A fallback would make the default path the one where
    the Operator pays, which is the problem ADR-016 exists to solve.

    `key_id` is **client-supplied and untrusted**. It is checked against
    `user_id` *before* `decrypt_token`, for the reason multi-user-tenancy ticket
    33 gives about `publishBotId`: resolving a credential by primary key alone
    let a Summary name another Account's row, which the scheduler then decrypted
    and sent with. A foreign id answers exactly as an absent one does.

    An Account holding several Keys and naming none gets its most recently
    updated **validated** Key, falling back to its most recently updated Key at
    all — so an Account whose only Key was rejected is told it was rejected
    rather than told it has none.
    """
    if purpose not in ACCOUNT_PAID:
        return _operator_key()

    if user_id is None:
        # Not reachable from a route (every Artifact route has a
        # `current_user`), but `run_auto_summary` still picks up Summaries whose
        # owner is NULL. Refusing is the honest answer: nobody's Key can pay.
        raise HTTPException(status_code=400, detail=AI_KEY_MISSING_DETAIL)

    if key_id is not None:
        row = session.get(AICredential, key_id)
        if row is None or row.user_id != user_id:
            raise HTTPException(status_code=404, detail=AI_CREDENTIAL_NOT_FOUND)
    else:
        rows = list_credential_rows(session, user_id=user_id)
        if not rows:
            raise HTTPException(status_code=400, detail=AI_KEY_MISSING_DETAIL)
        validated = [r for r in rows if r.last_validated]
        row = (validated or rows)[0]

    if not row.last_validated:
        raise HTTPException(status_code=502, detail=AI_KEY_REJECTED_DETAIL)

    return ResolvedKey(
        provider=row.provider,
        api_key=decrypt_token(row.key_encrypted),
        base_url=row.base_url,
        credential_id=row.id,
    )


def list_credential_rows(session: Session, *, user_id: uuid.UUID) -> list[AICredential]:
    """The Account's Keys, newest write first, through the seam.

    `user_id` has no default for the reason `scoped_select` takes none: an
    optional owner leaves a caller passing nothing and still passing tests.
    """
    statement = scoped_select(select(AICredential), AICredential, user_id)
    rows = list(session.exec(statement).all())
    rows.sort(key=lambda r: r.updated_at, reverse=True)
    return rows


def list_ai_keys(session: Session, *, user_id: uuid.UUID) -> list[dict[str, Any]]:
    return [key_to_camel(r) for r in list_credential_rows(session, user_id=user_id)]


def key_to_camel(row: AICredential) -> dict[str, Any]:
    """The wire shape. **Never the key.** See the module docstring."""
    return {
        "id": row.id,
        "label": row.label,
        "provider": row.provider,
        "baseUrl": row.base_url,
        "hasKey": bool(row.key_encrypted),
        "lastValidated": row.last_validated,
    }


def _encrypt_key(raw: str) -> str:
    if not raw:
        return ""
    return raw if is_encrypted(raw) else encrypt_token(raw)


def upsert_ai_key(
    session: Session,
    key_id: str,
    body: dict[str, Any],
    *,
    user_id: uuid.UUID,
) -> AICredential:
    """Create a Key, or merge into the caller's existing one.

    **Editing a label or base URL does not require re-entering the secret**: an
    absent `key` leaves `key_encrypted` alone. That is the difference between
    fixing a typo and fetching the key out of a password manager, and it is why
    the secret is merged rather than replaced wholesale.
    """
    normalized = normalize_body(body)
    provider = str(normalized.get("provider") or GEMINI)
    if provider not in PROVIDER_KINDS:
        raise HTTPException(status_code=400, detail=f"Unknown provider: {provider}")
    raw = str(normalized.get("key") or normalized.get("key_encrypted") or "")
    encrypted = _encrypt_key(raw)

    row = session.get(AICredential, key_id)
    if row:
        assert_owner_on_write(row.user_id, user_id, detail=AI_CREDENTIAL_NOT_FOUND)
        row.label = str(normalized.get("label", row.label))
        row.provider = provider
        if "base_url" in normalized:
            row.base_url = normalized.get("base_url") or None
        if encrypted:
            row.key_encrypted = encrypted
        row.updated_at = utc_now()
    else:
        if not encrypted:
            raise HTTPException(
                status_code=400, detail="key is required for a new AI key"
            )
        row = AICredential(
            id=key_id,
            user_id=user_id,
            label=str(normalized.get("label") or key_id),
            provider=provider,
            base_url=normalized.get("base_url") or None,
            key_encrypted=encrypted,
        )
    session.add(row)
    session.commit()
    session.refresh(row)
    touch_sync(session, "ai_keys")
    return row


def delete_ai_key(session: Session, key_id: str, *, user_id: uuid.UUID) -> None:
    row = session.get(AICredential, key_id)
    if not row:
        raise HTTPException(status_code=404, detail=AI_CREDENTIAL_NOT_FOUND)
    assert_owner_on_write(row.user_id, user_id, detail=AI_CREDENTIAL_NOT_FOUND)
    session.delete(row)
    session.commit()
    touch_sync(session, "ai_keys")


def record_validation(session: Session, key_id: str, *, valid: bool) -> None:
    """Stamp or clear a Key's validation state.

    Called on save with the result of one cheap completion, and again from a
    call site whose Provider rejected the credential. Clearing is the signal the
    settings surface reads, and it is why nothing re-validates on a schedule:
    the only thing that ever needs to know is a call that was going to be made
    anyway.

    Takes no `user_id` and refuses nothing: every caller has already resolved
    the row through `resolve_ai_key` or owns it by construction, and a second
    ownership check here would be the duplicated owner filter the tenancy seam
    exists to remove.
    """
    row = session.get(AICredential, key_id)
    if row is None:
        return
    row.last_validated = int(utc_now().timestamp() * 1000) if valid else None
    session.add(row)
    session.commit()
    touch_sync(session, "ai_keys")
