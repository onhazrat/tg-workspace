"""PROTOTYPE (settings redesign), throwaway. Never mounted in the real API.

Answers one question: what if every setting were declared once, here, as a
pydantic model per settings row, and the frontend drew its rows from the
JSON Schema this serves?

- ``GET /settings/schema``: every row's JSON Schema, its scope (device /
  account / deployment), where it is stored, and whether the caller may edit.
- ``GET /settings/values``: values for the rows this prototype stores itself
  (the env policy knobs made runtime-editable, and the AI preferences moved
  from the browser to the account), with the source of each value.
- ``POST /settings/{row}/validate``: server-side validation for any row, so
  the bounds live in one place even for rows the real API still writes.
- ``PUT /settings/{row}``: validate, then upsert into the scratch schema.
  The real app never reads these, so a write here changes nothing live.
- ``GET /settings/env``: every ``config.py`` field classified as secret,
  startup wiring, or a policy knob with the row that now owns it.

Configuration only from the environment: ``PROTO_DSN`` (libpq string for the
read-only role), ``PROTO_API_BASE`` (the deployment's API, used to learn who
the caller is from their own token), ``PROTO_PORT``. Run from ``backend/``:

    PROTO_DSN=... PROTO_API_BASE=... PROTO_PORT=8030 \\
        uv run python scripts/proto_settings_api.py
"""

from __future__ import annotations

import os
import time
from typing import Any, Literal

import httpx
import psycopg
import uvicorn
from fastapi import FastAPI, Header, HTTPException
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, ValidationError

from app.core.config import Settings
from app.jobs.translation_batch import TRANSLATION_LANGUAGE_CODES
from app.services.configuration_catalog import _jsonable

DSN = os.environ["PROTO_DSN"]
API_BASE = os.environ["PROTO_API_BASE"].rstrip("/")
PORT = int(os.environ["PROTO_PORT"])

LANGUAGES = tuple(TRANSLATION_LANGUAGE_CODES)
Language = Literal[LANGUAGES]  # type: ignore[valid-type]


def env_default(name: str) -> Any:
    """The code default in ``config.py``: one source for every default."""
    return Settings.model_fields[name].default


Scope = Literal["device", "account", "deployment"]
#: ``browser``: localStorage, as today. ``server``: the real API's row, written
#: through the app as today. ``proto``: this prototype's scratch table.
Store = Literal["browser", "server", "proto"]


# --- Device: styling a person may want different on each browser ------------


class Appearance(BaseModel):
    theme: Literal["light", "dark", "system"] = Field(
        "dark", title="Color theme", description="Light, dark, or follow the system."
    )
    showChannelBio: bool = Field(True, title="Show channel bio")
    showChannelSubscribers: bool = Field(True, title="Show subscriber count")
    showChannelTelegramChatId: bool = Field(False, title="Show Telegram chat ID")
    showChannelPhotos: bool = Field(False, title="Show photo count")
    showChannelVideos: bool = Field(False, title="Show video count")
    showChannelFiles: bool = Field(False, title="Show file count")
    showChannelLinks: bool = Field(False, title="Show link count")
    showChannelStartId: bool = Field(False, title="Show start message ID")


# --- Account: follows the person to every device -----------------------------


class AiPrefs(BaseModel):
    selectedModel: str = Field(
        env_default("DEFAULT_AI_MODEL"),
        title="AI model",
        description="Model your Summaries, Chats and Tag runs use.",
    )
    aiLanguage: Language = Field(  # type: ignore[valid-type]
        "English",
        title="AI language",
        description="Language Summaries and Chat answers are written in.",
    )
    aiTemperature: float = Field(
        0.7,
        ge=0,
        le=1,
        title="AI temperature",
        description="Lower is more precise, higher more creative.",
    )


