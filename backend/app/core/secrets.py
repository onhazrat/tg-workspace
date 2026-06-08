"""Fernet encrypt/decrypt for bot tokens at rest."""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import settings

# Valid Fernet key for local dev/tests when TOKEN_ENCRYPTION_KEY is unset.
_LOCAL_DEV_FERNET_KEY = "rcVtgNgVUfmbrfU-cOzcseDe66PgU3jo4AjvfUA3X90="


def _fernet_key() -> bytes:
    raw = settings.TOKEN_ENCRYPTION_KEY.strip()
    if not raw:
        if settings.ENVIRONMENT == "local":
            raw = _LOCAL_DEV_FERNET_KEY
        else:
            raise ValueError("TOKEN_ENCRYPTION_KEY must be set in non-local environments")
    return raw.encode()


def _fernet() -> Fernet:
    return Fernet(_fernet_key())


def encrypt_token(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(stored: str) -> str:
    if not stored:
        return ""
    try:
        return _fernet().decrypt(stored.encode()).decode()
    except InvalidToken:
        if settings.ENVIRONMENT == "local":
            # Legacy plaintext rows from before Phase 2 encryption (local dev only).
            return stored
        raise ValueError(
            "Stored bot token is not encrypted; re-save the credential via the API"
        ) from None


def is_encrypted(stored: str) -> bool:
    if not stored:
        return False
    try:
        _fernet().decrypt(stored.encode())
        return True
    except InvalidToken:
        return False
