"""Which settings table a key lives in, and why (ticket 06).

Settings used to be one table, `tg_app_settings`, keyed by name alone with a
`user_id` column that recorded whoever wrote the row last. That column was a
stamp, not a scope: two accounts could not hold different values for the same
key, and the last save won. Ticket 06 splits the table in two — global rows an
Admin sets for the deployment, and per-User rows keyed by `(key, user_id)` —
so "whose setting is this?" is answered by which table the row is in rather
than by a convention someone has to remember.

This module is the answer to that question and nothing else: it holds no
`Session`, executes nothing, and is a **pure transform** in the sense
`tests/services/test_service_kinds.py` means. Both aggregates import it and
refuse a key that is not theirs, so neither can be talked into writing the
other's rows.

Every entry carries a sentence saying why. A bare set would be a list of names
that drifts the first time somebody adds a key in a hurry; the reason is what
makes the next person's choice a decision rather than a guess.
"""

from __future__ import annotations

from enum import StrEnum


class Home(StrEnum):
    """Which of the two settings tables a key's rows live in."""

    #: `tg_app_settings`. One row per key, no owner. Deployment policy.
    GLOBAL = "global"

    #: `tg_user_settings`. One row per key *per User*. Personal preference.
    USER = "user"


#: The `sync` blob's three destinations. Kept as constants rather than literals
#: because the facade, the migration, and the guard all have to agree on them,
#: and three spellings of the same string is how they stop agreeing.
SYNC_KEY = "sync"
SYNC_RUNTIME_KEY = "sync_runtime"
SYNC_PREFS_KEY = "sync_prefs"

#: Deployment scheduler policy: how often the tick runs, how many channels it
#: syncs at once, how long it waits after a failure. One answer per deployment
#: — the scheduler is a single process (see `test_worker_count.py`), so a
#: per-account concurrency would be a number nothing could honour.
SYNC_POLICY_FIELDS = frozenset(
    {
        "regularSyncIntervalMinutes",
        "syncConcurrency",
        "syncFailureBackoffMinutes",
    }
)

#: State the scheduler writes about itself. Not settings at all, really —
#: counters and a cursor that happened to share a JSON blob with settings,
#: which is exactly how a person saving a preference came to overwrite them.
SYNC_RUNTIME_FIELDS = frozenset(
    {
        "consecutiveFailures",
        "autoSyncPauseUntil",
        "autoSyncPartialCursor",
        "autoSyncPartialBatchSize",
    }
)

#: Defaults a person picks for the channels they follow: where a new follow
#: starts scraping from, and whether dynamic sync is on for it. Genuinely
#: personal — two accounts following the same channel can want different
#: history depths, and the corpus is shared so neither costs the other.
SYNC_PREF_FIELDS = frozenset(
    {
        "dynamicSyncEnabledDefault",
        "dynamicSyncExpectedPostsDefault",
        "globalStartTimeMode",
        "globalStartTimeValue",
    }
)


#: Deployment-wide keys: one row, shared by every account.
GLOBAL_KEYS: dict[str, str] = {
    "jobs": (
        "Which scheduled jobs run. There is one scheduler in one process, so "
        "an account cannot have its own answer to whether retention runs."
    ),
    SYNC_KEY: (
        "Scheduler policy — tick interval, concurrency, failure backoff. The "
        "same one-scheduler argument as `jobs`."
    ),
    SYNC_RUNTIME_KEY: (
        "The scheduler's own counters and pause. Written by the app, read by "
        "nothing a person edits; per-account copies would mean the scheduler "
        "honouring one account's pause on everyone's behalf."
    ),
    "retention": (
        "Deletes corpus rows every follower shares, so it is deployment "
        "policy an Admin sets (plan decision 4). Ticket 20 splits the log and "
        "report windows back out, where they genuinely are per-User."
    ),
    "media": (
        "Thumbnail cache size and write policy on the deployment's own disk. "
        "A per-account cache budget would be a number with no disk behind it."
    ),
    "translation": (
        "Read by `jobs/translation_batch.py`, which runs on the scheduler with "
        "no User in hand. Personal translation preferences are a later ticket; "
        "filing it per-User now would need an owner lookup to resolve."
    ),
    "network": (
        "Proxies and Tor: one egress configuration for the deployment, and "
        "Admin-gated (plan decision 23 makes the matching logs Admin-only)."
    ),
    "follows_backfill": (
        "A marker recording that the ticket 04 backfill completed. A fact "
        "about the database, not about anybody — and retention reads it before "
        "collecting channels, with no User in hand."
    ),
}

#: Per-User keys: one row per account, and two accounts never collide.
USER_KEYS: dict[str, str] = {
    SYNC_PREFS_KEY: (
        "Where a new follow starts and whether dynamic sync is on for it. Two "
        "accounts following one channel can want different history depths, and "
        "since the corpus is shared neither choice costs the other anything."
    ),
}


def home_for(key: str) -> Home:
    """Which table `key` belongs to.

    Raises `KeyError` for a key nobody classified, on purpose. The tempting
    default is "global, the way it used to be", which files a personal setting
    where every account shares it and looks correct until two people disagree
    about a value.
    """
    if key in GLOBAL_KEYS:
        return Home.GLOBAL
    if key in USER_KEYS:
        return Home.USER
    raise KeyError(
        f"Settings key {key!r} is not classified. Add it to GLOBAL_KEYS or "
        f"USER_KEYS in app/services/settings_registry.py with a reason."
    )


def require_home(key: str, expected: Home) -> None:
    """Refuse a key that belongs to the other table.

    Raises `ValueError` naming the key, so the two aggregates fail loudly at
    the call site rather than writing a row nothing will ever read back.
    """
    actual = home_for(key)
    if actual is not expected:
        raise ValueError(
            f"Settings key {key!r} is {actual.value}, not {expected.value}. "
            f"Write it through the aggregate that owns that table."
        )


def split_sync_payload(payload: dict[str, object]) -> dict[str, dict[str, object]]:
    """Fan one old-shape `sync` body out to the three keys it now lives under.

    Fields nobody classified are dropped rather than guessed at — the caller
    is a `PUT` body from a browser, and inventing a home for an unknown field
    is how a typo becomes a row. The result only holds the keys that actually
    received something, so an unchanged section is not rewritten.
    """
    homes = (
        (SYNC_KEY, SYNC_POLICY_FIELDS),
        (SYNC_RUNTIME_KEY, SYNC_RUNTIME_FIELDS),
        (SYNC_PREFS_KEY, SYNC_PREF_FIELDS),
    )
    out: dict[str, dict[str, object]] = {}
    for key, fields in homes:
        section = {k: v for k, v in payload.items() if k in fields}
        if section:
            out[key] = section
    return out