class SyncPrefs(BaseModel):
    dynamicSyncEnabledDefault: bool = Field(
        False,
        title="Dynamic sync for new follows",
        description="Sync busy channels more often than quiet ones.",
    )
    dynamicSyncExpectedPostsDefault: int = Field(
        15,
        ge=1,
        title="Dynamic sync expected posts",
        description="Posts per interval dynamic sync paces itself to.",
    )
    globalStartTimeMode: Literal["retention", "relative", "absolute"] = Field(
        "retention",
        title="Where new follows start",
        description="How far back a new follow scrapes.",
    )


class RetentionPrefs(BaseModel):
    logRetentionDays: int = Field(
        env_default("RETENTION_LOG_DAYS_DEFAULT"),
        ge=0,
        title="Your log retention (days)",
        description="Publish, LLM and embedding logs you produced. 0 keeps them forever.",
    )
    reportRetentionDays: int = Field(
        env_default("RETENTION_REPORT_DAYS_DEFAULT"),
        ge=0,
        title="Discover report retention (days)",
        description="0 keeps them forever.",
    )
    reportRetentionMax: int = Field(
        env_default("RETENTION_REPORT_MAX_DEFAULT"),
        ge=0,
        title="Discover reports kept",
        description="Oldest go first. 0 means no cap.",
    )


class Publishing(BaseModel):
    citationStyle: Literal["asWritten", "channelName", "numbered"] = Field(
        "asWritten",
        title="Citation style",
        description="How Citations read in a Publication.",
    )
    linkPreviews: bool = Field(
        False, title="Link previews", description="Let Telegram expand links."
    )
    timeZone: str = Field(
        "UTC", title="Time zone", description="IANA zone the time range is written in."
    )


# --- Deployment: one value for everyone, Admins set it ------------------------


class SyncPolicy(BaseModel):
    regularSyncIntervalMinutes: int = Field(
        env_default("AUTO_SYNC_INTERVAL_MINUTES_DEFAULT"),
        ge=5,
        le=1440,
        title="Sync interval (minutes)",
        description="How often auto-sync checks which channels are stale.",
    )
    syncFailureBackoffMinutes: int = Field(
        5,
        ge=1,
        title="Failure backoff (minutes)",
        description="Wait after a failed sync before retrying.",
    )


class RetentionPolicy(BaseModel):
    postRetentionDays: int = Field(
        env_default("RETENTION_POST_DAYS_DEFAULT"),
        ge=0,
        title="Post retention (days)",
        description="Posts every follower shares. 0 keeps them forever.",
    )
    sharedLogRetentionDays: int = Field(
        env_default("RETENTION_SHARED_LOG_DAYS_DEFAULT"),
        ge=0,
        title="Shared log retention (days)",
        description="Sync and network logs, and rows no account owns.",
    )
    payloadRetentionDays: int = Field(
        env_default("RETENTION_PAYLOAD_DAYS_DEFAULT"),
        ge=0,
        title="Sync body retention (days)",
        description="Raw sync responses kept for debugging.",
    )


class Translation(BaseModel):
    translationEnabled: bool = Field(
        False, title="Translation", description="Allow translating posts."
    )
    autoTranslate: bool = Field(
        False, title="Auto translate", description="Translate posts as they arrive."
    )
    translationTargetLanguage: Language = Field(  # type: ignore[valid-type]
        env_default("TRANSLATION_TARGET_LANGUAGE_DEFAULT"),
        title="Translate into",
    )
    translationModel: str = Field(
        env_default("DEFAULT_AI_MODEL"),
        title="Translation model",
        description="Runs on the Operator Key.",
    )


class Reach(BaseModel):
    settlingAgeHours: int = Field(
        24,
        ge=1,
        le=167,
        title="Settling age (hours)",
        description="How old a View count must be to count as Settled.",
    )
    estimationFloorHours: int = Field(
        3,
        ge=0,
        title="Estimation floor (hours)",
        description="Youngest View count corrected through the Settling curve.",
    )
    reachSampleSize: int = Field(
        100,
        ge=5,
        title="Reach sample size",
        description="How many of a Channel's newest Posts Reach reads.",
    )
    curveRefitIntervalHours: int = Field(
        24,
        ge=1,
        title="Curve refit interval (hours)",
        description="How often the worker refits the Settling curve.",
    )


