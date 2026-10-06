"""The Directory: what the deployment knows about a handle, read by handle.

Its own resource family rather than an addition to `discover.py`, and that is a
decision rather than filing (ticket 03). The Directory is corpus-wide and
outlives every report, so mounting its read as report machinery would say the
opposite — and the Channels tab wants this exact read with no report in sight.

The handler function names here are settled and never renamed: the operation id
derives from the function name, so a rename moves a symbol in the generated
client.
"""

import uuid
from dataclasses import asdict

from fastapi import APIRouter, HTTPException
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.schemas.directory import (
    DirectoryBinResponse,
    DirectoryCountRequest,
    DirectoryCountResponse,
    DirectoryDistributionRequest,
    DirectoryDistributionResponse,
    DirectoryEntryResponse,
    DirectoryLanguageCountResponse,
    DirectoryListRequest,
    DirectoryListResponse,
    DirectoryNeighboursResponse,
    DirectoryRowResponse,
    DirectorySamplePostResponse,
    DirectorySizeResponse,
    DirectoryViewRequest,
    DirectoryWhyRequest,
    DirectoryWhyResponse,
)
from app.services import directory_reads
from app.services.channel_directory import probe_map
from app.services.channel_directory_samples import sample_to_camel, samples_for
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


def _view(
    session: Session, user_id: uuid.UUID, body: DirectoryViewRequest
) -> directory_reads.DirectoryView:
    return directory_reads.resolve_view(
        session,
        user_id,
        tree=None if body.filter is None else body.filter.to_tree(),
        source=body.yours.source,
        handles=body.yours.handles,
        kinds=body.reference_kinds,
        search=None if body.search is None else (body.search.text, body.search.fields),
    )


@router.post("/directory/list")
def list_directory(
    body: DirectoryListRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryListResponse:
    """One page of 100 Directory entries under a Directory filter, sorted.

    With the view's total and its Language counts, both counted without the
    view's Language Conditions where the menu needs them.
    """
    page = directory_reads.list_page(
        session,
        _view(session, current_user.id, body),
        sort=body.sort,
        descending=body.descending,
        page=body.page,
        show_matches=body.show_matches,
    )
    return DirectoryListResponse(
        rows=[DirectoryRowResponse.model_validate(asdict(row)) for row in page.rows],
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
    return DirectoryCountResponse(
        total=directory_reads.count_view(
            session, _view(session, current_user.id, body), candidate
        )
    )


@router.post("/directory/distribution")
def get_directory_distribution(
    body: DirectoryDistributionRequest,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryDistributionResponse:
    """A measure's spread across the view with its own bounds left out."""
    spread = directory_reads.distribution(
        session, _view(session, current_user.id, body), body.measure
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
    _current_user: CurrentUser,
) -> DirectorySizeResponse:
    """How many Channels the Directory lists at all."""
    return DirectorySizeResponse(size=directory_reads.directory_size(session))


# ---- The detail panel (DIR-03) -----------------------------------------------------


@router.get("/directory/{handle}/entry")
def get_directory_entry(
    handle: str,
    session: SessionDep,
    current_user: CurrentUser,
) -> DirectoryEntryResponse:
    """One listed Directory entry by handle, with its bio, for the detail panel."""
    found = directory_reads.entry(session, current_user.id, normalize_handle(handle))
    if found is None:
        raise HTTPException(status_code=404, detail=DIRECTORY_ENTRY_NOT_FOUND)
    row, bio = found
    return DirectoryEntryResponse.model_validate(asdict(row) | {"bio": bio})


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
        tree=None,
        source=body.yours.source,
        handles=body.yours.handles,
        kinds=body.reference_kinds,
    )
    why = directory_reads.why_its_here(
        session,
        view,
        normalize_handle(body.handle),
        days=body.days,
        parents=body.parents,
        children=body.children,
    )
    return DirectoryWhyResponse.model_validate(asdict(why))
