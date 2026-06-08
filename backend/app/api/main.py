from fastapi import APIRouter

from app.api.routes import (
    ai_routes,
    data,
    items,
    jobs,
    login,
    network,
    private,
    rag,
    telegram,
    users,
    utils,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(items.router)
api_router.include_router(network.router)
api_router.include_router(telegram.router)
api_router.include_router(ai_routes.router)
api_router.include_router(data.router)
api_router.include_router(rag.router)
api_router.include_router(jobs.router)

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