class Jobs(BaseModel):
    embeddingsEnabled: bool = Field(
        env_default("JOBS_EMBEDDINGS_ENABLED_DEFAULT"),
        title="Embeddings",
        description="Embed posts for semantic search and RAG.",
    )


class Access(BaseModel):
    """New: was `.env` only, so changing it meant a redeploy."""

    USERS_OPEN_REGISTRATION: bool = Field(
        env_default("USERS_OPEN_REGISTRATION"),
        title="Open registration",
        description="Anyone can sign up. Off means an Admin adds accounts.",
    )
    USERS_REQUIRE_APPROVAL: bool = Field(
        env_default("USERS_REQUIRE_APPROVAL"),
        title="Require approval",
        description="New accounts wait for an Admin before they can use anything.",
    )


class Sessions(BaseModel):
    """New: was `.env` only."""

    ACCESS_TOKEN_EXPIRE_MINUTES: int = Field(
        env_default("ACCESS_TOKEN_EXPIRE_MINUTES"),
        ge=15,
        le=60 * 24 * 30,
        title="Login lasts (minutes)",
        description="How long a sign-in stays valid.",
    )
    VIEW_AS_TOKEN_EXPIRE_MINUTES: int = Field(
        env_default("VIEW_AS_TOKEN_EXPIRE_MINUTES"),
        ge=5,
        le=240,
        title="View-as session (minutes)",
    )
    VIEW_AS_ELEVATED_MAX_MINUTES: int = Field(
        env_default("VIEW_AS_ELEVATED_MAX_MINUTES"),
        ge=1,
        le=60,
        title="View-as write window, max (minutes)",
    )
    VIEW_AS_SPEND_MAX_MINUTES: int = Field(
        env_default("VIEW_AS_SPEND_MAX_MINUTES"),
        ge=1,
        le=60,
        title="View-as spend window, max (minutes)",
        description="Must stay shorter than the write window.",
    )


class Housekeeping(BaseModel):
    """New: was `.env` only."""

    SYNC_JOB_RETENTION_DAYS: int = Field(
        env_default("SYNC_JOB_RETENTION_DAYS"),
        ge=1,
        title="Sync job history (days)",
        description="Finished sync jobs older than this are pruned.",
    )
    SLOW_REQUEST_LOG_MS: int = Field(
        env_default("SLOW_REQUEST_LOG_MS"),
        ge=100,
        title="Slow request threshold (ms)",
        description="Requests slower than this are logged.",
    )


class Row(BaseModel):
    model: type[BaseModel]
    scope: Scope
    store: Store
    title: str


ROWS: dict[str, Row] = {
    "appearance": Row(
        model=Appearance, scope="device", store="browser", title="Appearance"
    ),
    "ai_prefs": Row(
        model=AiPrefs, scope="account", store="proto", title="AI preferences"
    ),
    "sync_prefs": Row(
        model=SyncPrefs, scope="account", store="server", title="Sync defaults"
    ),
    "retention_prefs": Row(
        model=RetentionPrefs, scope="account", store="server", title="Your retention"
    ),
    "publishing": Row(
        model=Publishing, scope="account", store="server", title="Publication options"
    ),
    "sync": Row(
        model=SyncPolicy, scope="deployment", store="server", title="Sync policy"
    ),
    "retention": Row(
        model=RetentionPolicy,
        scope="deployment",
        store="server",
        title="Retention policy",
    ),
    "translation": Row(
        model=Translation, scope="deployment", store="server", title="Translation"
    ),
    "reach": Row(model=Reach, scope="deployment", store="server", title="Reach"),
    "jobs": Row(
        model=Jobs, scope="deployment", store="server", title="Background jobs"
    ),
    "access": Row(model=Access, scope="deployment", store="proto", title="Access"),
    "sessions": Row(
        model=Sessions, scope="deployment", store="proto", title="Sessions"
    ),
    "housekeeping": Row(
        model=Housekeeping, scope="deployment", store="proto", title="Housekeeping"
    ),
}

