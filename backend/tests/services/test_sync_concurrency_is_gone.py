"""`syncConcurrency` is removed, and the removal narrowed nobody.

The setting told operators how many Channels to scrape at once. ADR-012 deleted
it because the answer already existed one layer down: the Partition is one Slot
per proxy slot, so its width *is* the fleet's capacity, and a second number an
operator maintained by hand could only ever disagree with it. The setting's own
UI copy said as much — it asked them to keep it at or below proxy capacity,
which is an invariant `min()` was already enforcing on their behalf.

**The removal has to be monotonic**, and that is the property worth asserting
rather than the deletion. Width goes from `min(3, sum)` to `sum`: one proxy
stays one, ten proxies go from three to ten, and a deployment with none keeps
the three it had, now as the direct Lane's width. Nobody scrapes more slowly
after an upgrade that advertises itself as removing a ceiling.

The stored value goes too. `tg_app_settings` keeps one JSON blob under `sync`
and `load_sync_settings` merges it over the code's defaults, so a leftover
field would keep being served to the browser as a setting that changes nothing
— and `_split_payload` drops unclassified fields on the way *in*, which is
precisely why nothing would have raised.
"""

from __future__ import annotations

import inspect
import pathlib

from sqlalchemy import text as sa_text
from sqlmodel import Session

from app.core.config import Settings
from app.jobs.settings import load_sync_settings
from app.services import proxy_pool, runtime_config, settings_registry
from app.services.proxy_pool import build_workers
from tests.utils.partition import direct_lane

APP = pathlib.Path(inspect.getfile(proxy_pool)).resolve().parents[1]


def _app_sources() -> list[pathlib.Path]:
    return [p for p in APP.rglob("*.py") if "alembic" not in p.parts]


def test_no_module_reads_the_setting() -> None:
    """A read left behind would resolve to the default for ever, silently."""
    offenders = [
        str(path.relative_to(APP.parent))
        for path in _app_sources()
        if '"syncConcurrency"' in path.read_text()
        or "'syncConcurrency'" in path.read_text()
    ]

    assert not offenders, (
        f"{offenders} still read `syncConcurrency` as a settings key; it is no "
        "longer written, so the read resolves to a default nothing can change"
    )


def test_it_is_not_classified_as_a_settings_field_any_more() -> None:
    """The other direction. A field left in the registry is a field the API
    accepts, stores and serves — a setting with a home and no reader."""
    assert "syncConcurrency" not in settings_registry.SYNC_POLICY_FIELDS
    assert "syncConcurrency" not in settings_registry.SYNC_PREF_FIELDS
    assert "syncConcurrency" not in settings_registry.SYNC_RUNTIME_FIELDS


def test_the_runtime_payload_no_longer_offers_it() -> None:
    from app.schemas.runtime_config import SyncRuntimeSettings

    assert "sync_concurrency" not in SyncRuntimeSettings.model_fields
    assert "syncConcurrency" not in inspect.getsource(
        runtime_config._sync_runtime_payload
    )


def test_the_removal_did_not_narrow_a_proxied_deployment() -> None:
    """`min(3, sum)` becomes `sum`. Ten one-slot proxies were three walks and
    are ten, which is the whole reason the ceiling was worth removing."""
    ten = [direct_lane(1) for _ in range(10)]
    for i, lane in enumerate(ten):
        lane.url = f"http://p{i}.example:8080"

    assert len(build_workers(ten)) == 10


def test_the_removal_did_not_narrow_a_proxy_less_deployment() -> None:
    """It had `syncConcurrency` workers fetching directly, default 3. It has
    the direct Lane, which is sized at or above that.

    `>=`, not `==`. The claim is "nobody narrows", and the direct Lane is per
    *process*: in the API it bounds every outbound request the tier makes,
    which nothing bounded before ADR-012, so review sized it above the worker's
    old scraping width rather than exactly at it.
    """
    assert (
        Settings.model_fields["DIRECT_LANE_CONCURRENCY_DEFAULT"].default
        >= Settings.model_fields["SYNC_CONCURRENCY_DEFAULT"].default
    )


def test_the_migration_strips_a_stored_value(db: Session) -> None:
    """A leftover is inert but not harmless: it is served back to the browser
    as a setting, and the person who changes it sees nothing happen."""
    db.execute(
        sa_text(
            """
            INSERT INTO tg_app_settings (key, value, updated_at)
            VALUES ('sync', '{"syncConcurrency": 7, "syncFailureBackoffMinutes": 4}',
                    now())
            ON CONFLICT (key) DO UPDATE
            SET value = '{"syncConcurrency": 7, "syncFailureBackoffMinutes": 4}'
            """
        )
    )
    db.commit()

    # The migration's own statement, run against the row it would find.
    db.execute(
        sa_text(
            """
            UPDATE tg_app_settings
            SET value = (value::jsonb - 'syncConcurrency')::json
            WHERE key = 'sync' AND value::jsonb ? 'syncConcurrency'
            """
        )
    )
    db.commit()

    merged = load_sync_settings(db)
    # Committed before asserting: the read above re-opened a transaction, and
    # this repo has recorded what an `idle in transaction` session does to the
    # autouse `TRUNCATE` — the suite hangs with no traceback rather than
    # failing (`MEMORY.md`, orm-read-after-commit-hangs-pytest). Found the
    # same way again writing this test.
    db.commit()

    assert "syncConcurrency" not in merged
    assert merged["syncFailureBackoffMinutes"] == 4, (
        "the key-delete took the rest of the blob with it"
    )
