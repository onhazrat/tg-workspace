"""PROTOTYPE, throw away: one registry of every setting, .env value and code constant.

Answers the settings-tab redesign prototype's question "what if Settings listed
everything the deployment is tuned by, addressed by nested ids, and said who may
change each one and when it takes effect". Never mounted in the real API.

Rows come from five places, all generated rather than listed:

- account / deployment: the real `build_configuration_catalog`, its `user` and
  `global` layers flattened field by field, defaults from the same code run
  against empty stores;
- env: every `Settings` field in `config.py`, parsed with its comment; values
  from the deployment's own `/data/configuration` (already redacted) for Admins;
- code: every module-level numeric or boolean UPPER_CASE constant in
  `backend/app` and `frontend/src`, with its comment and file:line.

Writes never reach the app: they land in `proto.settings_registry_overrides` and
only this API reads them back. Browser rows are added by the frontend.

Run from `backend/` with the DB tunnel up:
  PROTO_DSN="host=localhost port=5433 dbname=app user=<role>" \
  PROTO_API_BASE=<deployment api base> PROTO_PORT=8031 \
  uv run python scripts/proto_settings_registry_api.py
"""

from __future__ import annotations

import ast
import json
import os
import re
import time
import uuid
from contextlib import ExitStack
from functools import lru_cache
from pathlib import Path
from typing import Any
from unittest import mock

import httpx

# --- Point the app at the tunnel before anything imports its settings -------
_DSN = dict(part.split("=", 1) for part in os.environ["PROTO_DSN"].split())


def _pgpass(host: str, port: str, db: str, user: str) -> str:
    for line in (Path.home() / ".pgpass").read_text().splitlines():
        h, p, d, u, pw = line.split(":", 4)
        if (h, p, d, u) == (host, port, db, user):
            return pw
    raise SystemExit("no ~/.pgpass line for the prototype role")


os.environ.update(
    POSTGRES_SERVER=_DSN["host"],
    POSTGRES_PORT=_DSN["port"],
    POSTGRES_DB=_DSN["dbname"],
    POSTGRES_USER=_DSN["user"],
    POSTGRES_PASSWORD=_pgpass(_DSN["host"], _DSN["port"], _DSN["dbname"], _DSN["user"]),
    DB_POOL_SIZE="2",
    DB_MAX_OVERFLOW="0",
)

import uvicorn  # noqa: E402
from fastapi import FastAPI, Header, HTTPException, Request  # noqa: E402
from sqlalchemy import event, text  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app.core.db import engine  # noqa: E402
from app.core.permissions import Permission  # noqa: E402
from app.services import configuration_catalog as catalog  # noqa: E402
from app.services.rbac import permissions_for  # noqa: E402


@event.listens_for(engine, "connect")
def _no_parallel(dbapi_conn: Any, _record: Any) -> None:
    with dbapi_conn.cursor() as cur:
        cur.execute("SET max_parallel_workers_per_gather = 0")


API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
REPO = Path(__file__).resolve().parents[2]
SHARED = uuid.UUID(int=0)  # owner of deployment/env overrides

# --- Topics: the first segment of every id ----------------------------------
TOPICS = [
    ("account", "Account"),
    ("appearance", "Appearance"),
    ("sync", "Channels & sync"),
    ("ai", "AI & models"),
    ("publishing", "Publishing"),
    ("network", "Network"),
    ("retention", "Retention"),
    ("directory", "Directory & Discover"),
    ("reach", "Reach"),
    ("media", "Media"),
    ("jobs", "Background jobs"),
    ("quota", "Quota"),
    ("access", "Access & sessions"),
    ("email", "Email"),
    ("database", "Database"),
    ("server", "Server"),
]

SETTING_KEY_TOPIC = {
    "jobs": "jobs",
    "sync": "sync",
    "sync_prefs": "sync",
    "retention": "retention",
    "retention_prefs": "retention",
    "media": "media",
    "translation": "ai",
    "network": "network",
    "directory": "directory",
    "reach": "reach",
    "publishing": "publishing",
}
# Runtime state and markers, not settings.
# Lists, maps and derived state in the network blob: the Proxies and Tor
# panels own them, and a proxy list is not something to print in a row.
SKIPPED_FIELDS = {
    "proxyUrls",
    "proxyConcurrencyOverrides",
    "envFallbackConfigured",
    "usingEnvFallback",
    "torAvailable",
    "torControlPortDefault",
}
SKIPPED_KEYS = {
    "sync_runtime",
    "follows_backfill",
    "view_observations",
    "post_counters_moved",
    "settling_curve_runtime",
}

