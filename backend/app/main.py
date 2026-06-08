import logging
from contextlib import asynccontextmanager

import sentry_sdk
from fastapi import FastAPI
from fastapi.routing import APIRoute
from starlette.middleware.cors import CORSMiddleware

from sqlmodel import Session

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
async def lifespan(_app: FastAPI):
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

app.include_router(api_router, prefix=settings.API_V1_STR)
app.include_router(legacy.router)
