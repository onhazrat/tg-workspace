"""The Directory: what the deployment knows about a handle, read by handle.

Its own resource family rather than an addition to `discover.py`, and that is a
decision rather than filing (ticket 03). The Directory is corpus-wide and
outlives every report, so mounting its read as report machinery would say the
opposite — and the Channels tab wants this exact read with no report in sight.

The handler function names here are settled and never renamed: the operation id
derives from the function name, so a rename moves a symbol in the generated
client.
"""

from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import CurrentUser, SessionDep, require_permission
from app.api.directory_views import sees_internals, targets, view_of
from app.core.permissions import Permission
from app.schemas.directory import (
    DirectoryAddRequest,
    DirectoryAddResponse,
    DirectoryBinResponse,
    DirectoryBoostRequest,
    DirectoryBoostResponse,
    DirectoryColumnDefaultsRequest,
    DirectoryColumnResponse,
    DirectoryCountRequest,
    DirectoryCountResponse,
    DirectoryDistributionRequest,
    DirectoryDistributionResponse,
    DirectoryEntryResponse,
    DirectoryHandlesRequest,
    DirectoryHandlesResponse,
    DirectoryLanguageCountResponse,
    DirectoryListRequest,
    DirectoryListResponse,
    DirectoryNeighboursResponse,
    DirectoryRowResponse,
    DirectorySamplePostResponse,
    DirectorySizeResponse,
    DirectoryWhyRequest,
    DirectoryWhyResponse,
)
from app.services import directory_reads
from app.services.channel_directory import (
    BoostOutOfRange,
    add_named_handles,
    boost_entries,
    probe_map,
)
from app.services.channel_directory_samples import sample_to_camel, samples_for
from app.services.settings_registry import DIRECTORY_COLUMNS_KEY
from app.services.settings_store import replace_global_setting
from app.services.telegram_web import normalize_handle

router = APIRouter()

#: 404 for a handle the Directory holds nothing about — no answer and no Posts.
#:
#: The first half is the rule `probe_map` applies to the report join: this table
#: is also the work queue, so enqueuing a report's candidates creates a row for
#: every one of them immediately, and a row waiting its turn is not an answer. A
#: handle nobody has looked at and a handle queued five minutes ago are the same
#: state to a reader, and both read "not probed yet".
#:
#: The second half is why it is not `probe_map` alone. `requeue_probes` clears
#: the verdict and `attempted_at` but **keeps the samples**, and says why:
#: clearing them "would blank the one part of the entry worth reading for
#: however long the queue takes to reach the handle". Gating this read on the
#: verdict would blank it anyway, so that preservation would buy a reader
#: nothing. A rechecked handle therefore shows no statistics — it has disowned
#: them — and still shows what the Channel published.
DIRECTORY_ENTRY_NOT_FOUND = "No Directory entry for this handle"