ENV_PREFIX_TOPIC = [
    (("AUTO_SYNC_", "SYNC_", "SCRAPE", "DYNAMIC_SYNC"), "sync"),
    (("RETENTION_",), "retention"),
    (("PROXY_", "NETWORK_", "TOR_", "DEFAULT_PROXY", "TELEGRAM_"), "network"),
    (("JOBS_",), "jobs"),
    (("DIRECTORY_", "DISCOVER_"), "directory"),
    (("QUOTA_",), "quota"),
    (
        ("USERS_", "ACCESS_TOKEN", "VIEW_AS_", "SECRET_KEY", "FIRST_SUPERUSER",
         "EMAIL_RESET", "TOKEN_ENCRYPTION", "API_KEY", "TENANCY"),
        "access",
    ),
    (("SMTP_", "EMAILS_", "EMAIL"), "email"),
    (("POSTGRES_", "DB_"), "database"),
    (("DEFAULT_AI", "GEMINI", "OPENAI", "AI_", "EMBEDDING", "TRANSLATION_", "LLM"), "ai"),
    (("POST_THUMB", "MEDIA", "CHANNEL_PHOTO"), "media"),
    (("REACH", "SETTLING", "VIEW_"), "reach"),
]

PATH_TOPIC = [
    (("sync", "scraper", "lane", "channel_claim", "schedule"), "sync"),
    (("proxy", "network", "tor"), "network"),
    (("directory", "discover", "references"), "directory"),
    (("summary", "chat", "prompts", "ai_", "llm", "embedding", "translation", "tag", "provider"), "ai"),
    (("retention",), "retention"),
    (("quota",), "quota"),
    (("reach", "settling", "view_observation"), "reach"),
    (("publish", "bot"), "publishing"),
    (("media", "thumb", "photo"), "media"),
    (("users", "auth", "view_as", "security", "rbac"), "access"),
    (("email",), "email"),
    (("post", "search", "language"), "sync"),
]

# Names a reader would choose over the stored field name.
NAME_OVERRIDES = {
    "retention_prefs.reportRetentionDays": "discoverReportDays",
    "retention_prefs.reportRetentionMax": "discoverReportMax",
    "retention_prefs.logRetentionDays": "logDays",
    "sync.regularSyncIntervalMinutes": "intervalMinutes",
}

# .env knobs that could be read from a settings row at runtime (research.md §4).
PROPOSED_RUNTIME = {
    "USERS_OPEN_REGISTRATION",
    "USERS_REQUIRE_APPROVAL",
    "SYNC_JOB_RETENTION_DAYS",
    "SLOW_REQUEST_LOG_MS",
    "ACCESS_TOKEN_EXPIRE_MINUTES",
    "VIEW_AS_TOKEN_EXPIRE_MINUTES",
    "VIEW_AS_ELEVATED_MAX_MINUTES",
    "VIEW_AS_SPEND_MAX_MINUTES",
}


def _camel(snake: str) -> str:
    head, *rest = snake.lower().strip("_").split("_")
    return head + "".join(part.title() for part in rest)


def _strip_topic(name: str, topic: str) -> str:
    """`postRetentionDays` under retention is `postDays`."""
    if name.startswith(topic) and len(name) > len(topic) and name[len(topic)].isupper():
        rest = name[len(topic):]
        return rest[0].lower() + rest[1:]
    return name.replace(topic.title(), "", 1) if topic.title() in name[1:] else name


def _humanize(name: str) -> str:
    words = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name).replace("_", " ").split()
    return " ".join(words).capitalize()


def _type_of(value: Any) -> str:
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str) or value is None:
        return "string"
    return "json"


def _first(pairs: list[tuple[tuple[str, ...], str]], name: str, default: str) -> str:
    """First topic one of whose needles starts a word of `name`."""
    words = [w for w in re.split(r"[/_.\-]", name.lower()) if w]
    for needles, topic in pairs:
        if any(w.startswith(n.lower().strip("_")) for n in needles for w in words):
            return topic
    return default


# --- Comments: the description of an env field or a constant -----------------
def _comment_above(lines: list[str], lineno: int) -> str:
    out: list[str] = []
    i = lineno - 2
    while i >= 0 and lines[i].strip().startswith("#"):
        out.append(re.sub(r"^#:?\s?", "", lines[i].strip()))
        i -= 1
    return " ".join(reversed(out)).strip()


