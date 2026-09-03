"""Database statistics, table clears, settings rows, import and export.

Split out of the former `routes/data.py` under C1. The parent router in
`data/__init__.py` supplies the `/data` prefix and the `data` tag, so every
path and operation id is unchanged.

## Admin-only, with two exceptions (ticket 18)

Everything here answers for the whole deployment: statistics counted across
every account, a table cleared for everybody, an import that overwrites rows by
id, an export that streams every account's rows, and the proxy list, whose URLs
carry credentials. All of it was reachable by any authenticated person, which
was invisible while there was one account and is the whole problem the moment
there are two. Each of those routes now names `Permission.DATA_ADMIN`.

`GET`/`PUT /settings/{key}` are the exceptions, and not because they are
harmless. They are a facade over both settings tables: `sync` reassembles
deployment policy, scheduler runtime and the caller's *own* preferences into
one blob — the frontend's Pause button writes a global runtime field through it
— and after ticket 20 `retention` does the same for the corpus window and a
person's own log and report windows. Gating the route wholesale would take
those personal settings away from them, so authorisation is routed per field
through `settings_registry` beside the storage routing. Deployment-policy keys
reaching this route is a real hole; it is recorded in
`docs/admin-only-routes-and-log-scoping-plan.md` rather than half-closed here.
`tests/api/test_admin_route_gating.py` holds both exemptions with that reason
and fails if a *third* ungated route appears.
"""

import uuid
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.core.acting_owner import ActingOwner
from app.core.acting_owner import bind as bind_acting_owner
from app.core.permissions import Permission
from app.jobs.settings import (
    load_jobs_settings,
    load_retention_settings,
    load_sync_settings,
    load_translation_settings,
    save_retention_settings,
    save_sync_settings,
)
from app.models import User
from app.schemas.common import AppSettingResponse, ImportDataResponse
from app.schemas.stats import (
    ClearTableResponse,
    DbStatsResponse,
    TableSizeResponse,
)
from app.services import rbac
from app.services.data_import_export import (
    EVERYONE,
    SUBJECT_NOT_FOUND,
    ExportSubject,
    prepare_export,
    stream_export_data,
)
from app.services.data_import_export import import_data as import_data_impl
from app.services.network_settings import (
    get_network_setting_row,
    merge_network_put,
    network_settings_payload,
)
from app.services.settings_registry import (
    RETENTION_KEY,
    RETENTION_PREF_FIELDS,
    SYNC_KEY,
    SYNC_PREF_FIELDS,
    Home,
    home_for,
)
from app.services.settings_store import (
    get_global_setting,
    put_global_setting,
    replace_global_setting,
)
from app.services.stats import clear_table, get_db_stats, get_table_sizes
from app.services.sync_meta import touch_sync
from app.services.user_settings import get_user_setting, put_user_setting

#: Keys whose GET returns defaults merged over the stored row rather than the
#: bare row. Each takes the caller's id even when it ignores it, so the call
#: site does not have to know which keys have a per-User half — after tickets 06
#: and 20 `sync` and `retention` do, and the other two do not.
_SETTING_LOADERS: dict[str, Callable[[Session, uuid.UUID], dict[str, Any]]] = {
    "jobs": lambda session, _user_id: load_jobs_settings(session),
    "sync": lambda session, user_id: load_sync_settings(session, user_id=user_id),
    RETENTION_KEY: lambda session, user_id: load_retention_settings(
        session, user_id=user_id
    ),
    "translation": lambda session, _user_id: load_translation_settings(session),
}

#: The facade keys, and which of their fields the registry calls personal.
#:
#: Both arrive in one old-shape blob that spans deployment policy and the
#: caller's own preferences, so neither can be gated as a whole: refusing the
#: request would take a person's own settings away from them, and dropping the
#: policy half silently is what lets one PUT serve both kinds of caller. The
#: field sets are the registry's, not this module's — the day a field changes
#: home it changes here with it, rather than being narrowed by a stale copy.
_FACADE_PREF_FIELDS: dict[str, frozenset[str]] = {
    SYNC_KEY: SYNC_PREF_FIELDS,
    RETENTION_KEY: RETENTION_PREF_FIELDS,
}
# Tables whose clear removes rows from more than one resource.
CLEARED_SYNC_RESOURCES: dict[str, tuple[str, ...]] = {
    "posts": ("posts", "embeddings", "translations"),
}


router = APIRouter()

#: The gate on every route in this module that answers for the deployment
#: rather than for one account (ticket 18). Declared once and spread across the
#: decorators, rather than mounted on the router in `data/__init__.py`, because
#: two routes here are deliberately *not* Admin-only and a router-level
#: dependency cannot be taken back off one route.
ADMIN_ONLY_CALLABLE = require_permission(Permission.DATA_ADMIN)
ADMIN_ONLY = [Depends(ADMIN_ONLY_CALLABLE)]


