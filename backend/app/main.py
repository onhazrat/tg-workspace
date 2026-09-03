import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.routing import APIRoute
from sqlmodel import Session
from starlette.middleware.cors import CORSMiddleware
from starlette.responses import JSONResponse

from app.api.main import api_router
from app.api.routes.data.admin import EXPORT_ROWS_HEADER
from app.core.config import settings
from app.core.db import engine, init_db
from app.core.startup_checks import run_startup_checks
from app.jobs.scheduler import (
    start_job_status_subscriber,
    stop_job_status_subscriber,
)
from app.middleware.api_key import APIKeyMiddleware
from app.middleware.timing import TimingMiddleware
from app.services.scraper_jobs import (
    start_progress_subscriber,
    stop_progress_subscriber,
)

logger = logging.getLogger(__name__)


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    """The API tier: serve requests, schedule nothing (ticket 10).

    Two things this used to do are now `app/worker.py`'s alone.

    `start_scheduler()` is the obvious one. The other is
    `reconcile_interrupted_jobs`, and dropping it here is not tidiness — it is
    the whole point. That function marks every non-terminal `tg_sync_jobs` row
    failed, which was sound while a restart of *this* process meant the sync
    was definitely dead. It no longer does: the sync runs in the worker, so an
    ordinary API deploy would have failed every job the worker was in the
    middle of, and told the browser so.

    What is added instead is the progress subscriber, which is what lets `GET
    /jobs/sync/{id}/events` stream a job this process is not running.
    """
    run_startup_checks()
    with Session(engine) as session:
        init_db(session)
    start_progress_subscriber()
    start_job_status_subscriber()
    logger.info("TG Summarizer API started")
    yield
    stop_job_status_subscriber()
    stop_progress_subscriber()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

app.add_middleware(APIKeyMiddleware)

# Inside CORS but outside everything else, so the measured span is the whole
# application: a request rejected by the API key middleware is still timed, and
# a slow rejection is exactly the kind of thing that would otherwise go unseen.
app.add_middleware(TimingMiddleware)

#: Response headers a cross-origin browser may read.
#:
#: `allow_headers` is about the *request*; without this list, `fetch` sees only
#: the handful of headers CORS exposes by default and every custom one reads
#: back as `null`. The dashboard is on a different host from the API in the
#: standard deployment, so that is the normal case rather than the exotic one —
#: which made `X-Export-Rows`, a header whose whole purpose is telling a client
#: how large a download is before it starts, unreadable by the only client
#: there is. Named rather than `*`, because `*` is ignored outright when
#: credentials are allowed.
CORS_EXPOSED_HEADERS = [EXPORT_ROWS_HEADER]

# CORS must be outermost so preflight OPTIONS is handled before API key auth.
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=CORS_EXPOSED_HEADERS,
    )


@app.middleware("http")
async def block_legacy_api_in_production(request: Request, call_next: Any) -> Any:
    """Answer 410, not 404, for the pre-`/api/v1` surface.

    E2 deleted `routes/legacy.py`, so those paths are simply unrouted now and a
    404 would be truthful. This stays anyway: 410 Gone says *this existed and
    was withdrawn*, which is the accurate answer for a caller still holding the
    old URLs, and it keeps the version boundary declared in one place rather
    than only in the router prefix.
    """
    path = request.url.path
    if (
        settings.ENVIRONMENT == "production"
        and path.startswith("/api/")
        and not path.startswith(settings.API_V1_STR)
    ):
        return JSONResponse(
            status_code=410,
            content={"detail": "Legacy /api/* removed; use /api/v1/*"},
        )
    return await call_next(request)


app.include_router(api_router, prefix=settings.API_V1_STR)