@lru_cache(maxsize=1)
def env_fields() -> list[dict[str, Any]]:
    path = REPO / "backend/app/core/config.py"
    source = path.read_text()
    lines = source.splitlines()
    cls = next(
        n for n in ast.parse(source).body
        if isinstance(n, ast.ClassDef) and n.name == "Settings"
    )
    fields = []
    for node in cls.body:
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            fields.append(
                {
                    "name": node.target.id,
                    "annotation": ast.unparse(node.annotation),
                    "line": node.lineno,
                    "comment": _comment_above(lines, node.lineno),
                }
            )
    return fields


_CONST_TS = re.compile(r"^export const ([A-Z][A-Z0-9_]+)\s*(?::[^=]+)?=\s*([-\d_.*\s()+/]+|true|false)\s*$")


@lru_cache(maxsize=1)
def code_constants() -> list[dict[str, Any]]:
    found = []
    for path in sorted((REPO / "backend/app").rglob("*.py")):
        if "alembic" in path.parts:
            continue
        source = path.read_text()
        lines = source.splitlines()
        for node in ast.parse(source).body:
            if isinstance(node, ast.Assign) and len(node.targets) == 1:
                target, value = node.targets[0], node.value
            elif isinstance(node, ast.AnnAssign) and node.value is not None:
                target, value = node.target, node.value
            else:
                continue
            if not isinstance(target, ast.Name) or not target.id.lstrip("_").isupper():
                continue
            try:
                val = eval(compile(ast.Expression(value), "c", "eval"), {"__builtins__": {}}, {})
            except Exception:
                continue
            if isinstance(val, (bool, int, float)):
                found.append(
                    {
                        "name": target.id,
                        "value": val,
                        "expr": ast.unparse(value),
                        "file": str(path.relative_to(REPO)),
                        "line": node.lineno,
                        "comment": _comment_above(lines, node.lineno),
                    }
                )
    for path in sorted((REPO / "frontend/src").rglob("*.ts*")):
        if ".test." in path.name or "/client/" in str(path) or ".gen." in path.name:
            continue
        lines = path.read_text().splitlines()
        for i, line in enumerate(lines, 1):
            m = _CONST_TS.match(line.strip())
            if not m:
                continue
            raw = m.group(2).strip()
            try:
                val = {"true": True, "false": False}.get(raw)
                if val is None:
                    val = eval(raw.replace("_", ""), {"__builtins__": {}}, {})
            except Exception:
                continue
            found.append(
                {
                    "name": m.group(1),
                    "value": val,
                    "expr": raw,
                    "file": str(path.relative_to(REPO)),
                    "line": i,
                    "comment": _comment_above(
                        [ln.replace("/**", "#").replace("*/", "").replace(" * ", "# ").replace("//", "#") for ln in lines],
                        i,
                    ),
                }
            )
    return found


# --- Identity ---------------------------------------------------------------
_who: dict[str, dict[str, Any]] = {}


def whoami(authorization: str | None) -> dict[str, Any]:
    if not authorization:
        raise HTTPException(401, "log in first")
    if authorization not in _who:
        r = httpx.get(f"{API_BASE}/api/v1/users/me", headers={"Authorization": authorization}, timeout=20)
        if r.status_code != 200:
            raise HTTPException(r.status_code, r.text)
        _who[authorization] = r.json()
    return _who[authorization]


@lru_cache(maxsize=64)
def _deployment_env(authorization: str) -> dict[str, dict[str, Any]]:
    """The deployment's own .env values, redacted by the deployment."""
    r = httpx.get(f"{API_BASE}/api/v1/data/configuration", headers={"Authorization": authorization}, timeout=30)
    if r.status_code != 200:
        return {}
    layer = next(l for l in r.json()["layers"] if l["id"] == "deployment")
    return {e["key"]: e for e in layer["entries"]}


# --- Overrides (the only writes) --------------------------------------------
with engine.begin() as conn:
    conn.execute(
        text(
            "CREATE TABLE IF NOT EXISTS proto.settings_registry_overrides ("
            " id text, user_id uuid, value jsonb, updated_at timestamptz DEFAULT now(),"
            " PRIMARY KEY (id, user_id))"
        )
    )