# Ticket 03. Guarded by `tests/api/test_directory_posts_projection.py`.
#
# Deliberately not on the report: forty Candidates times twenty Post bodies is
# the 26 MB and 56 MB list payloads twice fixed and once re-created, which is
# why the bodies live behind a per-handle read at all.
@router.get("/directory/{handle}/posts")
def get_directory_posts(
    handle: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> list[DirectorySamplePostResponse]:
    """The Channel's recent Posts, as the last probe captured them.

    What a Channel actually publishes, read without leaving the app and without
    reaching Telegram. **This issues no fetch**: it serves the snapshot the
    probe already stored, because a user-facing trigger on a rate-limited
    scraper would let a click jump the queue that exists to decide ordering. A
    stale answer is refreshed through `POST /discover/probe/refresh`, which goes
    through that queue.

    Empty is a real answer and means the entry has no recent Posts — an
    `unavailable` verdict clears the snapshot outright, and retention collects
    it on the sample window. The 404 is the other absence: the deployment holds
    nothing about this handle, no verdict and no Posts.
    """
    normalized = normalize_handle(handle)
    rows = samples_for(session, normalized)
    if not rows and not probe_map(session, {normalized}):
        raise HTTPException(status_code=404, detail=DIRECTORY_ENTRY_NOT_FOUND)
    return [
        DirectorySamplePostResponse.model_validate(sample_to_camel(row)) for row in rows
    ]


# ---- Browsing the Directory (DIR-02) ------------------------------------------
#
# Four reads behind the Directory tab, all over the read model
# `services/directory_reads.py`. The three that take a view are POSTs because
# the Directory filter travels in the body; each is declared read-only in
# `deps.VIEW_AS_READ_ONLY_PATHS`, so a View-as session can browse.


# `exclude_unset` is what leaves a column nobody asked for out of each row
# rather than sending it as `null`, which means "not measured" (DCOL).
@router.post("/directory/list", response_model_exclude_unset=True)
def list_directory(
    body: DirectoryListRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryListResponse:
    """One page of 100 Directory entries under a Directory filter, sorted.

    With the view's total and its Language counts, both counted without the
    view's Language Conditions where the menu needs them.
    """
    visible = directory_reads.visible_columns(
        internals=sees_internals(session, current_user.id)
    )
    page = directory_reads.list_page(
        session,
        view_of(session, current_user.id, body, body.sort),
        sort=body.sort,
        descending=body.descending,
        page=body.page,
        columns=frozenset(body.columns).intersection(visible),
        show_matches=body.show_matches,
        first=body.first(),
    )
    return DirectoryListResponse(
        rows=[DirectoryRowResponse.model_validate(row.fields()) for row in page.rows],
        total=page.total,
        languages=[
            DirectoryLanguageCountResponse.model_validate(asdict(entry))
            for entry in page.languages
        ],
        yoursSize=page.yours_size,
    )


@router.post("/directory/count")
def count_directory(
    body: DirectoryCountRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryCountResponse:
    """How many entries a view leaves, with a candidate Condition added with AND."""
    candidate = None if body.candidate is None else body.candidate.to_atom()
    view = view_of(session, current_user.id, body, candidate=candidate)
    return DirectoryCountResponse(
        total=directory_reads.count_view(session, view, candidate)
    )


#: 422 for Tick all on a view too large to tick; the browser holds it as All
#: matching instead and never asks (ADR-031).
TOO_MANY_TO_TICK = f"More than {directory_reads.MAX_TICK_ALL:,} entries match; act on them as All matching"


@router.post("/directory/handles")
def list_directory_handles(
    body: DirectoryHandlesRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryHandlesResponse:
    """Every handle a view matches, in the list's sort, to tick them all."""
    handles = directory_reads.view_handles(
        session,
        view_of(session, current_user.id, body, body.sort),
        sort=body.sort,
        descending=body.descending,
    )
    if handles is None:
        raise HTTPException(status_code=422, detail=TOO_MANY_TO_TICK)
    return DirectoryHandlesResponse(handles=handles)


# Zoomed by `lo` and `hi` since TB-04.
@router.post("/directory/distribution")
def get_directory_distribution(
    body: DirectoryDistributionRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryDistributionResponse:
    """A measure's spread across the view with its own bounds left out."""
    spread = directory_reads.distribution(
        session,
        view_of(session, current_user.id, body, body.measure),
        body.measure,
        body.zoom,
    )
    return DirectoryDistributionResponse(
        scale=spread.scale,
        total=spread.total,
        noValue=spread.no_value,
        min=spread.min,
        max=spread.max,
        median=spread.median,
        bins=[DirectoryBinResponse.model_validate(asdict(b)) for b in spread.bins],
    )


@router.get("/directory/size")
def get_directory_size(
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectorySizeResponse:
    """How many entries the Directory lists to this reader at all."""
    return DirectorySizeResponse(
        size=directory_reads.directory_size(
            session, every_kind=sees_internals(session, current_user.id)
        )
    )


# ---- The columns (DCOL) -------------------------------------------------------------
#
# The catalogue a caller may show and the deployment's defaults. The defaults
# are a `tg_app_settings` row; an Account's own choices never reach the server.
# The PUT is a write, so a View-as session is refused it with no entry here.


@router.get("/directory/columns")
def list_directory_columns(
    session: SessionDep,
    current_user: CurrentUser,
) -> list[DirectoryColumnResponse]:
    """The Directory columns this caller may show, in table order, each with
    whether it is on by default."""
    defaults = directory_reads.column_defaults(session)
    return [
        DirectoryColumnResponse(key=key, default=key in defaults)
        for key in directory_reads.visible_columns(
            internals=sees_internals(session, current_user.id)
        )
    ]


@router.put(
    "/directory/columns",
    dependencies=[Depends(require_permission(Permission.DATA_ADMIN))],
)
def put_directory_columns(
    body: DirectoryColumnDefaultsRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> list[DirectoryColumnResponse]:
    """Set which Directory columns are on by default for every Account; a
    column not named is off."""
    on = [key for key in directory_reads.DIRECTORY_COLUMNS if key in body.on]
    replace_global_setting(session, DIRECTORY_COLUMNS_KEY, {"on": on})
    return list_directory_columns(session, current_user)


# ---- The Priority boost (DPF) -------------------------------------------------------
#
# A write, so a View-as session is refused it with no entry here, as the
# column defaults' PUT is.


@router.post(
    "/directory/boost",
    dependencies=[Depends(require_permission(Permission.DATA_ADMIN))],
)
def boost_directory(
    body: DirectoryBoostRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DirectoryBoostResponse:
    """Set the Priority boost of the named Directory entries, or add to it.

    A positive boost fetches an entry sooner. A handle the Directory holds
    nothing about is skipped; an add that carries any entry out of range
    changes none.
    """
    try:
        changed = boost_entries(
            session,
            targets(session, _current_user.id, body),
            mode=body.mode,
            value=body.value,
        )
    except BoostOutOfRange as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return DirectoryBoostResponse(changed=changed)


# ---- Adding pasted handles (DADD) ---------------------------------------------------
#
# `DATA_ADMIN`, because every fetch spends the deployment's proxies and no
# Account's Budget. A write, so View-as refuses it as it refuses the boost.


@router.post(
    "/directory/add",
    dependencies=[Depends(require_permission(Permission.DATA_ADMIN))],
)
def add_directory_handles(
    body: DirectoryAddRequest,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DirectoryAddResponse:
    """Queue pasted handles for a fetch, without following any of them."""
    return DirectoryAddResponse.model_validate(
        add_named_handles(session, body.handles)._asdict()
    )


# ---- The detail panel (DIR-03) -----------------------------------------------------


# `exclude_unset` leaves the three `DATA_ADMIN` fields out for anybody else.
@router.get("/directory/{handle}/entry", response_model_exclude_unset=True)
def get_directory_entry(
    handle: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryEntryResponse:
    """One listed Directory entry by handle, with its bio, for the detail panel."""
    found = directory_reads.entry(
        session,
        current_user.id,
        normalize_handle(handle),
        internals=sees_internals(session, current_user.id),
    )
    if found is None:
        raise HTTPException(status_code=404, detail=DIRECTORY_ENTRY_NOT_FOUND)
    row, bio = found
    return DirectoryEntryResponse.model_validate(row.fields() | {"bio": bio})


# DIR-05. A GET, so View-as needs no entry for it; corpus, so both Accounts in
# `test_directory_browse.py` get one answer.
@router.get("/directory/{handle}/neighbours")
def get_directory_neighbours(
    handle: str,
    session: SessionDep,
    _current_user: CurrentUser,
) -> DirectoryNeighboursResponse:
    """The Channels citing a Channel most, and those it cites most."""
    found = directory_reads.neighbours(session, normalize_handle(handle))
    return DirectoryNeighboursResponse.model_validate(asdict(found))


@router.post("/directory/why")
def get_directory_why(
    body: DirectoryWhyRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryWhyResponse:
    """The Posts of "your channels" that cite a Channel, newest first."""
    view = directory_reads.resolve_view(
        session,
        current_user.id,
        tree=body.shared(),
        source=body.yours.source,
        handles=body.yours.handles,
        kinds=body.reference_kinds,
    )
    why = directory_reads.why_its_here(
        session, view, normalize_handle(body.handle), days=body.days
    )
    return DirectoryWhyResponse.model_validate(asdict(why))
