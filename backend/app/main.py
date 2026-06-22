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
from app.api.routes import legacy
from app.core.config import settings
from app.core.db import engine, init_db
from app.core.startup_checks import run_startup_checks
from app.jobs.scheduler import start_scheduler, stop_scheduler
from app.middleware.api_key import APIKeyMiddleware

logger = logging.getLogger(__name__)


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT != "local":
    sentry_sdk.init(dsn=str(settings.SENTRY_DSN), enable_tracing=True)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    run_startup_checks()
    with Session(engine) as session:
        init_db(session)
    start_scheduler()
    logger.info("TG Summarizer backend started")
    yield
    stop_scheduler()


app = FastAPI(
    title=settings.PROJECT_NAME,
    openapi_url=f"{settings.API_V1_STR}/openapi.json",
    generate_unique_id_function=custom_generate_unique_id,
    lifespan=lifespan,
)

# Set all CORS enabled origins
if settings.all_cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.all_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

app.add_middleware(APIKeyMiddleware)


@app.middleware("http")
async def block_legacy_api_in_production(request: Request, call_next: Any) -> Any:
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
if settings.ENVIRONMENT != "production":
    app.include_router(legacy.router)
else:
    logger.info("Legacy /api/* router disabled in production (use /api/v1/*)")
