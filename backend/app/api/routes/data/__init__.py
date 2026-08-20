"""The `/data` router, assembled from one module per resource family.

`routes/data.py` was the largest module in the backend — 1,453 lines and 71
endpoints across fourteen resource families — and the file every feature had to
touch. C1 split it by family. Nothing else changed: the prefix, the tag and
every function name are identical, so paths and operation ids are too, and the
split is verified by diffing `frontend/openapi.json` before and after.

Route order is load-bearing in two places, and both pairs deliberately sit
**inside a single module** so reordering these includes cannot break them:
`/discover/reports/latest` must precede `/discover/reports/{report_id}` or
"latest" is captured as an id, and `/settings/network` must precede
`/settings/{key}` for the same reason.
"""

from fastapi import APIRouter

from app.api.routes.data import (
    admin,
    artifacts,
    channels,
    chat_sessions,
    credentials,
    discover,
    logs,
    posts,
    summaries,
    vectors,
)

router = APIRouter(prefix="/data", tags=["data"])

router.include_router(channels.router)
router.include_router(posts.router)
router.include_router(discover.router)
router.include_router(summaries.router)
router.include_router(chat_sessions.router)
router.include_router(artifacts.router)
router.include_router(credentials.router)
router.include_router(vectors.router)
router.include_router(logs.router)
router.include_router(admin.router)

__all__ = ["router"]