def overrides(user_id: uuid.UUID) -> dict[tuple[str, uuid.UUID], Any]:
    with engine.connect() as conn:
        rows = conn.execute(
            text("SELECT id, user_id, value FROM proto.settings_registry_overrides WHERE user_id IN (:u, :s)"),
            {"u": user_id, "s": SHARED},
        ).all()
    return {(r.id, r.user_id): r.value for r in rows}


# --- Defaults: the same catalog code run against empty stores ----------------
@lru_cache(maxsize=1)
def layer_defaults() -> dict[str, dict[str, Any]]:
    targets = [
        "app.jobs.settings.get_global_setting",
        "app.jobs.settings.get_user_setting",
        "app.services.configuration_catalog.get_global_setting",
        "app.services.configuration_catalog.get_user_setting",
    ]
    with ExitStack() as stack, Session(engine) as session:
        for target in targets:
            stack.enter_context(mock.patch(target, return_value={}))
        stack.enter_context(
            mock.patch("app.services.network_settings.get_network_setting_row", return_value=None)
        )
        entries = catalog._global_entries(session) + catalog._user_entries(session, SHARED)
    return {e.key: e.value if isinstance(e.value, dict) else {} for e in entries}


def _flatten(prefix: str, value: Any) -> list[tuple[str, Any]]:
    if isinstance(value, dict) and value and all(isinstance(v, dict) for v in value.values()):
        return [(f"{prefix}{k}.{f}", v2) for k, v in value.items() for f, v2 in v.items()]
    if isinstance(value, dict):
        return [(f"{prefix}{k}", v) for k, v in value.items()]
    return []


# --- The registry -----------------------------------------------------------
_live_cache: dict[uuid.UUID, tuple[float, set[str], list[Any]]] = {}


def _live(user_id: uuid.UUID) -> tuple[set[str], list[Any]]:
    """Permissions and the real catalog, cached: ~12 s of round trips over the
    tunnel, and the prototype's own writes never change them.
    ponytail: 5-minute TTL, so a change made in the real app shows up late."""
    hit = _live_cache.get(user_id)
    if hit and time.monotonic() - hit[0] < 300:
        return hit[1], hit[2]
    with Session(engine) as session:
        perms = {p.value for p in permissions_for(session, user_id)}
        live = catalog._global_entries(session) + catalog._user_entries(session, user_id)
    _live_cache[user_id] = (time.monotonic(), perms, live)
    return perms, live

