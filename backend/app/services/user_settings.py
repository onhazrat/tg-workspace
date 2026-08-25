"""Aggregate for `tg_user_settings` — the personal half of the settings.

The **only** module that writes this table, mirroring `settings_store.py` for
the global half. Both ask `settings_registry.home_for` before touching a row,
so neither can be talked into writing the other's keys, and
`tests/services/test_settings_table_split.py` walks the AST to keep the writer
count at one apiece.

`user_id` is required everywhere here, with no default. A default of "the
operator" is what `operator.py` did, and it is the fallback the plan's decision
24 dissolves: a row written on nobody's behalf is a row nobody can be shown.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from sqlmodel import Session

from app.models_tg import UserSetting, utc_now
from app.services.settings_registry import Home, require_home


def get_user_setting(session: Session, key: str, *, user_id: UUID) -> dict[str, Any]:
    """This account's stored value for `key`, or an empty dict if unset."""
    require_home(key, Home.USER)
    row = session.get(UserSetting, (key, user_id))
    return dict(row.value) if row else {}


def put_user_setting(
    session: Session,
    key: str,
    body: dict[str, Any],
    *,
    user_id: UUID,
) -> dict[str, Any]:
    """Merge `body` into this account's value for `key` and return the result.

    Merge for the same reason the global store merges: callers send the fields
    they changed. The composite primary key means one account's write cannot
    reach another's row, which is the whole reason this table exists.
    """
    require_home(key, Home.USER)
    row = session.get(UserSetting, (key, user_id))
    merged = {**(row.value if row else {}), **body}
    return _write(session, key, merged, user_id=user_id)


def replace_user_setting(
    session: Session,
    key: str,
    value: dict[str, Any],
    *,
    user_id: UUID,
) -> dict[str, Any]:
    """Store `value` as the whole row, dropping any key not in it.

    The counterpart of `settings_store.replace_global_setting`, and the verb a
    caller wants when it holds the complete section — `{}` here means "unset
    this", which a merge cannot express.
    """
    require_home(key, Home.USER)
    return _write(session, key, value, user_id=user_id)


def _write(
    session: Session, key: str, value: dict[str, Any], *, user_id: UUID
) -> dict[str, Any]:
    row = session.get(UserSetting, (key, user_id))
    if row:
        row.value = value
        row.updated_at = utc_now()
    else:
        row = UserSetting(key=key, value=value, user_id=user_id)
    session.add(row)
    session.commit()
    return value  # not `row.value` — see `settings_store.put_global_setting`.