#: Variant E: each setting's VS Code-style id, `namespace.section.name`. The id
#: is the address (search, deep links, layout); storage keys stay as they are.
NESTED_IDS: dict[str, str] = {
    "appearance.theme": "appearance.colorTheme",
    "appearance.showChannelBio": "appearance.channelCard.showBio",
    "appearance.showChannelSubscribers": "appearance.channelCard.showSubscribers",
    "appearance.showChannelTelegramChatId": "appearance.channelCard.showTelegramChatId",
    "appearance.showChannelPhotos": "appearance.channelCard.showPhotoCount",
    "appearance.showChannelVideos": "appearance.channelCard.showVideoCount",
    "appearance.showChannelFiles": "appearance.channelCard.showFileCount",
    "appearance.showChannelLinks": "appearance.channelCard.showLinkCount",
    "appearance.showChannelStartId": "appearance.channelCard.showStartMessageId",
    "ai_prefs.selectedModel": "ai.model",
    "ai_prefs.aiLanguage": "ai.language",
    "ai_prefs.aiTemperature": "ai.temperature",
    "translation.translationEnabled": "ai.translation.enabled",
    "translation.autoTranslate": "ai.translation.automatic",
    "translation.translationTargetLanguage": "ai.translation.targetLanguage",
    "translation.translationModel": "ai.translation.model",
    "jobs.embeddingsEnabled": "ai.embeddings.enabled",
    "sync_prefs.dynamicSyncEnabledDefault": "sync.newFollows.dynamicSync",
    "sync_prefs.dynamicSyncExpectedPostsDefault": "sync.newFollows.expectedPostsPerInterval",
    "sync_prefs.globalStartTimeMode": "sync.newFollows.startFrom",
    "sync.regularSyncIntervalMinutes": "sync.schedule.intervalMinutes",
    "sync.syncFailureBackoffMinutes": "sync.schedule.failureBackoffMinutes",
    "reach.settlingAgeHours": "sync.reach.settlingAgeHours",
    "reach.estimationFloorHours": "sync.reach.estimationFloorHours",
    "reach.reachSampleSize": "sync.reach.sampleSize",
    "reach.curveRefitIntervalHours": "sync.reach.curveRefitIntervalHours",
    "publishing.citationStyle": "publishing.citationStyle",
    "publishing.linkPreviews": "publishing.linkPreviews",
    "publishing.timeZone": "publishing.timeZone",
    "retention_prefs.logRetentionDays": "retention.yours.logDays",
    "retention_prefs.reportRetentionDays": "retention.yours.discoverReportDays",
    "retention_prefs.reportRetentionMax": "retention.yours.discoverReportLimit",
    "retention.postRetentionDays": "retention.shared.postDays",
    "retention.sharedLogRetentionDays": "retention.shared.logDays",
    "retention.payloadRetentionDays": "retention.shared.syncBodyDays",
    "access.USERS_OPEN_REGISTRATION": "access.registration.open",
    "access.USERS_REQUIRE_APPROVAL": "access.registration.requireApproval",
    "sessions.ACCESS_TOKEN_EXPIRE_MINUTES": "access.sessions.loginMinutes",
    "sessions.VIEW_AS_TOKEN_EXPIRE_MINUTES": "access.viewAs.sessionMinutes",
    "sessions.VIEW_AS_ELEVATED_MAX_MINUTES": "access.viewAs.writeWindowMaxMinutes",
    "sessions.VIEW_AS_SPEND_MAX_MINUTES": "access.viewAs.spendWindowMaxMinutes",
    "housekeeping.SYNC_JOB_RETENTION_DAYS": "system.syncJobs.historyDays",
    "housekeeping.SLOW_REQUEST_LOG_MS": "system.requests.slowThresholdMs",
}

#: A `.env` name's leading word that just repeats its group.
_GROUP_WORDS = {
    "network": {"network"},
    "sync": {"sync"},
    "retention": {"retention"},
    "directory": {"directory"},
}


