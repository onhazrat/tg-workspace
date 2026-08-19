FROM python:3.14

ENV PYTHONUNBUFFERED=1

# Install uv
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#installing-uv
COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/

# Compile bytecode
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#compiling-bytecode
ENV UV_COMPILE_BYTECODE=1

# uv Cache
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#caching
ENV UV_LINK_MODE=copy

WORKDIR /app/

# Place executables in the environment at the front of the path
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#using-the-environment
ENV PATH="/app/.venv/bin:$PATH"

# Install dependencies
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#intermediate-layers
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-workspace --package app

COPY ./backend/scripts /app/backend/scripts

COPY ./backend/pyproject.toml ./backend/alembic.ini /app/backend/

COPY ./backend/app /app/backend/app

# Sync the project
# Ref: https://docs.astral.sh/uv/guides/integration/docker/#intermediate-layers
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --package app

WORKDIR /app/backend/

# One worker, deliberately. Not a capacity decision — a correctness one.
#
# This image ran `--workers 4` (the FastAPI template default, never reconciled
# with the scheduler that arrived later). Each worker starts its own in-process
# APScheduler, so every scheduled job fired four times: four `Auto Sync
# (scheduler)` jobs per tick, four workers scraping the same channels, and
# `has_active_sync_job()` — a dict in one process — unable to see any of it.
#
# Three pieces of state are per-process and must be externalised before this
# number can go up. `tests/deployment/test_worker_count.py` checks all three and
# will tell you when the coupling is gone:
#   * the job registry and its cancel/SSE machinery (`scraper_jobs`),
#   * the per-proxy concurrency semaphores (`proxy_pool`) — the dangerous one,
#     since N workers means N times the intended request rate at Telegram,
#   * the scheduler itself.
#
# The sequenced plan for scaling past this is docs/scaling-to-multiple-workers.md.
# Raising the count without following it does not add capacity, it adds
# duplicate work.
CMD ["fastapi", "run", "--workers", "1"]
