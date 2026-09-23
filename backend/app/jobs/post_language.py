"""The walk reads stored Posts (LANG-03, ADR-021).

Posts written since LANG-01 are read as they are written. Posts stored before
it carry no Language, and this job reads them, a page per tick, newest first,
because the newest are the ones translation and the Channel labels depend on.
Nobody runs a script on a deployment; once the walk catches up, a tick is one
probe of the empty `ix_tg_posts_language_unread` and writes nothing.

It runs on the Sync worker only, like every scheduled job (`app/worker.py`).
The pace is `POST_LANGUAGE_WALK_BATCH_SIZE` per `INTERVAL_SECONDS`, which keeps
the dead tuples it leaves on `tg_posts` at a rate autovacuum reclaims, so no
manual `VACUUM` step either.
"""

from __future__ import annotations

from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.services.async_db import run_db
from app.services.posts import read_unread_languages

POST_LANGUAGE_JOB_ID = "post_language"

#: The reference-extraction walk's cadence (the harvest tick), at the same page
#: size: a pace that ran on staging's ~4.7M-Post corpus without competing with
#: sync. The batch size is the dial; this is not a second one.
INTERVAL_SECONDS = 300


def _walk() -> dict[str, int]:
    with Session(engine) as session:
        read = read_unread_languages(
            session, limit=settings.POST_LANGUAGE_WALK_BATCH_SIZE
        )
    return {"read": read}


async def run_post_language_walk() -> dict[str, int]:
    """Read one page of unread Posts; the scheduler surfaces the count."""
    return await run_db(_walk)