def env_id(name: str, group: str) -> str:
    """`NETWORK_FETCH_INITIAL_DELAY_MS` under network → `network.fetch.initialDelayMs`."""
    words = name.lower().split("_")
    while len(words) > 1 and words[0] in _GROUP_WORDS.get(group, set()):
        words = words[1:]
    head, rest = words[0], words[1:]
    if not rest:
        return f"{group}.{head}"
    return f"{group}.{head}.{rest[0]}{''.join(w.capitalize() for w in rest[1:])}"


#: Every `config.py` field that is not a policy knob, with why it stays in `.env`.
SECRET = {
    "SECRET_KEY",
    "POSTGRES_PASSWORD",
    "SMTP_PASSWORD",
    "FIRST_SUPERUSER_PASSWORD",
    "GEMINI_API_KEY",
    "API_KEY",
    "TOKEN_ENCRYPTION_KEY",
    "TOR_CONTROL_PASSWORD",
    "SENTRY_DSN",
}
BOOTSTRAP = {
    "POSTGRES_SERVER",
    "POSTGRES_PORT",
    "POSTGRES_USER",
    "POSTGRES_DB",
    "FIRST_SUPERUSER",
    "ENVIRONMENT",
    "FRONTEND_HOST",
    "BACKEND_CORS_ORIGINS",
    "API_V1_STR",
    "PROJECT_NAME",
    "TENANCY_ENFORCED",
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_TLS",
    "SMTP_SSL",
    "EMAILS_FROM_EMAIL",
    "EMAILS_FROM_NAME",
    "EMAIL_TEST_USER",
    "TELEGRAM_WEB_DOMAIN",
    "CHANNEL_PHOTO_DIR",
    "POST_THUMB_DIR",
}


#: A seed is the starting value of a setting a row already edits; C shows it in
#: that row instead of as an entry of its own.
SEED_OF = {
    "AUTO_SYNC_INTERVAL_MINUTES_DEFAULT": "sync.regularSyncIntervalMinutes",
    "JOBS_EMBEDDINGS_ENABLED_DEFAULT": "jobs.embeddingsEnabled",
    "RETENTION_POST_DAYS_DEFAULT": "retention.postRetentionDays",
    "RETENTION_SHARED_LOG_DAYS_DEFAULT": "retention.sharedLogRetentionDays",
    "RETENTION_PAYLOAD_DAYS_DEFAULT": "retention.payloadRetentionDays",
    "RETENTION_LOG_DAYS_DEFAULT": "retention_prefs.logRetentionDays",
    "RETENTION_REPORT_DAYS_DEFAULT": "retention_prefs.reportRetentionDays",
    "RETENTION_REPORT_MAX_DEFAULT": "retention_prefs.reportRetentionMax",
    "TRANSLATION_TARGET_LANGUAGE_DEFAULT": "translation.translationTargetLanguage",
    "DEFAULT_AI_MODEL": "ai_prefs.selectedModel",
}

#: Which Settings group a `.env` value is shown under, by name prefix. First
#: match wins; anything unmatched is infrastructure.
GROUP_BY_PREFIX: tuple[tuple[str, str], ...] = (
    ("SYNC_JOB_RETENTION", "access"),
    ("SLOW_REQUEST", "access"),
    ("ACCESS_TOKEN", "access"),
    ("VIEW_AS_", "access"),
    ("USERS_", "access"),
    ("EMAIL_RESET", "access"),
    ("RETENTION_", "retention"),
    ("CHANNEL_PHOTO_ORPHAN", "retention"),
    ("CHANNEL_IMAGE_", "retention"),
    ("POST_THUMB_CACHE", "retention"),
    ("SYNC_", "sync"),
    ("AUTO_SYNC_", "sync"),
    ("SCRAPER_", "sync"),
    ("QUOTA_", "sync"),
    ("JOBS_", "sync"),
    ("AUTO_SUMMARY_", "sync"),
    ("NETWORK_", "network"),
    ("TOR_", "network"),
    ("PROXY_", "network"),
    ("DEFAULT_PROXY", "network"),
    ("DIRECT_LANE", "network"),
    ("TELEGRAM_API", "network"),
    ("EMBEDDING", "ai"),
    ("RAG_", "ai"),
    ("TRANSLATION_", "ai"),
    ("DEFAULT_AI_MODEL", "ai"),
    ("GEMINI_", "ai"),
    ("DIRECTORY_", "directory"),
    ("DISCOVER_", "directory"),
    ("POST_REFERENCE", "directory"),
    ("VIEW_OBSERVATION", "directory"),
    ("POST_LANGUAGE", "directory"),
)


