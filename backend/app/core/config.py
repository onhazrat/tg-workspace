import secrets
import warnings
from typing import Annotated, Any, Literal, Self

from pydantic import (
    AnyUrl,
    BeforeValidator,
    EmailStr,
    HttpUrl,
    PostgresDsn,
    computed_field,
    model_validator,
)
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_cors(v: Any) -> list[str] | str:
    if isinstance(v, str) and not v.startswith("["):
        return [i.strip() for i in v.split(",") if i.strip()]
    elif isinstance(v, list | str):
        return v
    raise ValueError(v)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Use top level .env file (one level above ./backend/)
        env_file="../.env",
        env_ignore_empty=True,
        extra="ignore",
    )
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = secrets.token_urlsafe(32)
    # 60 minutes * 24 hours * 8 days = 8 days
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8
    FRONTEND_HOST: str = "http://localhost:5173"
    ENVIRONMENT: Literal["local", "staging", "production"] = "local"

    BACKEND_CORS_ORIGINS: Annotated[
        list[AnyUrl] | str, BeforeValidator(parse_cors)
    ] = []

    @computed_field  # type: ignore[prop-decorator]
    @property
    def all_cors_origins(self) -> list[str]:
        return [str(origin).rstrip("/") for origin in self.BACKEND_CORS_ORIGINS] + [
            self.FRONTEND_HOST
        ]

    PROJECT_NAME: str
    SENTRY_DSN: HttpUrl | None = None

    #: Log a WARNING for any request whose time-to-first-byte reaches this.
    #: 0 disables the log line; the `Server-Timing` header is always sent.
    #: 1s is deliberately loud — on this deployment anything over it has so far
    #: turned out to be a real defect, not load.
    SLOW_REQUEST_LOG_MS: int = 1000
    POSTGRES_SERVER: str
    POSTGRES_PORT: int = 5432
    POSTGRES_USER: str
    POSTGRES_PASSWORD: str = ""
    POSTGRES_DB: str = ""

    @computed_field  # type: ignore[prop-decorator]
    @property
    def SQLALCHEMY_DATABASE_URI(self) -> PostgresDsn:
        return PostgresDsn.build(
            scheme="postgresql+psycopg",
            username=self.POSTGRES_USER,
            password=self.POSTGRES_PASSWORD,
            host=self.POSTGRES_SERVER,
            port=self.POSTGRES_PORT,
            path=self.POSTGRES_DB,
        )

    SMTP_TLS: bool = True
    SMTP_SSL: bool = False
    SMTP_PORT: int = 587
    SMTP_HOST: str | None = None
    SMTP_USER: str | None = None
    SMTP_PASSWORD: str | None = None
    EMAILS_FROM_EMAIL: EmailStr | None = None
    EMAILS_FROM_NAME: str | None = None

    @model_validator(mode="after")
    def _set_default_emails_from(self) -> Self:
        if not self.EMAILS_FROM_NAME:
            self.EMAILS_FROM_NAME = self.PROJECT_NAME
        return self

    EMAIL_RESET_TOKEN_EXPIRE_HOURS: int = 48

    @computed_field  # type: ignore[prop-decorator]
    @property
    def emails_enabled(self) -> bool:
        return bool(self.SMTP_HOST and self.EMAILS_FROM_EMAIL)

    EMAIL_TEST_USER: EmailStr = "test@example.com"
    FIRST_SUPERUSER: EmailStr
    FIRST_SUPERUSER_PASSWORD: str
    USERS_OPEN_REGISTRATION: bool = True
    # Off by default, deliberately: a self-hoster who turned open registration
    # on asked for open registration, and silently queueing their sign-ups for
    # an approval screen they never enabled would be the opposite of that.
    # Turning it on affects only accounts created afterwards — `is_approved`
    # defaults to true at the column level, so existing users stay approved.
    USERS_REQUIRE_APPROVAL: bool = False

    # The tenancy seam's one switch (ticket 03), **on** since ticket 21 PR 4.
    # On means `scoped_select` filters: a user-owned row by its owner, a
    # follow-scoped one by an EXISTS against `tg_channel_follows`, and corpus
    # not at all. Two accounts genuinely cannot see each other, which is the
    # acceptance gate the whole tenancy programme was built toward.
    #
    # It shipped off for eighteen tickets so that ~40 read paths could adopt
    # the seam one batch at a time without any batch changing a response, and
    # the flip waited on three things that each had to be true first: every
    # `user_id=None` creation path closed (PR 1), the single-operator model
    # gone (PR 2), and every user-owned column `NOT NULL` with a real key
    # (PR 3). Flipping before those did not thin the lists, it emptied them —
    # an unowned row is invisible to every account, and a Channel with no
    # follow takes its Posts with it.
    #
    # **Off is now the rollback**, not the default, and it is a real one: the
    # disabled branch is still asserted byte-identical to the pre-seam queries
    # for all 27 models. Setting `TENANCY_ENFORCED=false` in `.env` reverts
    # every read path at once, with no deploy of different code.
    #
    # Read in exactly one place — `services/tenancy.py::tenancy_enforced`.
    # The failure mode of a flag is always the fourteenth place it got read,
    # so `tests/services/test_tenancy_seam.py` asserts that count stays at one.
    TENANCY_ENFORCED: bool = True

    # TG Summarizer
    GEMINI_API_KEY: str = ""
    API_KEY: str = ""
    TOKEN_ENCRYPTION_KEY: str = ""
    TOR_ENABLED: bool = False
    TOR_CONTROL_PASSWORD: str = ""
    TOR_CONTROL_PORT: int = 9051
    TOR_SOCKS_PROXY: str = "socks5h://127.0.0.1:9050"
    DEFAULT_PROXY_URLS: str = ""
    EMBEDDING_MODEL: str = "gemini-embedding-2-preview"
    DEFAULT_AI_MODEL: str = "gemini-3-flash-preview"

    # Sync & scraping
    SYNC_CONCURRENCY_DEFAULT: int = 3
    SYNC_MAX_RETRIES: int = 3
    SYNC_RETRY_BACKOFF_BASE_MS: int = 2000
    SYNC_JOB_SSE_THROTTLE_MS: int = 1000
    SYNC_JOB_PERSIST_INTERVAL_MS: int = 5000
    #: How long finished sync job rows are kept. 0 disables pruning.
    #:
    #: A deployment constant rather than an operator setting, unlike the windows
    #: in `load_retention_settings`: there is no list endpoint for sync jobs, so
    #: no one browses the history and no one can be surprised by its length. The
    #: table had no policy at all and reached 196,047 rows / 153 MB.
    SYNC_JOB_RETENTION_DAYS: int = 14
    #: How often the worker sweeps the sync lanes for anything the
    #: post-enqueue kick missed (tickets 09, 10) — a crashed kick, or a message
    #: redelivered after its visibility timeout lapsed. The kick handles the
    #: common case with no added latency; this is the backstop, so it does not
    #: need to be sub-second — matched to `DISCOVER_PROBE_JOB_INTERVAL_SECONDS`
    #: rather than tighter. `stop_scheduler` shuts down with `wait=False`, so a
    #: run already in flight keeps executing past teardown; a short interval
    #: made that collide with `tests/`'s per-module `TestClient` teardown
    #: constantly (a stray in-flight sweep from one test module racing a later
    #: module's own queue traffic), the same way the existing 30-60s-interval
    #: jobs apparently never do.
    SYNC_QUEUE_POLL_INTERVAL_SECONDS: int = 30
    #: How many messages one drain claims from a single lane at once. The code
    #: this replaces had no cap at all — one `asyncio.create_task` per request
    #: — so this is a new, deliberate limit rather than a tightened one.
    #: Generous by default because after ticket 10 a message is one Channel and
    #: the real limiter is the worker's own concurrency gate, not this: a batch
    #: of ten claims ten messages, it does not scrape ten Channels at once.
    SYNC_QUEUE_BATCH_SIZE: int = 10
    #: Redeliveries before a sync message is archived rather
    #: than retried again (decision 32: "cap redelivery ... and archive beyond
    #: it rather than looping"). Counts `pgmq`'s own `read_ct`, so this is
    #: attempts, not extra retries on top of the ones already inside the sync
    #: itself (`SYNC_MAX_RETRIES`, `NETWORK_FETCH_RETRIES`) — a message only
    #: gets redelivered at all when the *whole* job crashed instead of failing
    #: a channel cleanly, which those inner retries already turned into a
    #: normal "failed" job.
    SYNC_QUEUE_MAX_READ_COUNT: int = 3
    AUTO_SYNC_CHECK_INTERVAL_SECONDS: int = 60
    AUTO_SYNC_INTERVAL_MINUTES_DEFAULT: int = 60
    AUTO_SYNC_PAUSE_DURATION_MS: int = 10 * 60 * 1000
    AUTO_SYNC_FAILURE_THRESHOLD_MIN: int = 3
    SCRAPER_MAX_POSTS_PER_CHANNEL: int = 300
    SCRAPER_ITERATION_LIMIT: int = 50

    # Background job scheduler intervals
    EMBEDDINGS_JOB_INTERVAL_SECONDS: int = 60
    AUTO_SUMMARY_JOB_INTERVAL_SECONDS: int = 60
    RETENTION_JOB_INTERVAL_HOURS: int = 1
    # An interval job's first run is otherwise start+interval away, so on a
    # frequently-redeployed backend retention can be reset before it ever
    # fires. This runs it shortly after boot too; the delay lets startup
    # settle first. Set to 0 to disable the startup run.
    RETENTION_JOB_STARTUP_DELAY_SECONDS: int = 60
    TRANSLATION_BATCH_JOB_INTERVAL_SECONDS: int = 30
    DISCOVER_PROBE_JOB_INTERVAL_SECONDS: int = 30

    # Default enabled state when no jobs AppSetting row exists yet
    JOBS_EMBEDDINGS_ENABLED_DEFAULT: bool = False
    JOBS_AUTO_SYNC_ENABLED_DEFAULT: bool = True
    JOBS_AUTO_SUMMARY_ENABLED_DEFAULT: bool = True
    JOBS_RETENTION_ENABLED_DEFAULT: bool = True
    JOBS_TRANSLATION_BATCH_ENABLED_DEFAULT: bool = False
    JOBS_DISCOVER_PROBE_ENABLED_DEFAULT: bool = True

    # Embeddings backfill
    EMBEDDINGS_CHUNK_SIZE: int = 20
    EMBEDDINGS_BACKFILL_LIMIT_DEFAULT: int = 100

    # Retention defaults (AppSetting bootstrap)
    RETENTION_POST_DAYS_DEFAULT: int = 90
    RETENTION_LOG_DAYS_DEFAULT: int = 30
    # The window for log rows no account owns: the sync family, which ticket 19
    # made Channel telemetry, the Admin-only network family, and any publish,
    # LLM or embedding row a background job wrote with no User behind it. Those
    # cannot sit on a per-User window and would otherwise be swept by nobody.
    # Same default as the personal window, so ticket 20 changed no behaviour.
    RETENTION_SHARED_LOG_DAYS_DEFAULT: int = 30
    # Sync log request/response bodies are the bulk of a log (~17KB/row, up to
    # 3MB) and live in tg_sync_log_payloads so they can be reclaimed on their
    # own, much shorter horizon than the log metadata above. 0 = keep forever.
    RETENTION_PAYLOAD_DAYS_DEFAULT: int = 7
    # Discover reports store the full candidate list, tail included, as a JSON
    # blob per generate — the one table that grows per user action. Both caps
    # apply; 0 disables either one, like the post/log windows above.
    RETENTION_REPORT_DAYS_DEFAULT: int = 90
    RETENTION_REPORT_MAX_DEFAULT: int = 50

    # Discover handle probes
    #
    # How many handles one sweep fetches. A batch commonly outlasts the interval
    # above, which is fine: the sweep lock makes the overlapping tick a no-op, so
    # the real pace is set by how fast Telegram answers.
    DISCOVER_PROBE_BATCH_SIZE: int = 60

    # Translation batch job
    TRANSLATION_BATCH_LIMIT: int = 20
    TRANSLATION_BATCH_MAX_CHARS: int = 4000
    TRANSLATION_TARGET_LANGUAGE_DEFAULT: str = "English"

    # RAG / vector search
    RAG_SCAN_LIMIT_MAX: int = 5000
    RAG_SEARCH_LIMIT_DEFAULT: int = 20
    RAG_EMBED_LIMIT_DEFAULT: int = 100

    # Network / HTTP client
    PROXY_DEFAULT_CONCURRENCY_DEFAULT: int = 1
    NETWORK_PROXY_COOLDOWN_MS: int = 10 * 60 * 1000
    NETWORK_FETCH_RETRIES: int = 8
    NETWORK_FETCH_INITIAL_DELAY_MS: int = 3000
    NETWORK_FETCH_TIMEOUT_SECONDS: float = 60.0
    NETWORK_TOR_ROTATION_THRESHOLD: int = 10
    TELEGRAM_API_RETRIES: int = 3
    TELEGRAM_API_INITIAL_DELAY_MS: int = 2000
    # Public Telegram web-view host for scraping and deep links (e.g. telegram.me, t.me)
    TELEGRAM_WEB_DOMAIN: str = "telegram.me"

    # Cached channel avatar images (relative to repo root unless absolute)
    CHANNEL_PHOTO_DIR: str = "data/channel-photos"
    # How long an avatar no channel references survives before the retention
    # sweep takes it. Must stay above the Discover report window: a probed
    # candidate is not a channel row yet, so a shorter floor strips avatars off
    # reports still on screen. 0 disables the sweep.
    CHANNEL_PHOTO_ORPHAN_MAX_AGE_DAYS: int = 30
    # Cached post photo/video thumbnails (relative to repo root unless absolute)
    POST_THUMB_DIR: str = "data/post-thumbs"
    POST_THUMB_CACHE_MAX_SIZE_MB_DEFAULT: int = 2048
    # How long a browser may reuse a cached avatar or thumbnail without asking.
    # These change rarely, and the responses also carry an ETag, so a stale one
    # costs a bodiless 304 rather than a re-download. One hour.
    CHANNEL_IMAGE_MAX_AGE_SECONDS: int = 3600

    @computed_field  # type: ignore[prop-decorator]
    @property
    def default_proxies(self) -> list[str]:
        if not self.DEFAULT_PROXY_URLS.strip():
            return []
        return [p.strip() for p in self.DEFAULT_PROXY_URLS.split(",") if p.strip()]

    def _check_default_secret(self, var_name: str, value: str | None) -> None:
        if value == "changethis":
            message = (
                f'The value of {var_name} is "changethis", '
                "for security, please change it, at least for deployments."
            )
            if self.ENVIRONMENT == "local":
                warnings.warn(message, stacklevel=1)
            else:
                raise ValueError(message)

    @model_validator(mode="after")
    def _enforce_non_default_secrets(self) -> Self:
        self._check_default_secret("SECRET_KEY", self.SECRET_KEY)
        self._check_default_secret("POSTGRES_PASSWORD", self.POSTGRES_PASSWORD)
        self._check_default_secret(
            "FIRST_SUPERUSER_PASSWORD", self.FIRST_SUPERUSER_PASSWORD
        )

        if self.ENVIRONMENT != "local":
            if not self.TOKEN_ENCRYPTION_KEY.strip():
                raise ValueError(
                    "TOKEN_ENCRYPTION_KEY must be set when ENVIRONMENT is not 'local'"
                )
            if self.ENVIRONMENT == "production" and not self.API_KEY.strip():
                raise ValueError("API_KEY must be set when ENVIRONMENT is 'production'")

        return self


settings = Settings()  # type: ignore[call-arg]
