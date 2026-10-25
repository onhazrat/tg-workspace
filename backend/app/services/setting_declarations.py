"""Every Setting, declared once and addressed by its Setting id (SET-02, ADR-032).

`settings_registry.py` answers which table a settings key lives in. This module
answers what each *field* of each key is to the Account reading the Settings
page: its Setting id (`retention.yours.discoverReportDays`), title, description,
type and bounds, who may see it, and which `.env` value seeds its default when
one does. Browser Settings are declared here too, with scope "browser", and are
stored by the frontend.

**The Setting id is the public address**, chosen rather than derived from the
storage key: `<topic>.<segment>.<name>`, where the segment is `browser`, `yours`
or `deployment`. Links, search and the command palette name it, so renaming one
breaks links; ids carry no former names.

**Defaults are not restated here.** A default is what the existing loaders in
`jobs/settings.py` (and their siblings) answer against an empty store, or the
`.env` value `env` names. `default` is set only where no loader held one, which
is the Tor fields: their only default used to live in the browser.

A **pure transform** (`tests/services/test_service_kinds.py`): data and two
lookups, no `Session`. `tests/services/test_setting_declarations.py` fails when
a stored field has no declaration or two, when an id is declared twice, or when
a browser declaration and the frontend schema disagree.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.jobs.translation_batch import TRANSLATION_LANGUAGE_CODES
from app.schemas.settings_registry import SettingRowType
from app.services.network_settings import PROXY_CONCURRENCY_MAX, PROXY_CONCURRENCY_MIN
from app.services.publication_parts import CITATION_STYLES
from app.services.settings_registry import (
    AI_PREFS_KEY,
    DIRECTORY_COLUMNS_KEY,
    DIRECTORY_KEY,
    POST_COUNTERS_MOVED_KEY,
    PUBLISHING_KEY,
    QUOTA_KEY,
    REACH_KEY,
    REFERENCE_GRAPH_KEY,
    REQUEST_ROLLUP_KEY,
    RETENTION_KEY,
    RETENTION_PREFS_KEY,
    SETTLING_CURVE_RUNTIME_KEY,
    SYNC_KEY,
    SYNC_LANES_KEY,
    SYNC_PREFS_KEY,
    SYNC_RUNTIME_KEY,
    VIEW_OBSERVATIONS_KEY,
)

#: One list of value types, the wire's: a declaration is what a row is built from.
SettingType = SettingRowType
SettingScope = Literal["browser", "account", "deployment"]
#: Who sees a Setting: every Account, for what affects them; holders of
#: `settings:manage`, for the infrastructure (plan decision 20).
Visibility = Literal["everyone", "manage"]

_SCOPE_OF_SEGMENT: dict[str, SettingScope] = {
    "browser": "browser",
    "yours": "account",
    "deployment": "deployment",
}

#: The page's topics, in page order (spec, "The registry").
TOPICS: tuple[tuple[str, str], ...] = (
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
    ("operator", "Operator"),
)

#: Settings keys that hold no Setting at all, each with the reason. Runtime
#: counters and markers the app writes about itself, and controls that have a
#: panel of their own.
NOT_SETTINGS: dict[str, str] = {
    SYNC_RUNTIME_KEY: "The scheduler's own counters and pause, written by the app.",
    "follows_backfill": "A marker that a one-off backfill completed.",
    VIEW_OBSERVATIONS_KEY: "The Observation stride the app's controller writes.",
    POST_COUNTERS_MOVED_KEY: "A marker that a one-off data move found nothing left.",
    SETTLING_CURVE_RUNTIME_KEY: "When the Settling curve fit last learned nothing.",
    REQUEST_ROLLUP_KEY: "How far the Request totals are rolled up, written by the app.",
    REFERENCE_GRAPH_KEY: "The instant the reference graph was created, written once.",
    SYNC_LANES_KEY: "Which sync lanes are paused, run from the lane controls.",
    DIRECTORY_COLUMNS_KEY: (
        "A list of columns, chosen from the Directory's Columns menu rather "
        "than as one value."
    ),
}

#: Stored fields of a Setting key that are not rows, each with the reason.
NOT_SETTING_FIELDS: dict[tuple[str, str], str] = {
    ("network", "proxyUrls"): "The proxy pool is a list; the Proxies panel owns it.",
    ("network", "proxyConcurrencyOverrides"): (
        "Per-proxy slots are a map; the Proxies panel owns them."
    ),
}


@dataclass(frozen=True)
class Declaration:
    """One Setting: its address, what it is, and where it is kept."""

    id: str
    title: str
    #: Written for the Account, not for a developer.
    description: str
    type: SettingType
    #: The settings key that holds it, or the browser storage key.
    key: str
    #: A dotted path inside the key's value; empty for a browser Setting.
    field: str = ""
    options: tuple[tuple[str, str], ...] = ()
    min: float | None = None
    max: float | None = None
    visible: Visibility = "everyone"
    #: The `Settings` field (`.env`) that seeds the default, when one does.
    env: str | None = None
    #: The default, only where no loader holds one.
    default: object = None
    #: Why a row is read-only on the page whoever reads it.
    lock: str | None = None
    #: Whether null is a value the Setting may hold.
    nullable: bool = False

    @property
    def topic(self) -> str:
        return self.id.split(".")[0]

    @property
    def scope(self) -> SettingScope:
        return _SCOPE_OF_SEGMENT[self.id.split(".")[1]]


def _choices(*pairs: tuple[str, str]) -> tuple[tuple[str, str], ...]:
    return pairs


_LANGUAGES = tuple((name, name) for name in TRANSLATION_LANGUAGE_CODES)
_CITATION_LABELS = {
    "asWritten": "As written",
    "channelName": "Channel name",
    "numbered": "Numbered",
}


def _browser(
    id: str,
    key: str,
    title: str,
    description: str,
    type: SettingType,
    *,
    options: tuple[tuple[str, str], ...] = (),
    min: float | None = None,
    max: float | None = None,
    lock: str | None = None,
) -> Declaration:
    return Declaration(
        id=id,
        title=title,
        description=description,
        type=type,
        key=key,
        options=options,
        min=min,
        max=max,
        lock=lock,
    )


def _card(name: str, key: str, what: str) -> Declaration:
    return _browser(
        f"appearance.browser.{name}",
        key,
        f"Show {what} on channel cards",
        f"Channel cards in the Channels tab show the channel's {what}.",
        "boolean",
    )


_JOB_TITLES = {
    "auto_sync": ("autoSync", "Auto sync", "Syncs followed channels on a schedule."),
    "embeddings": (
        "embeddings",
        "Embeddings",
        "Builds the vectors semantic search reads.",
    ),
    "auto_summary": ("autoSummary", "Auto summary", "Runs scheduled Summaries."),
    "retention": ("retention", "Retention", "Deletes rows older than their window."),
    "translation_batch": (
        "translationBatch",
        "Translation batch",
        "Translates new Posts in the background.",
    ),
    "discover_probe": (
        "discoverProbe",
        "Discover probe",
        "Checks the channels Discover finds.",
    ),
    "directory_harvest": (
        "directoryHarvest",
        "Directory harvest",
        "Adds the channels Posts mention to the Directory.",
    ),
    "post_language": ("postLanguage", "Post language", "Detects each Post's language."),
    "view_observation_stride": (
        "viewObservationStride",
        "View observation stride",
        "Keeps the View observations table under its row cap.",
    ),
    "settling_curve_fit": (
        "settlingCurveFit",
        "Settling curve fit",
        "Refits the curve Reach corrects young View counts with.",
    ),
}

_JOB_ENV = {
    "auto_sync": "JOBS_AUTO_SYNC_ENABLED_DEFAULT",
    "embeddings": "JOBS_EMBEDDINGS_ENABLED_DEFAULT",
    "auto_summary": "JOBS_AUTO_SUMMARY_ENABLED_DEFAULT",
    "retention": "JOBS_RETENTION_ENABLED_DEFAULT",
    "translation_batch": "JOBS_TRANSLATION_BATCH_ENABLED_DEFAULT",
    "discover_probe": "JOBS_DISCOVER_PROBE_ENABLED_DEFAULT",
    "directory_harvest": "JOBS_DIRECTORY_HARVEST_ENABLED_DEFAULT",
}

_BUDGETS = (
    ("autoSync", "auto_sync", "Auto sync", "AUTO_SYNC"),
    ("manualBulk", "manual_bulk", "Manual bulk sync", "MANUAL_BULK"),
    ("manualSingle", "manual_single", "Manual single sync", "MANUAL_SINGLE"),
)


def _quota() -> list[Declaration]:
    rows: list[Declaration] = []
    for name, _budget, label, env in _BUDGETS:
        rows.append(
            Declaration(
                id=f"quota.deployment.{name}Allowance",
                title=f"{label} allowance",
                description=(
                    f"Telegram Requests an Account may make per day on the {label} "
                    "Budget before its syncs move to the slower lane. Negative "
                    "means unlimited."
                ),
                type="integer",
                key=QUOTA_KEY,
                field=f"{name}Requests",
                visible="manage",
                env=f"QUOTA_DEFAULT_{env}_REQUESTS",
            )
        )
        rows.append(
            Declaration(
                id=f"quota.deployment.{name}Ceiling",
                title=f"{label} ceiling",
                description=(
                    f"Telegram Requests per day on the {label} Budget past which "
                    "nothing more runs. Negative means unlimited."
                ),
                type="integer",
                key=QUOTA_KEY,
                field=f"{name}Ceiling",
                visible="manage",
                env=f"QUOTA_DEFAULT_{env}_CEILING_REQUESTS",
            )
        )
    return rows


DECLARATIONS: tuple[Declaration, ...] = (
    # --- Appearance (browser) ----------------------------------------------
    _browser(
        "appearance.browser.theme",
        "vite-ui-theme",
        "Color theme",
        "Light, dark, or follow the system.",
        "enum",
        options=_choices(("light", "Light"), ("dark", "Dark"), ("system", "System")),
    ),
    _card("cardBio", "showChannelBio", "bio"),
    _card("cardSubscribers", "showChannelSubscribers", "subscriber count"),
    _card("cardChatId", "showChannelTelegramChatId", "Telegram chat id"),
    _card("cardPhotos", "showChannelPhotos", "photo count"),
    _card("cardVideos", "showChannelVideos", "video count"),
    _card("cardFiles", "showChannelFiles", "file count"),
    _card("cardLinks", "showChannelLinks", "link count"),
    _card("cardStartId", "showChannelStartId", "start message id"),
    _browser(
        "appearance.browser.cardZoom",
        "channelCardZoom",
        "Channel card size",
        "How dense the Channels tab's cards are.",
        "enum",
        options=_choices(
            ("-2", "Tiles"), ("-1", "Compact"), ("0", "Normal"), ("1", "Full")
        ),
    ),
    _browser(
        "appearance.browser.summaryTextSize",
        "summaryTextSize",
        "Summary text size",
        "How large the Summary tab's prose is.",
        "enum",
        options=_choices(("S", "Small"), ("M", "Medium"), ("L", "Large")),
    ),
    _browser(
        "appearance.browser.focusMode",
        "workspaceFocusMode",
        "Focus mode",
        "Hides the workspace chrome around the open tab.",
        "boolean",
    ),
    # --- Channels & sync ---------------------------------------------------
    _browser(
        "sync.browser.selectedFirst",
        "channelGridGroupBySelection",
        "Selected channels first",
        "The Channels grid lists selected channels first and frozen ones last.",
        "boolean",
    ),
    _browser(
        "sync.browser.actionLimit",
        "channelActionLimit",
        "Actions reach",
        "Whether channel actions reach only the channels shown, or the hidden "
        "selection too.",
        "enum",
        options=_choices(("shown", "Shown only"), ("all", "Hidden too")),
    ),
    Declaration(
        id="sync.deployment.intervalMinutes",
        title="Sync interval",
        description="How stale a followed channel may get before auto sync fetches it again, in minutes.",
        type="integer",
        key=SYNC_KEY,
        field="regularSyncIntervalMinutes",
        min=1,
        max=24 * 60,
        env="AUTO_SYNC_INTERVAL_MINUTES_DEFAULT",
    ),
    Declaration(
        id="sync.deployment.failureBackoffMinutes",
        title="Failure backoff",
        description="Minutes the scheduler waits after a failed sync before trying again.",
        type="integer",
        key=SYNC_KEY,
        field="syncFailureBackoffMinutes",
        min=1,
        visible="manage",
    ),
    Declaration(
        id="sync.yours.dynamicSyncDefault",
        title="Dynamic sync for new channels",
        description="Whether a channel you follow starts with dynamic sync on.",
        type="boolean",
        key=SYNC_PREFS_KEY,
        field="dynamicSyncEnabledDefault",
    ),
    Declaration(
        id="sync.yours.dynamicSyncExpectedPosts",
        title="Dynamic sync expected Posts",
        description="Posts per interval dynamic sync paces a new channel for.",
        type="integer",
        key=SYNC_PREFS_KEY,
        field="dynamicSyncExpectedPostsDefault",
        min=1,
    ),
    Declaration(
        id="sync.yours.startTimeMode",
        title="Start time for new channels",
        description="Where a channel you follow starts syncing from: the retention window, some days back, or a date.",
        type="enum",
        key=SYNC_PREFS_KEY,
        field="globalStartTimeMode",
        options=_choices(
            ("retention", "Retention window"),
            ("relative", "Days back"),
            ("absolute", "A date"),
        ),
    ),
    Declaration(
        id="sync.yours.startTimeValue",
        title="Start time value",
        description="Days back, or an ISO date, for the start time above. Empty uses the retention window.",
        type="json",
        key=SYNC_PREFS_KEY,
        field="globalStartTimeValue",
        nullable=True,
    ),
    # --- AI & models ---------------------------------------------------------
    Declaration(
        id="ai.yours.language",
        title="AI language",
        description="The language Summaries and Chat answer in.",
        type="enum",
        key=AI_PREFS_KEY,
        field="aiLanguage",
        options=_LANGUAGES,
        env="DEFAULT_AI_LANGUAGE",
    ),
    Declaration(
        id="ai.yours.model",
        title="AI model",
        description="The model id Summaries, Chats and Tag runs use.",
        type="string",
        key=AI_PREFS_KEY,
        field="selectedModel",
        env="DEFAULT_AI_MODEL",
    ),
    Declaration(
        id="ai.yours.temperature",
        title="AI temperature",
        description="Lower is more precise, higher more inventive.",
        type="number",
        key=AI_PREFS_KEY,
        field="aiTemperature",
        min=0,
        max=1,
    ),
    _browser(
        "ai.browser.embeddings",
        "embeddingsEnabled",
        "Semantic search",
        "Use vector embeddings for semantic search and Chat.",
        "boolean",
    ),
    _browser(
        "ai.browser.embeddingsPaused",
        "embeddingsPaused",
        "Pause embeddings",
        "Pause building embeddings for a while.",
        "boolean",
    ),
    Declaration(
        id="ai.deployment.translation",
        title="Translation",
        description="Whether Posts may be translated.",
        type="boolean",
        key="translation",
        field="translationEnabled",
    ),
    Declaration(
        id="ai.deployment.autoTranslate",
        title="Translate automatically",
        description="Translate new Posts in the background as they arrive.",
        type="boolean",
        key="translation",
        field="autoTranslate",
    ),
    Declaration(
        id="ai.deployment.translationModel",
        title="Translation model",
        description="The model id translations use.",
        type="string",
        key="translation",
        field="translationModel",
        env="DEFAULT_AI_MODEL",
    ),
    Declaration(
        id="ai.deployment.translationLanguage",
        title="Translation language",
        description="The language Posts are translated into.",
        type="enum",
        key="translation",
        field="translationTargetLanguage",
        options=_LANGUAGES,
        env="TRANSLATION_TARGET_LANGUAGE_DEFAULT",
    ),
    # --- Publishing ----------------------------------------------------------
    Declaration(
        id="publishing.yours.citationStyle",
        title="Citation style",
        description="How a published Summary cites its Posts. Every form links the Post.",
        type="enum",
        key=PUBLISHING_KEY,
        field="citationStyle",
        options=tuple((style, _CITATION_LABELS[style]) for style in CITATION_STYLES),
    ),
    Declaration(
        id="publishing.yours.linkPreviews",
        title="Link previews",
        description="Let Telegram show a preview of the first link in a published Summary.",
        type="boolean",
        key=PUBLISHING_KEY,
        field="linkPreviews",
    ),
    Declaration(
        id="publishing.yours.timeZone",
        title="Time zone",
        description="The IANA time zone a published Summary's time range is written in. Empty uses this browser's.",
        type="string",
        key=PUBLISHING_KEY,
        field="timeZone",
    ),
    # --- Network -------------------------------------------------------------
    Declaration(
        id="network.deployment.proxy",
        title="Use proxies",
        description="Send Telegram traffic through the proxy pool.",
        type="boolean",
        key="network",
        field="proxyEnabled",
        visible="manage",
        default=False,
    ),
    Declaration(
        id="network.deployment.proxyConcurrency",
        title="Slots per proxy",
        description="How many requests one proxy carries at once, unless the pool sets its own.",
        type="integer",
        key="network",
        field="proxyDefaultConcurrency",
        min=PROXY_CONCURRENCY_MIN,
        max=PROXY_CONCURRENCY_MAX,
        visible="manage",
        default=PROXY_CONCURRENCY_MIN,
    ),
    Declaration(
        id="network.deployment.tor",
        title="Use Tor",
        description="Send Telegram traffic through Tor.",
        type="boolean",
        key="network",
        field="torEnabled",
        visible="manage",
        default=False,
    ),
    Declaration(
        id="network.deployment.torMode",
        title="Tor mode",
        description="Find the local Tor proxy on its own, or use the URLs below.",
        type="enum",
        key="network",
        field="torMode",
        options=_choices(("auto", "Automatic"), ("custom", "Custom URLs")),
        visible="manage",
        default="auto",
    ),
    Declaration(
        id="network.deployment.torProxyUrls",
        title="Tor proxy URLs",
        description="The SOCKS URLs Tor is reached at, in custom mode.",
        type="string",
        key="network",
        field="torProxyUrls",
        visible="manage",
        default="socks5h://127.0.0.1:9050",
    ),
    Declaration(
        id="network.deployment.torRotation",
        title="Tor rotation",
        description="Which Tor URL the next request takes.",
        type="enum",
        key="network",
        field="torRotationStrategy",
        options=_choices(("sequential", "In order"), ("random", "Random")),
        visible="manage",
        default="sequential",
    ),
    Declaration(
        id="network.deployment.torControl",
        title="Tor control port",
        description="Use Tor's control port to ask for a new circuit.",
        type="boolean",
        key="network",
        field="torControlEnabled",
        visible="manage",
        default=False,
    ),
    Declaration(
        id="network.deployment.torControlPort",
        title="Tor control port number",
        description="The port Tor's control interface listens on.",
        type="integer",
        key="network",
        field="torControlPort",
        min=1,
        max=65535,
        visible="manage",
        env="TOR_CONTROL_PORT",
    ),
    Declaration(
        id="network.deployment.torAutoRotate",
        title="Rotate Tor on failures",
        description="Ask for a new circuit after repeated failures.",
        type="boolean",
        key="network",
        field="torAutoRotate",
        visible="manage",
        default=False,
    ),
    Declaration(
        id="network.deployment.torRotationThreshold",
        title="Failures before rotating",
        description="How many failures in a row ask Tor for a new circuit.",
        type="integer",
        key="network",
        field="torRotationThreshold",
        min=5,
        max=50,
        visible="manage",
        default=10,
    ),
    # --- Retention -----------------------------------------------------------
    Declaration(
        id="retention.deployment.postDays",
        title="Keep Posts for",
        description="Days a Post is kept before retention deletes it, for every Account. 0 keeps them forever.",
        type="integer",
        key=RETENTION_KEY,
        field="postRetentionDays",
        min=0,
        env="RETENTION_POST_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.deployment.payloadDays",
        title="Keep sync bodies for",
        description="Days the request and response bodies of sync logs are kept. 0 keeps them forever.",
        type="integer",
        key=RETENTION_KEY,
        field="payloadRetentionDays",
        min=0,
        visible="manage",
        env="RETENTION_PAYLOAD_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.deployment.sharedLogDays",
        title="Keep shared logs for",
        description="Days sync, network and background-job logs are kept. 0 keeps them forever.",
        type="integer",
        key=RETENTION_KEY,
        field="sharedLogRetentionDays",
        min=0,
        visible="manage",
        env="RETENTION_SHARED_LOG_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.deployment.directorySampleDays",
        title="Keep Directory samples for",
        description="Days the Directory keeps the Posts it sampled. 0 keeps them forever.",
        type="integer",
        key=RETENTION_KEY,
        field="directorySampleRetentionDays",
        min=0,
        visible="manage",
        env="RETENTION_DIRECTORY_SAMPLE_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.yours.logDays",
        title="Keep your logs for",
        description="Days your publish, AI and embedding logs are kept. 0 keeps them forever.",
        type="integer",
        key=RETENTION_PREFS_KEY,
        field="logRetentionDays",
        min=0,
        env="RETENTION_LOG_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.yours.discoverReportDays",
        title="Keep Discover reports for",
        description="Days your saved Discover reports are kept. 0 keeps them forever.",
        type="integer",
        key=RETENTION_PREFS_KEY,
        field="reportRetentionDays",
        min=0,
        env="RETENTION_REPORT_DAYS_DEFAULT",
    ),
    Declaration(
        id="retention.yours.discoverReportMax",
        title="Discover reports to keep",
        description="How many saved Discover reports you keep, newest first. 0 keeps every one.",
        type="integer",
        key=RETENTION_PREFS_KEY,
        field="reportRetentionMax",
        min=0,
        env="RETENTION_REPORT_MAX_DEFAULT",
    ),
    # --- Directory & Discover ------------------------------------------------
    _browser(
        "directory.browser.selectedFirst",
        "directorySelectedFirst",
        "Ticked rows first",
        "The Directory lists the rows you ticked first.",
        "boolean",
    ),
    _browser(
        "directory.browser.discoverSignals",
        "discoverSignals",
        "Discover signals",
        "Which kinds of mention Discover counts.",
        "json",
        lock="Changed in the Discover tab",
    ),
    _browser(
        "directory.browser.discoverSortKey",
        "discoverSortKey",
        "Discover sort",
        "How Discover orders the channels it found.",
        "enum",
        options=_choices(
            ("total", "Total"),
            ("weighted", "Weighted"),
            ("forward", "Forwards"),
            ("mention", "Mentions"),
            ("link", "Links"),
            ("lastSeen", "Last seen"),
            ("seenInCount", "Seen in"),
            ("subscribers", "Subscribers"),
            ("lastPostAt", "Last Post"),
            ("postsPerWeek", "Posts per week"),
            ("reach", "Reach"),
        ),
    ),
    _browser(
        "directory.browser.discoverSignalWeights",
        "discoverSignalWeights",
        "Discover signal weights",
        "How much a forward, a mention and a link each count in the Weighted sort.",
        "json",
        lock="Changed in the Discover tab",
    ),
    _browser(
        "directory.browser.discoverFollowState",
        "discoverFollowState",
        "Discover shows",
        "Which channels Discover lists, by whether you follow them.",
        "enum",
        options=_choices(
            ("all", "All"),
            ("unfollowed", "Not followed"),
            ("followed", "Followed"),
            ("ignored", "Ignored"),
        ),
    ),
    _browser(
        "directory.browser.discoverMinTotal",
        "discoverMinTotal",
        "Discover minimum count",
        "The fewest mentions a channel needs to be listed.",
        "integer",
        min=1,
    ),
    Declaration(
        id="directory.deployment.refreshDays",
        title="Refresh Directory entries after",
        description="Days a Directory entry stays current before it is fetched again.",
        type="integer",
        key=DIRECTORY_KEY,
        field="directoryRefreshDays",
        min=1,
        visible="manage",
        env="DIRECTORY_REFRESH_DAYS_DEFAULT",
    ),
    # --- Reach ---------------------------------------------------------------
    Declaration(
        id="reach.deployment.settlingAgeHours",
        title="Settling age",
        description="Hours after which a Post's View count counts as settled.",
        type="integer",
        key=REACH_KEY,
        field="settlingAgeHours",
        min=1,
        max=167,
    ),
    Declaration(
        id="reach.deployment.estimationFloorHours",
        title="Estimation floor",
        description="The youngest a View count may be, in hours, and still be corrected by the Settling curve.",
        type="integer",
        key=REACH_KEY,
        field="estimationFloorHours",
        min=0,
    ),
    Declaration(
        id="reach.deployment.sampleSize",
        title="Reach sample size",
        description="How many of a channel's newest Posts Reach reads.",
        type="integer",
        key=REACH_KEY,
        field="reachSampleSize",
        min=1,
    ),
    Declaration(
        id="reach.deployment.curveRefitHours",
        title="Settling curve refit",
        description="Hours between refits of the Settling curve.",
        type="integer",
        key=REACH_KEY,
        field="curveRefitIntervalHours",
        min=1,
    ),
    # --- Media ---------------------------------------------------------------
    Declaration(
        id="media.deployment.thumbCache",
        title="Cache thumbnails",
        description="Keep Post thumbnails on the deployment's disk.",
        type="boolean",
        key="media",
        field="thumbCacheEnabled",
        visible="manage",
    ),
    Declaration(
        id="media.deployment.thumbCacheOnSync",
        title="Cache thumbnails while syncing",
        description="Fetch thumbnails for new Posts as they are synced.",
        type="boolean",
        key="media",
        field="thumbCacheOnSync",
        visible="manage",
    ),
    Declaration(
        id="media.deployment.thumbCacheOnBackfill",
        title="Cache thumbnails while backfilling",
        description="Fetch thumbnails for older Posts as history is backfilled.",
        type="boolean",
        key="media",
        field="thumbCacheOnBackfill",
        visible="manage",
    ),
    Declaration(
        id="media.deployment.thumbCacheMaxSizeMb",
        title="Thumbnail cache size",
        description="Megabytes the thumbnail cache may use before the oldest are removed.",
        type="integer",
        key="media",
        field="thumbCacheMaxSizeMb",
        min=0,
        visible="manage",
        env="POST_THUMB_CACHE_MAX_SIZE_MB_DEFAULT",
    ),
    # --- Background jobs -----------------------------------------------------
    *(
        Declaration(
            id=f"jobs.deployment.{name}Enabled",
            title=title,
            description=description,
            type="boolean",
            key="jobs",
            field=f"{job}.enabled",
            visible="manage",
            env=_JOB_ENV.get(job),
        )
        for job, (name, title, description) in _JOB_TITLES.items()
    ),
    # --- Quota ---------------------------------------------------------------
    *_quota(),
)

BY_ID: dict[str, Declaration] = {d.id: d for d in DECLARATIONS}


def declaration(setting_id: str) -> Declaration | None:
    """The declaration a Setting id addresses, or `None`."""
    return BY_ID.get(setting_id)


# --- Configuration (SET-04) -------------------------------------------------
# Configuration is not declared row by row: `.env` rows come from the
# `Settings` class and code rows from the generated constants catalog. What is
# declared is where each lands on the page, because a topic guessed from a
# name or a path is a topic nobody chose.

#: A `.env` name's topic: the first prefix it starts with, in this order
#: (`VITE_` stripped first). A name no prefix claims is a Server value.
ENV_TOPICS: tuple[tuple[tuple[str, ...], str], ...] = (
    (("JOBS_",), "jobs"),
    (("QUOTA_",), "quota"),
    (
        ("RETENTION_", "SYNC_JOB_RETENTION", "SUMMARY_PARTIAL_DISMISSED_RETENTION"),
        "retention",
    ),
    (("PROXY_", "NETWORK_", "TOR_", "DEFAULT_PROXY", "TELEGRAM_"), "network"),
    (("DIRECTORY_", "DISCOVER_", "POST_REFERENCE_"), "directory"),
    (
        (
            "AUTO_SYNC_",
            "SYNC_",
            "SCRAPER_",
            "DIRECT_LANE_",
            "DYNAMIC_SYNC_",
            "POST_LANGUAGE_",
        ),
        "sync",
    ),
    (
        (
            "USERS_",
            "ACCESS_TOKEN",
            "VIEW_AS_",
            "SECRET_KEY",
            "FIRST_SUPERUSER",
            "EMAIL_RESET",
            "TOKEN_ENCRYPTION",
            "API_KEY",
            "TENANCY",
            "BACKEND_CORS",
        ),
        "access",
    ),
    (("SMTP_", "EMAILS_", "EMAIL_TEST"), "email"),
    (("POSTGRES_", "DB_"), "database"),
    (
        ("DEFAULT_AI", "GEMINI", "EMBEDDING", "TRANSLATION_", "RAG_", "AUTO_SUMMARY"),
        "ai",
    ),
    (("POST_THUMB", "CHANNEL_PHOTO", "CHANNEL_IMAGE"), "media"),
    (("VIEW_OBSERVATION",), "reach"),
)


def env_topic(name: str) -> str:
    bare = name.removeprefix("VITE_")
    return next(
        (topic for prefixes, topic in ENV_TOPICS if bare.startswith(prefixes)),
        "server",
    )


#: The topic of every module that holds a catalogued constant. Exact, both
#: ways: `tests/deployment/test_constants_catalog.py` fails on a module with a
#: constant and no entry, and on an entry whose module has none.
CONSTANT_TOPICS: dict[str, str] = {
    "backend/app/ai/registry.py": "ai",
    "backend/app/core/pg_notify.py": "server",
    "backend/app/jobs/auto_summary.py": "ai",
    "backend/app/jobs/post_language.py": "sync",
    "backend/app/jobs/request_stats.py": "quota",
    "backend/app/jobs/retention.py": "retention",
    "backend/app/jobs/scheduler.py": "jobs",
    "backend/app/jobs/settling_curve_fit.py": "reach",
    "backend/app/jobs/summary_generation.py": "ai",
    "backend/app/jobs/sync_queue.py": "sync",
    "backend/app/jobs/view_observation_stride.py": "reach",
    "backend/app/prompts/posts.py": "ai",
    "backend/app/schemas/analysis_window.py": "ai",
    "backend/app/schemas/directory.py": "directory",
    "backend/app/schemas/post_filter.py": "sync",
    "backend/app/services/artifacts.py": "ai",
    "backend/app/services/bulk_follow.py": "directory",
    "backend/app/services/channel_directory.py": "directory",
    "backend/app/services/channel_setting_groups.py": "sync",
    "backend/app/services/channel_tags.py": "ai",
    "backend/app/services/channels.py": "sync",
    "backend/app/services/chat_sessions.py": "ai",
    "backend/app/services/data_import_export.py": "database",
    "backend/app/services/data_vectors.py": "ai",
    "backend/app/services/directory_reads.py": "directory",
    "backend/app/services/directory_statistics.py": "directory",
    "backend/app/services/discover_reports.py": "directory",
    "backend/app/services/language.py": "sync",
    "backend/app/services/logs.py": "server",
    "backend/app/services/network.py": "network",
    "backend/app/services/network_settings.py": "network",
    "backend/app/services/post_references.py": "directory",
    "backend/app/services/post_thumbnails.py": "media",
    "backend/app/services/posts.py": "sync",
    "backend/app/services/posts_view.py": "sync",
    "backend/app/services/prompt_assembly.py": "ai",
    "backend/app/services/proxy_pacing.py": "network",
    "backend/app/services/proxy_pool.py": "network",
    "backend/app/services/publication_parts.py": "publishing",
    "backend/app/services/quota.py": "quota",
    "backend/app/services/reach.py": "reach",
    "backend/app/services/request_stats.py": "quota",
    "backend/app/services/scraper_jobs.py": "sync",
    "backend/app/services/search_text.py": "sync",
    "backend/app/services/spread_bars.py": "directory",
    "backend/app/services/summaries.py": "ai",
    "backend/app/services/sync_orchestrator.py": "sync",
    "backend/app/services/tag_runs.py": "ai",
    "backend/app/services/view_observations.py": "reach",
    "backend/app/worker.py": "jobs",
    "frontend/src/components/AnalysisWindowControl.tsx": "ai",
    "frontend/src/components/HandlePasteBox.tsx": "directory",
    "frontend/src/components/LogsView.tsx": "server",
    "frontend/src/components/NetworkTelemetry.tsx": "network",
    "frontend/src/components/PostFilter.tsx": "sync",
    "frontend/src/components/SpreadZoom.tsx": "appearance",
    "frontend/src/components/TimeBoundEditor.tsx": "appearance",
    "frontend/src/components/channel-grid/VirtualizedChannelGrid.tsx": "appearance",
    "frontend/src/components/directory/DirectoryAddBox.tsx": "directory",
    "frontend/src/components/directory/DirectoryBar.tsx": "directory",
    "frontend/src/components/directory/DirectoryBoost.tsx": "directory",
    "frontend/src/components/directory/DirectoryBulkBar.tsx": "directory",
    "frontend/src/components/directory/DirectorySamples.tsx": "directory",
    "frontend/src/components/directory/DirectoryTable.tsx": "directory",
    "frontend/src/components/history/ArtifactCardParts.tsx": "appearance",
    "frontend/src/components/keyboard/KeyHelp.tsx": "appearance",
    "frontend/src/components/post-card/FeedKeyboard.tsx": "appearance",
    "frontend/src/components/post-card/PhotoViewer.tsx": "media",
    "frontend/src/components/post-card/photo-viewer-model.ts": "media",
    "frontend/src/components/requests/DailyBars.tsx": "quota",
    "frontend/src/components/settings-page/SettingsPage.tsx": "appearance",
    "frontend/src/components/settings-page/sections.ts": "appearance",
    "frontend/src/components/summary-view/ChannelPostsSheet.tsx": "ai",
    "frontend/src/components/summary-view/PartialResponses.tsx": "ai",
    "frontend/src/constants.ts": "sync",
    "frontend/src/contexts/ScopeContext.tsx": "sync",
    "frontend/src/hooks/queryKeys.ts": "server",
    "frontend/src/hooks/useArtifacts.ts": "ai",
    "frontend/src/hooks/useDirectory.ts": "directory",
    "frontend/src/hooks/useDirectorySearchBox.ts": "directory",
    "frontend/src/hooks/useDiscoverProbeQueue.ts": "directory",
    "frontend/src/hooks/useJobsStatus.ts": "jobs",
    "frontend/src/hooks/useMyQuota.ts": "quota",
    "frontend/src/hooks/usePostFilters.ts": "sync",
    "frontend/src/hooks/usePostsView.ts": "sync",
    "frontend/src/hooks/useRecentCommands.ts": "appearance",
    "frontend/src/hooks/useTags.ts": "ai",
    "frontend/src/lib/channels/channel-tag-model.ts": "ai",
    "frontend/src/lib/channels/grid-lanes.ts": "appearance",
    "frontend/src/lib/channels/sync-schedule-summary.ts": "sync",
    "frontend/src/lib/chat-sessions/chat-turn.ts": "ai",
    "frontend/src/lib/citations/find-citation.ts": "ai",
    "frontend/src/lib/commands/rank-commands.ts": "appearance",
    "frontend/src/lib/commands/search-filters.ts": "appearance",
    "frontend/src/lib/data-freshness.ts": "server",
    "frontend/src/lib/data-transfer/entities/post.ts": "database",
    "frontend/src/lib/data-transfer/types.ts": "database",
    "frontend/src/lib/directory/directory-filter.ts": "directory",
    "frontend/src/lib/directory/directory-panel.ts": "directory",
    "frontend/src/lib/directory/directory-view.ts": "directory",
    "frontend/src/lib/posts/discover-candidates.ts": "directory",
    "frontend/src/lib/posts/discover-selection.ts": "directory",
    "frontend/src/lib/posts/post-selection.ts": "sync",
    "frontend/src/lib/posts/scoped-posts.ts": "sync",
    "frontend/src/lib/posts/selected-export.ts": "sync",
    "frontend/src/lib/posts/store.ts": "sync",
    "frontend/src/lib/requests/breakdown.ts": "quota",
    "frontend/src/lib/requests/records.ts": "quota",
    "frontend/src/lib/requests/zoom.ts": "quota",
    "frontend/src/lib/shared-ticker.ts": "server",
    "frontend/src/lib/spread.ts": "appearance",
    "frontend/src/lib/summaries/retry-choice.ts": "ai",
    "frontend/src/lib/summary-projection.ts": "ai",
    "frontend/src/lib/sync/run-server-sync.ts": "sync",
}