def env_group(name: str) -> str:
    return next((g for p, g in GROUP_BY_PREFIX if name.startswith(p)), "infrastructure")


def env_kind(name: str) -> dict[str, Any]:
    for row_id, row in ROWS.items():
        if name in row.model.model_fields:
            return {
                "kind": "policy",
                "row": row_id,
                "reason": f"Editable in Settings → {row.title}",
            }
    if name in SECRET:
        return {
            "kind": "secret",
            "reason": "A secret, so never shown: anyone who reads it can sign in as any account or decrypt every stored credential, and a page that showed it would turn one stolen Admin session into that.",
        }
    if name in BOOTSTRAP:
        return {
            "kind": "bootstrap",
            "reason": "Needed before the database is reachable, or changes what the app is.",
        }
    if name.endswith("_DEFAULT"):
        return {
            "kind": "seed",
            "reason": "Only the starting value of a setting the app already lets you edit.",
        }
    return {
        "kind": "startup",
        "reason": "Read once when a process starts; making it live needs code that rebuilds what it configures.",
    }


# --- Storage and identity ------------------------------------------------------


def connect() -> psycopg.Connection[Any]:
    """One short connection per request: no pool, nothing held open."""
    conn = psycopg.connect(DSN, autocommit=True)
    conn.execute("SET max_parallel_workers_per_gather = 0")
    return conn


with connect() as conn:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS proto.settings_overrides (
            owner text NOT NULL,          -- 'deployment' or a user id
            row_id text NOT NULL,
            value jsonb NOT NULL,
            updated_at timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (owner, row_id)
        )
        """
    )

_who: dict[str, tuple[float, dict[str, Any]]] = {}


def whoami(authorization: str | None) -> dict[str, Any]:
    """Ask the deployment who this token is; Admin is the jobs-status read."""
    if not authorization:
        raise HTTPException(401, "Not authenticated")
    hit = _who.get(authorization)
    if hit and time.monotonic() - hit[0] < 60:
        return hit[1]
    headers = {"Authorization": authorization}
    with httpx.Client(base_url=API_BASE, timeout=15) as client:
        me = client.get("/api/v1/users/me", headers=headers)
        if me.status_code != 200:
            raise HTTPException(me.status_code, "Not authenticated")
        admin = client.get("/api/v1/jobs/status", headers=headers).status_code == 200
    info = {"id": me.json()["id"], "admin": admin}
    _who[authorization] = (time.monotonic(), info)
    return info


def owner_for(row: Row, who: dict[str, Any]) -> str:
    return "deployment" if row.scope == "deployment" else str(who["id"])


def can_edit(row: Row, who: dict[str, Any]) -> bool:
    return row.scope != "deployment" or bool(who["admin"])


def deployment_env(authorization: str) -> dict[str, dict[str, Any]]:
    """The deployment's own `.env` values, from its configuration catalog."""
    with httpx.Client(base_url=API_BASE, timeout=20) as client:
        r = client.get(
            "/api/v1/data/configuration", headers={"Authorization": authorization}
        )
    if r.status_code != 200:
        return {}
    for layer in r.json()["layers"]:
        if layer["id"] == "deployment":
            return {e["key"]: e for e in layer["entries"]}
    return {}


def errors_of(exc: ValidationError) -> dict[str, str]:
    return {".".join(str(p) for p in e["loc"]): e["msg"] for e in exc.errors()}


# --- Routes ----------------------------------------------------------------------

app = FastAPI(title="PROTOTYPE settings schema")


