"""Every stored Setting field is declared exactly once (SET-02, ADR-032).

The Setting id is the public address of a Setting, and a declaration is the
only place that says what one is. These guards keep the declarations and the
storage they describe from drifting:

* every field of every settings key has exactly one declaration, or the key or
  field is excused with a reason (`NOT_SETTINGS`, `NOT_SETTING_FIELDS`), and a
  key nobody placed fails rather than going missing from the page;
* no Setting id is declared twice, and its segment matches the table that
  holds it (`yours` is `tg_user_settings`, `deployment` is `tg_app_settings`);
* every browser declaration names a key of the frontend schema, and every
  browser key of the schema is declared;
* a default seeded from `.env` is the loader's own, and every default passes
  its declaration's validation, so a reset never stores a value a write would
  refuse.

The field inventory is derived from the code that owns each key (the
registry's field sets, the loaders' defaults, the network UI keys, the Budget
enum), never listed here, so a field added to a loader fails until declared.

## Watched to fail

Each mutation applied alone, then reverted:

1. drop `reach.deployment.sampleSize` from `DECLARATIONS` → the coverage test
   fails naming `reach.reachSampleSize`;
2. declare `retention.yours.logDays` twice → the duplicate-id test fails;
3. rename `sync.yours.dynamicSyncDefault`'s segment to `deployment` → the
   segment test fails;
4. add a non-section key to `appSettingsSpec` in `schema.ts` → the browser test
   fails naming it;
5. point `retention.yours.logDays`'s `env` at `RETENTION_POST_DAYS_DEFAULT` →
   the seeded-default test fails;
6. give `network.deployment.torControlPort` a `min` of 10000 → the
   default-validates test fails.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.core.config import settings
from app.jobs.settings import (
    JOB_IDS,
    default_directory,
    default_media,
    default_translation,
)
from app.services import request_kinds
from app.services.network_settings import NETWORK_UI_KEYS
from app.services.quota import Budget, quota_settings_field
from app.services.reach import REACH_SETTING_FIELDS
from app.services.setting_declarations import (
    BY_ID,
    DECLARATIONS,
    NOT_SETTING_FIELDS,
    NOT_SETTINGS,
    TOPICS,
)
from app.services.settings_page import (
    LOADER_DEFAULTS,
    _default_publishing,
    resolve_default,
)
from app.services.settings_registry import (
    AI_PREF_FIELDS,
    GLOBAL_KEYS,
    REQUEST_KINDS_KEY,
    RETENTION_POLICY_FIELDS,
    RETENTION_PREF_FIELDS,
    SYNC_POLICY_FIELDS,
    SYNC_PREF_FIELDS,
    USER_KEYS,
    Home,
    home_for,
)
from app.services.settings_write import _type_refusal

FRONTEND = Path(__file__).resolve().parents[3] / "frontend/src"

#: Each Setting key's stored fields, from the module that owns the key.
FIELD_INVENTORY: dict[str, frozenset[str]] = {
    "jobs": frozenset(f"{job}.enabled" for job in JOB_IDS),
    "sync": SYNC_POLICY_FIELDS,
    "sync_prefs": SYNC_PREF_FIELDS,
    "retention": RETENTION_POLICY_FIELDS,
    "retention_prefs": RETENTION_PREF_FIELDS,
    "media": frozenset(default_media()),
    "translation": frozenset(default_translation()),
    "directory": frozenset(default_directory()),
    "reach": frozenset(REACH_SETTING_FIELDS),
    "publishing": frozenset(_default_publishing()),
    "ai_prefs": AI_PREF_FIELDS,
    "network": NETWORK_UI_KEYS,
    REQUEST_KINDS_KEY: request_kinds.STORED_FIELDS,
    "quota": frozenset(
        quota_settings_field(budget, kind)
        for budget in Budget
        for kind in ("Requests", "Ceiling")
    ),
}

SERVER = [d for d in DECLARATIONS if d.scope != "browser"]
BROWSER = [d for d in DECLARATIONS if d.scope == "browser"]


def test_every_settings_key_is_inventoried_or_excused() -> None:
    keys = set(GLOBAL_KEYS) | set(USER_KEYS)
    placed = set(FIELD_INVENTORY) | set(NOT_SETTINGS)
    assert keys - placed == set(), (
        "A settings key holds Settings nobody declared. Add its fields to "
        "FIELD_INVENTORY and declare them, or excuse it in NOT_SETTINGS."
    )
    assert set(FIELD_INVENTORY) & set(NOT_SETTINGS) == set()


def test_every_stored_field_has_exactly_one_declaration() -> None:
    declared: dict[tuple[str, str], list[str]] = {}
    for decl in SERVER:
        declared.setdefault((decl.key, decl.field), []).append(decl.id)
    twice = {pair: ids for pair, ids in declared.items() if len(ids) > 1}
    assert twice == {}

    stored = {(key, f) for key, fields in FIELD_INVENTORY.items() for f in fields}
    missing = stored - set(declared) - set(NOT_SETTING_FIELDS)
    assert missing == set(), f"Stored fields with no declaration: {sorted(missing)}"
    unknown = set(declared) - stored
    assert unknown == set(), f"Declarations of no stored field: {sorted(unknown)}"
    assert set(NOT_SETTING_FIELDS) <= stored


def test_no_setting_id_is_declared_twice() -> None:
    ids = [d.id for d in DECLARATIONS]
    assert len(ids) == len(set(ids)) == len(BY_ID)


def test_an_id_is_topic_segment_name_and_its_segment_is_its_table() -> None:
    topics = {tid for tid, _ in TOPICS}
    for decl in DECLARATIONS:
        topic, segment, *name = decl.id.split(".")
        assert topic in topics, decl.id
        assert segment in {"browser", "yours", "deployment"}, decl.id
        assert name and all(re.fullmatch(r"[a-z][A-Za-z0-9]*", n) for n in name), (
            decl.id
        )
        if decl.scope == "browser":
            continue
        expected = Home.USER if segment == "yours" else Home.GLOBAL
        assert home_for(decl.key) is expected, decl.id


def _schema_browser_keys() -> set[str]:
    """`appSettingsSpec`'s keys that no backend section mirrors."""
    source = (FRONTEND / "lib/settings/schema.ts").read_text()
    block = source.split("export const appSettingsSpec = {", 1)[1].split("\n}\n", 1)[0]
    entries = re.split(r"\n  (?=[A-Za-z]\w*:)", "\n" + block)
    keys: set[str] = set()
    for entry in entries:
        match = re.match(r"\s*([A-Za-z]\w*):\s*(.*)", entry, re.S)
        if not match:
            continue
        key, body = match.groups()
        named = re.fullmatch(r"(\w+),?\s*", body.strip())
        if named:
            spec = re.search(
                rf"const {named.group(1)}\b[^=]*=\s*\{{(.*?)\n\}}", source, re.S
            )
            body = spec.group(1) if spec else ""
        if "section:" not in body:
            keys.add(key)
    return keys


