from fastapi import APIRouter, Depends

from app.api.deps import require_approved_user
from app.api.routes import (
    ai_routes,
    data,
    jobs,
    login,
    network,
    private,
    quota,
    rag,
    telegram,
    users,
    utils,
    view_as,
)
from app.core.config import settings

api_router = APIRouter()

# Routers a person can reach before they are approved. `login` is how they get a
# token at all, `users` carries `/users/me` — which is how the app discovers it
# should show the pending page rather than the application — and `utils` holds
# the health check. Everything else is data, and an unapproved account has no
# business reading or writing any of it.
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)

# Everything below requires an approved account. Declared once per router rather
# than on each of the ~90 routes underneath: being unapproved is a property of
# the session, not of any one endpoint, and a rule repeated ninety times is a
# rule that gets forgotten on the ninety-first. `tests/api/test_approval_gate.py`
# asserts this list stays exhaustive, so a new data router that skips it fails.
APPROVED_ONLY = [Depends(require_approved_user)]

api_router.include_router(network.router, dependencies=APPROVED_ONLY)
api_router.include_router(telegram.router, dependencies=APPROVED_ONLY)
api_router.include_router(ai_routes.router, dependencies=APPROVED_ONLY)
api_router.include_router(data.router, dependencies=APPROVED_ONLY)
api_router.include_router(rag.router, dependencies=APPROVED_ONLY)
api_router.include_router(jobs.router, dependencies=APPROVED_ONLY)
api_router.include_router(quota.router, dependencies=APPROVED_ONLY)
api_router.include_router(view_as.router, dependencies=APPROVED_ONLY)

if settings.ENVIRONMENT == "local":
    api_router.include_router(private.router)