@app.get("/settings/schema")
def schema(authorization: str | None = Header(None)) -> list[dict[str, Any]]:
    who = whoami(authorization)
    return [
        {
            "row": row_id,
            "title": row.title,
            "scope": row.scope,
            "store": row.store,
            "editable": can_edit(row, who),
            "schema": row.model.model_json_schema(),
            "ids": {
                name: NESTED_IDS.get(f"{row_id}.{name}", f"{row_id}.{name}")
                for name in row.model.model_fields
            },
        }
        for row_id, row in ROWS.items()
    ]


@app.get("/settings/values")
def values(authorization: str | None = Header(None)) -> dict[str, Any]:
    who = whoami(authorization)
    proto_rows = {k: r for k, r in ROWS.items() if r.store == "proto"}
    owners = {owner_for(r, who) for r in proto_rows.values()}
    with connect() as conn:
        stored = {
            (o, rid): v
            for o, rid, v in conn.execute(
                "SELECT owner, row_id, value FROM proto.settings_overrides WHERE owner = ANY(%s)",
                [list(owners)],
            )
        }
    env = deployment_env(authorization) if who["admin"] else {}
    out: dict[str, Any] = {}
    for row_id, row in proto_rows.items():
        saved = stored.get((owner_for(row, who), row_id), {})
        fields: dict[str, Any] = {}
        for name, field in row.model.model_fields.items():
            if name in saved:
                fields[name] = {"value": saved[name], "source": "set here"}
            elif name in env and env[name]["configured"]:
                fields[name] = {
                    "value": env[name]["value"],
                    "source": f"deployment {env[name]['source']}",
                }
            else:
                fields[name] = {"value": field.default, "source": "code default"}
        out[row_id] = fields
    return out


@app.post("/settings/{row_id}/validate")
def validate(
    row_id: str, body: dict[str, Any], authorization: str | None = Header(None)
) -> dict[str, Any]:
    whoami(authorization)
    row = ROWS.get(row_id)
    if row is None:
        raise HTTPException(404, "No such settings row")
    try:
        row.model.model_validate(body)
    except ValidationError as exc:
        return {"ok": False, "errors": errors_of(exc)}
    return {"ok": True, "errors": {}}


@app.put("/settings/{row_id}")
def put(
    row_id: str, body: dict[str, Any], authorization: str | None = Header(None)
) -> dict[str, Any]:
    who = whoami(authorization)
    row = ROWS.get(row_id)
    if row is None or row.store != "proto":
        raise HTTPException(404, "No such prototype-stored row")
    if not can_edit(row, who):
        raise HTTPException(403, "Only an Admin can change this.")
    unknown = set(body) - set(row.model.model_fields)
    if unknown:
        raise HTTPException(
            422, {"errors": dict.fromkeys(unknown, "not a field of this row")}
        )
    try:
        row.model.model_validate(body)
    except ValidationError as exc:
        raise HTTPException(422, {"errors": errors_of(exc)}) from exc
    with connect() as conn:
        conn.execute(
            """
            INSERT INTO proto.settings_overrides (owner, row_id, value)
            VALUES (%s, %s, %s)
            ON CONFLICT (owner, row_id) DO UPDATE
              SET value = proto.settings_overrides.value || EXCLUDED.value, updated_at = now()
            """,
            [owner_for(row, who), row_id, Jsonb(body)],
        )
    return {"ok": True}


@app.get("/settings/env")
def env(authorization: str | None = Header(None)) -> list[dict[str, Any]]:
    who = whoami(authorization)
    deployed = deployment_env(authorization) if who["admin"] else {}
    out = []
    for name in sorted(Settings.model_fields):
        entry = deployed.get(name, {})
        out.append(
            {
                "key": name,
                "value": entry.get("value"),
                "source": entry.get("source"),
                "configured": bool(entry.get("configured")),
                "codeDefault": None if name in SECRET else _jsonable(env_default(name)),
                "group": env_group(name),
                "id": env_id(name, env_group(name)),
                "seedOf": SEED_OF.get(name),
                **env_kind(name),
            }
        )
    return out


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=PORT)
