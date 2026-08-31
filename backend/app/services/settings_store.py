"""Aggregate for `tg_app_settings` — the deployment-wide half of the settings.

The **only** module that writes this table. Its counterpart is
`user_settings.py`, which owns `tg_user_settings`, and both refuse a key that
belongs to the other by asking `settings_registry.home_for`. One writer per
table is what makes that refusal worth having: a second writer would be a
second opinion about where a key belongs, and
`tests/services/test_settings_table_split.py` walks the AST to keep it at one.

Every function here takes a key that must be global. It has no user-facing
default for an unclassified key, deliberately — see `home_for`.
"""

from __future__ import annotations

from typing import Any

from sqlmodel import Session

from app.models_tg import AppSetting, utc_now
from app.services.settings_registry import Home, require_home


def get_global_setting(session: Session, key: str) -> dict[str, Any]:
    """The stored value for `key`, or an empty dict if nothing is stored yet."""
    require_home(key, Home.GLOBAL)
    row = session.get(AppSetting, key)
    return dict(row.value) if row else {}


def put_global_setting(
    session: Session,
    key: str,
    body: dict[str, Any],
) -> dict[str, Any]:
    """Merge `body` into the stored value and return the result.

    Merge rather than replace, because callers PUT the fields they changed —
    `data/admin.py` forwards a browser body and the scheduler updates one
    counter.

    **No `user_id`.** It was the "last written by" stamp on `AppSetting`, and
    ticket 22 dropped both. `tg_app_settings` is keyed by `key` alone, so there
    is one value per deployment and no account it could belong to — a column
    that reads like an owner without being one is the `operator.py` ambiguity
    the ticket 06 split exists to remove.
    """
    require_home(key, Home.GLOBAL)
    row = session.get(AppSetting, key)
    merged = {**(row.value if row else {}), **body}
    if row:
        row.value = merged
        row.updated_at = utc_now()
    else:
        row = AppSetting(key=key, value=merged)
    session.add(row)
    session.commit()
    # `merged`, not `row.value`. Reading an attribute back after a commit
    # re-selects the expired row, which opens a *new* transaction that nothing
    # here closes — on a long-lived session that leaves it idle in transaction
    # holding a lock, and the test suite's after-test TRUNCATE blocks on it
    # forever. The value is already in hand; there is nothing to fetch.
    return merged


def replace_global_setting(
    session: Session,
    key: str,
    value: dict[str, Any],
) -> dict[str, Any]:
    """Store `value` as the whole row, dropping any key not in it.

    The `network` settings path needs this: `merge_network_put` has already
    done a merge that understands proxy lists and Tor modes, so a second blind
    merge here would resurrect proxy URLs the operator just removed.

    Lost its `user_id` with `put_global_setting` above, for the same reason.
    """
    require_home(key, Home.GLOBAL)
    row = session.get(AppSetting, key)
    if row:
        row.value = value
        row.updated_at = utc_now()
    else:
        row = AppSetting(key=key, value=value)
    session.add(row)
    session.commit()
    return value  # not `row.value` — see `put_global_setting`.