def test_browser_declarations_and_the_frontend_schema_agree() -> None:
    theme_key = re.search(
        r'THEME_STORAGE_KEY = "([^"]+)"',
        (FRONTEND / "lib/storage/scoped.ts").read_text(),
    )
    assert theme_key is not None
    declared = {d.key for d in BROWSER} - {theme_key.group(1)}
    schema = _schema_browser_keys()
    assert schema, "the schema parse found nothing"
    assert declared - schema == set(), "Browser declarations the schema lacks"
    assert schema - declared == set(), "Browser keys of the schema nobody declared"
    assert len(declared) == len([d for d in BROWSER if d.key != theme_key.group(1)])


def test_a_default_seeded_from_env_is_the_loaders_own() -> None:
    for decl in SERVER:
        if decl.env is None:
            continue
        assert decl.env in type(settings).model_fields, decl.id
        loader = LOADER_DEFAULTS.get(decl.key)
        if loader is None:
            continue
        value: object = loader()
        for part in decl.field.split("."):
            value = value[part]  # type: ignore[index]
        assert value == getattr(settings, decl.env), decl.id


def test_a_literal_default_is_only_where_no_loader_holds_one() -> None:
    for decl in SERVER:
        if decl.default is not None:
            assert decl.key not in LOADER_DEFAULTS, decl.id
            assert decl.env is None, decl.id


def test_every_default_resolves_and_passes_its_own_validation() -> None:
    for decl in SERVER:
        default = resolve_default(decl)
        assert default is not None or decl.nullable, decl.id
        assert _type_refusal(decl, default) is None, decl.id


def test_choices_are_declared_for_every_enum() -> None:
    for decl in DECLARATIONS:
        assert bool(decl.options) == (decl.type == "enum"), decl.id