def build_rows(authorization: str, as_member: bool) -> dict[str, Any]:
    me = whoami(authorization)
    user_id = uuid.UUID(me["id"])
    all_perms, live = _live(user_id)
    perms = set() if as_member else all_perms
    admin = Permission.DATA_ADMIN.value in perms
    defaults = layer_defaults()
    stored = overrides(user_id)
    rows: list[dict[str, Any]] = []
    taken: set[str] = set()

    def add(row: dict[str, Any], owner: uuid.UUID) -> None:
        rid = row["id"]
        if rid in taken:
            rid = row["id"] = f"{rid}_{row['storage'].split('/')[-1].split('.')[0].split(':')[0]}"
        taken.add(rid)
        if (rid, owner) in stored:
            row["value"] = stored[(rid, owner)]
            row["overridden"] = True
        row["modified"] = row["value"] != row["default"]
        rows.append(row)

    for entry in live:
        if entry.key in SKIPPED_KEYS or entry.key not in SETTING_KEY_TOPIC:
            continue
        topic = SETTING_KEY_TOPIC[entry.key]
        account = entry.layer == "user"
        default_map = dict(_flatten("", defaults.get(entry.key, {})))
        for field, value in _flatten("", entry.value):
            if field in SKIPPED_FIELDS:
                continue
            name = NAME_OVERRIDES.get(f"{entry.key}.{field}") or _strip_topic(field.split(".")[-1], topic)
            if "." in field:  # jobs.<job>.enabled
                name = _camel(field.split(".")[0]) + "Enabled"
            scope = "account" if account else "deployment"
            can_edit = account or admin
            add(
                {
                    "id": f"{topic}.{'yours' if account else 'deployment'}.{name}",
                    "title": _humanize(name),
                    "description": "",
                    "topic": topic,
                    "scope": scope,
                    "type": _type_of(value if value is not None else default_map.get(field)),
                    "value": value,
                    "default": default_map.get(field),
                    "canEdit": can_edit and _type_of(value) != "json",
                    "lockReason": None if can_edit else "Managed by an Admin",
                    "applies": "now",
                    "storage": f"{'tg_user_settings' if account else 'tg_app_settings'}.{entry.key}.{field}",
                    "sensitive": entry.key == "network" and "prox" in field.lower(),
                },
                user_id if account else SHARED,
            )

    if admin:
        env_values = _deployment_env(authorization)
        for f in env_fields():
            name = f["name"]
            topic = next(
                (t for prefixes, t in ENV_PREFIX_TOPIC if name.startswith(prefixes)), "server"
            )
            live_entry = env_values.get(name, {})
            sensitive = bool(live_entry.get("sensitive")) or name.endswith(("_KEY", "_TOKEN", "_SECRET", "_PASSWORD", "_DSN"))
            value = live_entry.get("value")
            default = live_entry.get("defaultValue")
            if sensitive:
                value = "set" if live_entry.get("configured") else "not set"
                default = "not set"
            runtime = name in PROPOSED_RUNTIME
            short = _strip_topic(_camel(name), topic)
            add(
                {
                    "id": f"{topic}.env.{short}",
                    "title": _humanize(short),
                    "description": f["comment"],
                    "topic": topic,
                    "scope": "env",
                    "type": "string" if sensitive else _type_of(value if value is not None else default),
                    "value": value,
                    "default": default,
                    "canEdit": runtime and not sensitive,
                    "lockReason": None if runtime else (
                        "Secret: shown as set / not set only" if sensitive
                        else "Read at startup: change .env and restart"
                    ),
                    "applies": "now (proposed)" if runtime else "restart",
                    "storage": f".env {name}",
                    "envName": name,
                    "annotation": f["annotation"],
                    "source": live_entry.get("source"),
                    "sourceRef": f"backend/app/core/config.py:{f['line']}",
                    "sensitive": sensitive,
                },
                SHARED,
            )
        for c in code_constants():
            module = Path(c["file"]).stem
            topic = _first(PATH_TOPIC, c["file"].lower(), "server")
            short = _camel(c["name"])
            add(
                {
                    "id": f"{topic}.code.{short}",
                    "title": _humanize(short),
                    "description": c["comment"],
                    "topic": topic,
                    "scope": "code",
                    "type": _type_of(c["value"]),
                    "value": c["value"],
                    "default": c["value"],
                    "canEdit": False,
                    "lockReason": "Constant in code: change it in a commit and deploy",
                    "applies": "deploy",
                    "storage": f"{c['file']}:{c['line']}",
                    "sourceRef": f"{c['file']}:{c['line']}",
                    "expr": c["expr"],
                    "module": module,
                    "sensitive": False,
                },
                SHARED,
            )

    return {
        "user": {"id": me["id"], "email": me["email"], "fullName": me.get("full_name"), "permissions": sorted(perms), "isAdmin": admin},
        "topics": [{"id": t, "title": title} for t, title in TOPICS],
        "rows": rows,
    }


app = FastAPI(title="PROTOTYPE settings registry")


@app.get("/proto/settings")
def get_settings(request: Request, authorization: str | None = Header(None)) -> dict[str, Any]:
    return build_rows(authorization or "", request.query_params.get("as") == "member")


@app.put("/proto/settings/{row_id}")
def put_setting(row_id: str, body: dict[str, Any], request: Request, authorization: str | None = Header(None)) -> dict[str, Any]:
    reg = build_rows(authorization or "", request.query_params.get("as") == "member")
    row = next((r for r in reg["rows"] if r["id"] == row_id), None)
    if row is None:
        raise HTTPException(404, "No such setting")
    if not row["canEdit"]:
        raise HTTPException(403, row["lockReason"] or "Not editable")
    owner = uuid.UUID(reg["user"]["id"]) if row["scope"] == "account" else SHARED
    with engine.begin() as conn:
        if body.get("reset"):
            conn.execute(text("DELETE FROM proto.settings_registry_overrides WHERE id=:i AND user_id=:u"), {"i": row_id, "u": owner})
        else:
            conn.execute(
                text(
                    "INSERT INTO proto.settings_registry_overrides (id, user_id, value) VALUES (:i, :u, CAST(:v AS jsonb))"
                    " ON CONFLICT (id, user_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"
                ),
                {"i": row_id, "u": owner, "v": json.dumps(body.get("value"))},
            )
    return {"ok": True}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PROTO_PORT", "8031")))
