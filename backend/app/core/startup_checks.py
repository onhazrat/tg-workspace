"""Startup validation for production and staging deployments."""

import logging

from app.core.config import settings

logger = logging.getLogger(__name__)

_DEV_FERNET_KEY = "rcVtgNgVUfmbrfU-cOzcseDe66PgU3jo4AjvfUA3X90="


def run_startup_checks() -> None:
    """Validate configuration before serving traffic. Raises ValueError on failure."""
    if settings.ENVIRONMENT == "local":
        if not settings.API_KEY:
            logger.warning(
                "API_KEY is unset in local mode; sensitive routes rely on JWT only"
            )
        return

    token_key = settings.TOKEN_ENCRYPTION_KEY.strip()
    if not token_key:
        raise ValueError(
            "TOKEN_ENCRYPTION_KEY must be set when ENVIRONMENT is not 'local'. "
            'Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
    if token_key == _DEV_FERNET_KEY:
        raise ValueError(
            "TOKEN_ENCRYPTION_KEY must not use the built-in dev placeholder in non-local environments"
        )

    if settings.ENVIRONMENT == "production" and not settings.API_KEY.strip():
        raise ValueError(
            "API_KEY must be set when ENVIRONMENT is 'production' (Mode A hardened single-operator)"
        )

    if not settings.USERS_OPEN_REGISTRATION:
        logger.info("USERS_OPEN_REGISTRATION=false; public signup is disabled")
    else:
        logger.warning(
            "USERS_OPEN_REGISTRATION=true in %s; set false for production deployments",
            settings.ENVIRONMENT,
        )