@router.get("/stats", dependencies=ADMIN_ONLY)
def db_stats(
    session: SessionDep,
    _current_user: CurrentUser,
) -> DbStatsResponse:
    return DbStatsResponse.model_validate(
        get_db_stats(session, operator_id=_current_user.id)
    )


@router.get("/table-sizes", dependencies=ADMIN_ONLY)
def table_sizes(
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[TableSizeResponse]:
    return [
        TableSizeResponse.model_validate(row)
        for row in get_table_sizes(session, operator_id=_current_user.id)
    ]


@router.delete("/tables/{name}", dependencies=ADMIN_ONLY)
def clear_table_route(
    name: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> ClearTableResponse:
    try:
        deleted = clear_table(session, name, operator_id=_current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if deleted:
        # Clearing posts cascades (see clear_table), so refresh the etags of
        # the dependent resources too or their caches would serve rows the
        # database no longer has.
        for resource in CLEARED_SYNC_RESOURCES.get(name, (name,)):
            touch_sync(session, resource)
    return ClearTableResponse(deleted=deleted)


@router.get("/settings/network", dependencies=ADMIN_ONLY)
def get_network_settings(
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    row = get_network_setting_row(session)
    value = network_settings_payload(row.value if row else None)
    return AppSettingResponse.model_validate({"key": "network", "value": value})


@router.put("/settings/network", dependencies=ADMIN_ONLY)
def put_network_settings(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    row = get_network_setting_row(session)
    merged = merge_network_put(body, row.value if row else None)
    # Replace rather than merge: `merge_network_put` has already merged with the
    # rules that understand proxy lists and Tor modes, so a second blind merge
    # in the store would resurrect proxy URLs the operator just removed.
    replace_global_setting(session, "network", merged)
    touch_sync(session, "settings")
    return AppSettingResponse.model_validate(
        {
            "key": "network",
            "value": network_settings_payload(merged),
        }
    )


@router.get("/settings/{key}")
def get_setting(
    key: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> AppSettingResponse:
    loader = _SETTING_LOADERS.get(key)
    if loader is not None:
        return AppSettingResponse(key=key, value=loader(session, _current_user.id))
    if _home_of(key) is Home.USER:
        value = get_user_setting(session, key, user_id=_current_user.id)
    else:
        value = get_global_setting(session, key)
    return AppSettingResponse(key=key, value=value)


def _home_of(key: str) -> Home:
    """`home_for`, but a 400 instead of a `KeyError` escaping as a 500.

    Before ticket 06 any key was accepted and an unknown one read back as an
    empty value. Now a key has to be classified to be routed at all, so the
    honest answer is to say so — a request naming a key the registry does not
    know is a client mistake, not a server one.
    """
    try:
        return home_for(key)
    except KeyError as exc:
        raise HTTPException(status_code=400, detail=str(exc.args[0])) from exc


@router.put("/settings/{key}")
def put_setting(
    key: str,
    body: dict[str, Any],
    session: SessionDep,
    current_user: CurrentUser,
) -> AppSettingResponse:
    """Write one settings section, refusing deployment policy to a non-Admin.

    The route stays open because the *key* decides, not the path. `jobs` turns
    the scheduler off for everybody, and so on for every other global key:
    those are `DATA_ADMIN`.

    `sync` and `retention` cannot be gated that way, because each is a facade:
    one body carries deployment policy and the caller's own preferences at the
    same time. `sync` mixes scheduler policy, the runtime counters the Pause
    button writes, and a person's start-time defaults; `retention` mixes the
    corpus window — `postRetentionDays`, which deletes every account's Posts on
    the next sweep, table clearing on a timer — with that person's own log and
    report windows. Refusing the whole request would take their own settings
    away from them, so for a caller without the permission the body is narrowed
    to the fields the registry declares personal and the rest is dropped rather
    than written. Dropping, not refusing, because the frontend sends a whole
    section at once and a non-Admin saving their preferences should not be told
    the save failed when the half that is theirs succeeded.
    """
    if key in _FACADE_PREF_FIELDS:
        # The carve is invisible from here: the body arrives in the old blob
        # shape and the save routes each field to the table that owns it, so
        # the response is still the whole reassembled blob.
        writable = _writable_facade_fields(key, body, session, current_user)
        if key == SYNC_KEY:
            save_sync_settings(session, writable, user_id=current_user.id)
            value = load_sync_settings(session, user_id=current_user.id)
        else:
            save_retention_settings(session, writable, user_id=current_user.id)
            value = load_retention_settings(session, user_id=current_user.id)
    elif _home_of(key) is Home.USER:
        value = put_user_setting(session, key, body, user_id=current_user.id)
    else:
        ADMIN_ONLY_CALLABLE(session, current_user)
        value = put_global_setting(session, key, body)
    touch_sync(session, "settings")
    return AppSettingResponse(key=key, value=value)


def _writable_facade_fields(
    key: str, body: dict[str, Any], session: Session, current_user: User
) -> dict[str, Any]:
    """`body` as-is for an Admin; only the personal fields for anyone else.

    The registry's field sets are the answer to which half of a facade blob
    belongs to the person rather than the deployment, so this invents no new
    knowledge — the day a field moves between halves, it moves here with it.
    """
    if rbac.has_permission(session, current_user.id, Permission.DATA_ADMIN):
        return body
    personal = _FACADE_PREF_FIELDS[key]
    return {k: v for k, v in body.items() if k in personal}


#: The header carrying the pre-count, so a client knows the size of what it is
#: about to download before the first row of it arrives. Named here because the
#: route sets it and `test_admin_scoped_export.py` reads it, and two spellings
#: of a header is how those two stop agreeing.
EXPORT_ROWS_HEADER = "X-Export-Rows"


def _resolve_subject(
    session: Session, subject: str | None, caller: User
) -> ExportSubject:
    """Turn the `subject` parameter into the account an export is about.

    Three answers, and the default is the narrow one: absent means the caller,
    `all` means every account, and a user id means that account. An export is
    the widest read in the deployment, so crossing accounts is something
    somebody has to type — leaving a parameter off must not be the way to get
    everybody's rows.

    An unknown or malformed subject answers **404 with the same body a real
    account would produce for a row that is not there**, for the reason
    `tenancy.assert_owner` gives: this route is Admin-gated but it is still not
    an account oracle, and "no such user" and "not a user you may name" should
    not be distinguishable by reading the response.
    """
    if subject is None:
        return ExportSubject.account(caller.id)
    if subject == EVERYONE:
        return ExportSubject.everyone()
    try:
        subject_id = uuid.UUID(subject)
    except ValueError:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND) from None
    if session.get(User, subject_id) is None:
        raise HTTPException(status_code=404, detail=SUBJECT_NOT_FOUND)
    return ExportSubject.account(subject_id)


@router.post("/import", dependencies=ADMIN_ONLY)
def import_data(
    body: dict[str, Any],
    session: SessionDep,
    _current_user: CurrentUser,
    subject: str | None = None,
) -> ImportDataResponse:
    """Restore a document into one account's rows.

    `subject` is the account the document lands under, defaulting to the caller
    — the same parameter the export takes, so a backup of one person restores
    as that person instead of as whoever ran it (ticket 28). `all` is refused:
    an import writes rows and a document carries no owners, so "everybody" has
    no meaning here that is not "the caller", which is what leaving it off
    already says.

    Importing *for* somebody is a write on their behalf, so the acting Owner is
    bound for this session before anything is written and every artifact the
    document restores records who really uploaded it (ticket 27).
    """
    resolved = _resolve_subject(session, subject, _current_user)
    if resolved.is_everyone:
        raise HTTPException(
            status_code=422,
            detail="An import has one subject; `all` is not one of them.",
        )
    assert resolved.user_id is not None
    if resolved.user_id != _current_user.id:
        bind_acting_owner(
            session, ActingOwner(user_id=_current_user.id, email=_current_user.email)
        )
    return ImportDataResponse.model_validate(
        import_data_impl(session, body, user_id=resolved.user_id)
    )


@router.get("/export", dependencies=ADMIN_ONLY)
def export_data(
    session: SessionDep,
    _current_user: CurrentUser,
    subject: str | None = None,
) -> StreamingResponse:
    """One account's export, or the whole deployment's — never truncated.

    `subject` is ticket 28: absent for the caller's own rows, a user id for that
    account's, `all` for everybody's.

    Streamed rather than built in memory: the payload spans every post and log
    row, which is far more than a worker can hold at once. The per-section row
    counts are computed first and travel in `X-Export-Rows`, because a
    `StreamingResponse` sends its headers before the generator runs — which is
    what makes "reports the row count before starting" true for a client that
    has not parsed a byte of the body yet. The same numbers lead the document,
    from the same computation, so the header and the file cannot disagree.
    """
    resolved = _resolve_subject(session, subject, _current_user)
    prepared = prepare_export(session, subject=resolved, viewer_id=_current_user.id)
    return StreamingResponse(
        stream_export_data(
            session,
            subject=resolved,
            viewer_id=_current_user.id,
            prepared=prepared,
        ),
        media_type="application/json",
        headers={EXPORT_ROWS_HEADER: str(prepared.total_rows)},
    )
