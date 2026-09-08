"""The Directory: what the deployment knows about a handle, read by handle.

Its own resource family rather than an addition to `discover.py`, and that is a
decision rather than filing (ticket 03). The Directory is corpus-wide and
outlives every report, so mounting its read as report machinery would say the
opposite — and the Channels tab wants this exact read with no report in sight.

The handler function names here are settled and never renamed: the operation id
derives from the function name, so a rename moves a symbol in the generated
client.
"""

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, SessionDep
from app.schemas.directory import DirectorySamplePostResponse
from app.services.channel_directory import normalize_handle, probe_map
from app.services.channel_directory_samples import sample_to_camel, samples_for

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
