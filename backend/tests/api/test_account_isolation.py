"""Ticket 21 PR 4: two real accounts cannot see each other, over every route.

This is the acceptance gate for the whole tenancy programme, and it is written
as an *inventory* rather than as a list of interesting cases. Every one of the
mounted operations is either **probed** here with two live accounts or
**excused** with a written reason, and an operation in neither map fails the
guard. A route added next quarter therefore cannot join the API without
somebody answering "whose rows does this touch?" — which is the one moment that
question is cheap.

That shape is deliberate and is copied from `services/tenancy.py::SCOPES`, which
places or excuses all 27 tables, and from `test_import_write_scoping.py`'s
`IMPORT_WRITES`. Both exist because the failure mode of tenancy work is never
the path somebody thought about; it is the fourteenth one nobody did.

## What a probe asserts

For a by-id route: account B, asking about a row account A owns, gets **404 with
the string that family answers for a row that is not there**. Not 403 — a 403
confirms the row exists, which over client-visible ids is the enumeration oracle
signup was hardened against, and `assert_owner` refuses to open it.

For a list route: B's page does not contain A's row, and — the half that matters
more — **A's own page still does**. A guard that only checks the refusal is
satisfied by a route that refuses everybody, which is an outage rather than
isolation.

## Why the excuses are typed

`Reason` is an enum, not a free-text string, because five kinds of "this is
fine" behave differently and the differences are what a reader needs:
`NOT_ROW_ADDRESSED` will never need a probe, while `COVERED_ELSEWHERE` names a
file that could be deleted, and `DEPLOYMENT_WIDE` is a decision that a later
ticket may reverse. A single string bucket would let all three rot into "we
looked at it once".
"""

from __future__ import annotations

import enum
import re
import uuid
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, select

from app.core.config import settings
from app.core.db import engine
from app.main import app
from app.models import User
from app.models_tg import (
    BotCredential,
    ChannelSettingGroup,
    ChatDestination,
    ChatSession,
    DiscoverReport,
    Summary,
    TagRun,
)
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR
DATA = f"{V1}/data"

HTTP_METHODS = {"get", "post", "put", "patch", "delete"}


def _mounted() -> set[tuple[str, str]]:
    """`(METHOD, path)` for everything the app serves.

    Off `app.openapi()` rather than `app.routes`, for the reason
    `test_route_inventory.py` gives: this FastAPI keeps included routers nested
    as `_IncludedRouter` objects, so walking `app.routes` finds nothing at all.
    """
    return {
        (method.upper(), path)
        for path, operations in app.openapi()["paths"].items()
        for method in operations
        if method.lower() in HTTP_METHODS
    }


class Reason(enum.Enum):
    """Why an operation needs no two-account probe of its own."""

    #: Takes no row id and returns no rows — auth, health, a pure computation.
    NOT_ROW_ADDRESSED = "not row-addressed"
    #: Deliberately crosses accounts, gated on a permission instead. The
    #: decision is recorded in `tenancy.py` or the owning ticket.
    DEPLOYMENT_WIDE = "deployment-wide by design, permission-gated"
    #: Reads or writes the shared corpus, which is follow-scoped rather than
    #: owned. Isolation here is the Follow, not the row.
    CORPUS = "shared corpus, scoped by Follow"
    #: A named guard file already probes this with two accounts.
    COVERED_ELSEWHERE = "covered by a named guard"
    #: Reaches an external service and stores nothing addressable.
    EXTERNAL = "external boundary, no row of ours"


# --------------------------------------------------------------------------
# The inventory
# --------------------------------------------------------------------------

#: Routes this file probes live, below.
PROBED: dict[tuple[str, str], str] = {
    ("GET", f"{V1}/data/summaries/{{summary_id}}"): "artifact by id",
    ("PUT", f"{V1}/data/summaries/{{summary_id}}"): "artifact write by id",
    ("DELETE", f"{V1}/data/summaries/{{summary_id}}"): "artifact delete by id",
    ("GET", f"{V1}/data/summaries"): "artifact list",
    ("GET", f"{V1}/data/chat-sessions/{{chat_session_id}}"): "artifact by id",
    ("PUT", f"{V1}/data/chat-sessions/{{chat_session_id}}"): "artifact write by id",
    ("DELETE", f"{V1}/data/chat-sessions/{{chat_session_id}}"): "artifact delete",
    ("GET", f"{V1}/data/chat-sessions"): "artifact list",
    ("GET", f"{V1}/data/tag-runs/{{tag_run_id}}"): "artifact by id",
    ("PUT", f"{V1}/data/tag-runs/{{tag_run_id}}"): "artifact write by id",
    ("DELETE", f"{V1}/data/tag-runs/{{tag_run_id}}"): "artifact delete",
    ("GET", f"{V1}/data/tag-runs"): "artifact list",
    ("GET", f"{V1}/data/discover/reports/{{report_id}}"): "artifact by id",
    ("DELETE", f"{V1}/data/discover/reports/{{report_id}}"): "artifact delete",
    ("PUT", f"{V1}/data/discover/reports/{{report_id}}/flags"): "artifact write",
    ("GET", f"{V1}/data/discover/reports"): "artifact list",
    ("PUT", f"{V1}/data/bot-credentials/{{bot_id}}"): "credential write by id",
    ("DELETE", f"{V1}/data/bot-credentials/{{bot_id}}"): "credential delete",
    ("GET", f"{V1}/data/bot-credentials"): "credential list",
    ("PUT", f"{V1}/data/chat-destinations/{{dest_id}}"): "destination write",
    ("DELETE", f"{V1}/data/chat-destinations/{{dest_id}}"): "destination delete",
    ("GET", f"{V1}/data/chat-destinations"): "destination list",
    ("PUT", f"{V1}/data/setting-groups/{{group_id}}"): "setting group write",
    ("DELETE", f"{V1}/data/setting-groups/{{group_id}}"): "setting group delete",
    ("GET", f"{V1}/data/setting-groups"): "setting group list",
    ("GET", f"{V1}/data/channels"): "follow-scoped list",
    ("PUT", f"{V1}/data/channels/{{channel_id}}"): "follow-scoped write",
    ("DELETE", f"{V1}/data/channels/{{channel_id}}"): "unfollow",
    ("GET", f"{V1}/data/artifacts"): "the unified History",
    ("GET", f"{V1}/data/channels/bulk-follow/{{follow_job_id}}"): "follow job read",
    ("POST", f"{V1}/data/channels/bulk-follow/{{follow_job_id}}/cancel"): (
        "follow job cancel — a write, so ungated"
    ),
}

#: Routes with no probe of their own, each with the reason and, where one
#: exists, the guard that does cover it.
EXCUSED: dict[tuple[str, str], tuple[Reason, str]] = {
    # --- auth, identity, health -------------------------------------------
    ("POST", f"{V1}/login/access-token"): (Reason.NOT_ROW_ADDRESSED, "issues a token"),
    ("POST", f"{V1}/login/test-token"): (Reason.NOT_ROW_ADDRESSED, "echoes the caller"),
    ("POST", f"{V1}/password-recovery/{{email}}"): (
        Reason.NOT_ROW_ADDRESSED,
        "answers identically for every address by construction (ticket 01)",
    ),
    ("POST", f"{V1}/password-recovery-html-content/{{email}}"): (
        Reason.DEPLOYMENT_WIDE,
        "superuser-only debug view of the recovery email",
    ),
    ("POST", f"{V1}/reset-password/"): (Reason.NOT_ROW_ADDRESSED, "consumes a token"),
    ("POST", f"{V1}/users/signup"): (
        Reason.NOT_ROW_ADDRESSED,
        "one fixed message for every address; test_registration.py owns it",
    ),
    ("GET", f"{V1}/users/me"): (Reason.NOT_ROW_ADDRESSED, "the caller's own row"),
    ("PATCH", f"{V1}/users/me"): (Reason.NOT_ROW_ADDRESSED, "the caller's own row"),
    ("PATCH", f"{V1}/users/me/password"): (Reason.NOT_ROW_ADDRESSED, "own password"),
    ("DELETE", f"{V1}/users/me"): (
        Reason.NOT_ROW_ADDRESSED,
        "the caller's own account; the cascade is test_non_null_owners.py",
    ),
    ("GET", f"{V1}/users/"): (Reason.DEPLOYMENT_WIDE, "USERS_MANAGE account admin"),
    ("POST", f"{V1}/users/"): (Reason.DEPLOYMENT_WIDE, "USERS_MANAGE account admin"),
    ("GET", f"{V1}/users/{{user_id}}"): (Reason.DEPLOYMENT_WIDE, "USERS_MANAGE"),
    ("PATCH", f"{V1}/users/{{user_id}}"): (Reason.DEPLOYMENT_WIDE, "USERS_MANAGE"),
    ("DELETE", f"{V1}/users/{{user_id}}"): (Reason.DEPLOYMENT_WIDE, "USERS_MANAGE"),
    ("POST", f"{V1}/private/users/"): (
        Reason.DEPLOYMENT_WIDE,
        "mounted only when ENVIRONMENT == local",
    ),
    ("GET", f"{V1}/utils/health-check/"): (Reason.NOT_ROW_ADDRESSED, "liveness"),
    ("POST", f"{V1}/utils/test-email/"): (Reason.DEPLOYMENT_WIDE, "superuser probe"),
    # --- items: the template's own resource --------------------------------
    ("GET", f"{V1}/items/"): (
        Reason.COVERED_ELSEWHERE,
        "template CRUD with its own owner_id check; tests/api/routes/test_items.py",
    ),
    ("POST", f"{V1}/items/"): (Reason.COVERED_ELSEWHERE, "see GET /items/"),
    ("GET", f"{V1}/items/{{id}}"): (Reason.COVERED_ELSEWHERE, "see GET /items/"),
    ("PUT", f"{V1}/items/{{id}}"): (Reason.COVERED_ELSEWHERE, "see GET /items/"),
    ("DELETE", f"{V1}/items/{{id}}"): (Reason.COVERED_ELSEWHERE, "see GET /items/"),
    # --- the shared corpus --------------------------------------------------
    ("POST", f"{DATA}/posts"): (
        Reason.COVERED_ELSEWHERE,
        "the feed, in both query shapes; test_post_tenancy_scoping.py",
    ),
    ("POST", f"{DATA}/posts/lookup"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("POST", f"{DATA}/posts/counts"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("POST", f"{DATA}/posts/bulk"): (
        Reason.CORPUS,
        "raw ingest; creates no Channel and no Follow, so what it writes is "
        "reachable only once somebody follows the handle. See the ticket note "
        "for ticket 28 — an import that carries a subject changes this.",
    ),
    ("POST", f"{DATA}/discover/candidates"): (
        Reason.COVERED_ELSEWHERE,
        "aggregation over followed carriers; test_post_tenancy_scoping.py",
    ),
    ("GET", f"{DATA}/discover/probes"): (
        Reason.CORPUS,
        "DiscoverHandleProbe is corpus: shared and unreachable through a "
        "Follow, unscoped on purpose (tenancy.py::SCOPES)",
    ),
    ("GET", f"{DATA}/discover/probe/queue"): (Reason.CORPUS, "see GET probes"),
    ("POST", f"{DATA}/discover/probe/recheck"): (Reason.CORPUS, "see GET probes"),
    ("GET", f"{DATA}/discover/ignored"): (
        Reason.COVERED_ELSEWHERE,
        "per-account by composite key; test_discover_dismissals_are_per_account.py",
    ),
    ("POST", f"{DATA}/discover/ignored"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("DELETE", f"{DATA}/discover/ignored"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("GET", f"{DATA}/channels/bios"): (Reason.CORPUS, "bios are Channel corpus"),
    ("GET", f"{DATA}/channels/stats"): (
        Reason.COVERED_ELSEWHERE,
        "test_channel_tenancy_scoping.py::"
        "test_list_all_channel_stats_hides_a_channel_you_do_not_follow. Not "
        "test_channel_stats.py, which this used to name: that file is about "
        "the stats maths and has no second account in it. COVERED_ELSEWHERE "
        "means a file that could be deleted, so a wrong name is the one thing "
        "this reason cannot survive.",
    ),
    ("GET", f"{DATA}/channels/{{channel_id}}/stats"): (
        Reason.COVERED_ELSEWHERE,
        "test_channel_tenancy_scoping.py::"
        "test_get_channel_stats_404s_for_a_channel_you_do_not_follow",
    ),
    ("GET", f"{DATA}/translations"): (Reason.CORPUS, "translations key off Posts"),
    ("POST", f"{DATA}/translations"): (
        Reason.CORPUS,
        "writes translations keyed to Posts, which are corpus",
    ),
    ("GET", f"{DATA}/translations/one"): (
        Reason.CORPUS,
        "one translation, keyed by (channel, post, language)",
    ),
    ("POST", f"{DATA}/embeddings"): (Reason.CORPUS, "embeddings key off Posts"),
    # --- bulk channel operations -------------------------------------------
    ("POST", f"{DATA}/channels/bulk-follow"): (
        Reason.COVERED_ELSEWHERE,
        "writes follows for the caller; test_follows.py",
    ),
    ("GET", f"{DATA}/channels/bulk-follow/{{follow_job_id}}/events"): (
        Reason.COVERED_ELSEWHERE,
        "SSE, and a test client cannot bound a stream that fails to refuse — "
        "that hang is what test_admin_route_gating.py documents. It takes the "
        "same `_visible_follow_job` as the two probed routes beside it, and "
        "`test_every_bulk_follow_route_checks_the_owner` walks the AST to say "
        "so, which fails in milliseconds instead of hanging.",
    ),
    ("POST", f"{DATA}/channels/bulk-reresolve-start-ids"): (
        Reason.NOT_ROW_ADDRESSED,
        "deprecated no-op",
    ),
    ("POST", f"{DATA}/channels/bulk-reset-sync"): (
        Reason.COVERED_ELSEWHERE,
        "operates on the caller's followed channels; test_bulk_channels.py",
    ),
    ("PATCH", f"{DATA}/channels/bulk-setting-group"): (
        Reason.COVERED_ELSEWHERE,
        "assert_owner_on_write over a client-chosen group id; "
        "test_setting_group_and_job_scoping.py",
    ),
    ("PATCH", f"{DATA}/channels/bulk-sync-settings"): (
        Reason.COVERED_ELSEWHERE,
        "the caller's followed channels; test_bulk_channels.py",
    ),
    ("PATCH", f"{DATA}/channels/bulk-tags"): (Reason.COVERED_ELSEWHERE, "same file"),
    # --- logs ----------------------------------------------------------------
    ("GET", f"{DATA}/logs/{{log_type}}"): (
        Reason.COVERED_ELSEWHERE,
        "owned types by owner, sync by Follow; test_log_tenancy_scoping.py and "
        "test_sync_log_channel_telemetry.py",
    ),
    ("GET", f"{DATA}/logs/{{log_type}}/{{log_id}}"): (
        Reason.COVERED_ELSEWHERE,
        "same two files",
    ),
    ("POST", f"{DATA}/logs/{{log_type}}"): (
        Reason.COVERED_ELSEWHERE,
        "create_logs refuses a foreign row and foreign telemetry; "
        "test_import_write_scoping.py and test_sync_log_channel_telemetry.py",
    ),
    ("DELETE", f"{DATA}/logs"): (
        Reason.COVERED_ELSEWHERE,
        "shared types are DATA_ADMIN, owned types are the owner's; "
        "test_admin_route_gating.py",
    ),
    # --- settings ------------------------------------------------------------
    ("GET", f"{DATA}/settings/{{key}}"): (
        Reason.COVERED_ELSEWHERE,
        "two tables, per-key; test_settings_table_split.py",
    ),
    ("PUT", f"{DATA}/settings/{{key}}"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("GET", f"{DATA}/settings/network"): (
        Reason.DEPLOYMENT_WIDE,
        "proxy policy is the deployment's (decision 23)",
    ),
    ("PUT", f"{DATA}/settings/network"): (
        Reason.DEPLOYMENT_WIDE,
        "proxy policy is the deployment's; the write is DATA_ADMIN-gated",
    ),
    # --- admin / deployment ---------------------------------------------------
    ("GET", f"{DATA}/stats"): (Reason.DEPLOYMENT_WIDE, "database totals"),
    ("GET", f"{DATA}/table-sizes"): (Reason.DEPLOYMENT_WIDE, "physical footprint"),
    ("DELETE", f"{DATA}/tables/{{name}}"): (
        Reason.DEPLOYMENT_WIDE,
        "the declared destructive admin operation on stats.py",
    ),
    ("GET", f"{DATA}/export"): (
        Reason.DEPLOYMENT_WIDE,
        "Admin export crosses accounts through unscoped_select(reason=...); "
        "ticket 28 gives it a subject",
    ),
    ("POST", f"{DATA}/import"): (
        Reason.COVERED_ELSEWHERE,
        "never overwrites a foreign row; test_import_write_scoping.py",
    ),
    ("POST", f"{DATA}/bot-credentials/migrate"): (
        Reason.COVERED_ELSEWHERE,
        "the same import by another name; test_import_write_scoping.py",
    ),
    ("GET", f"{DATA}/sync-meta"): (Reason.CORPUS, "etags; SyncMeta is corpus"),
    ("POST", f"{DATA}/setting-groups"): (
        Reason.NOT_ROW_ADDRESSED,
        "creates one owned by the caller",
    ),
    ("POST", f"{DATA}/discover/reports"): (
        Reason.NOT_ROW_ADDRESSED,
        "creates one owned by the caller",
    ),
    # --- jobs -----------------------------------------------------------------
    ("GET", f"{V1}/jobs/sync/{{job_id}}"): (
        Reason.COVERED_ELSEWHERE,
        "test_admin_route_gating.py, in both flag states",
    ),
    ("POST", f"{V1}/jobs/sync/{{job_id}}/cancel"): (
        Reason.COVERED_ELSEWHERE,
        "same file — ungated, because cancelling is a write",
    ),
    ("GET", f"{V1}/jobs/sync/{{job_id}}/events"): (
        Reason.COVERED_ELSEWHERE,
        "SSE; covered structurally, for the hang reason above",
    ),
    ("POST", f"{V1}/jobs/sync"): (
        Reason.NOT_ROW_ADDRESSED,
        "enqueues for the caller over their own followed channels",
    ),
    ("GET", f"{V1}/jobs/runtime-config"): (
        Reason.COVERED_ELSEWHERE,
        "the running-job read is the caller's; test_setting_group_and_job_scoping.py",
    ),
    ("GET", f"{V1}/jobs/status"): (Reason.DEPLOYMENT_WIDE, "JOBS_MANAGE scheduler"),
    ("PUT", f"{V1}/jobs/{{job_id}}"): (Reason.DEPLOYMENT_WIDE, "JOBS_MANAGE"),
    ("POST", f"{V1}/jobs/{{job_id}}/trigger"): (Reason.DEPLOYMENT_WIDE, "JOBS_MANAGE"),
    ("GET", f"{V1}/jobs/lanes"): (Reason.DEPLOYMENT_WIDE, "JOBS_MANAGE lane control"),
    ("POST", f"{V1}/jobs/lanes/{{lane}}/drain"): (
        Reason.DEPLOYMENT_WIDE,
        "JOBS_MANAGE",
    ),
    ("POST", f"{V1}/jobs/lanes/{{lane}}/pause"): (
        Reason.DEPLOYMENT_WIDE,
        "JOBS_MANAGE",
    ),
    ("POST", f"{V1}/jobs/lanes/{{lane}}/resume"): (
        Reason.DEPLOYMENT_WIDE,
        "JOBS_MANAGE",
    ),
    ("GET", f"{V1}/quota/usage"): (
        Reason.COVERED_ELSEWHERE,
        "PK carries user_id; test_quota_usage_route.py",
    ),
    # --- AI, RAG, network, telegram ------------------------------------------
    ("POST", f"{V1}/ai/chat/stream"): (Reason.EXTERNAL, "provider call"),
    ("POST", f"{V1}/ai/embeddings"): (Reason.EXTERNAL, "provider call"),
    ("GET", f"{V1}/ai/models"): (Reason.NOT_ROW_ADDRESSED, "static registry"),
    ("POST", f"{V1}/ai/summary"): (Reason.EXTERNAL, "provider call"),
    ("POST", f"{V1}/ai/summary/prompt"): (
        Reason.COVERED_ELSEWHERE,
        "assembles from the caller's scope; test_prompt_assembly.py",
    ),
    ("POST", f"{V1}/ai/summary/stream"): (Reason.EXTERNAL, "provider call"),
    ("POST", f"{V1}/ai/tag/prompt"): (Reason.COVERED_ELSEWHERE, "test_prompt_assembly"),
    ("POST", f"{V1}/ai/tag/stream"): (Reason.EXTERNAL, "provider call"),
    ("POST", f"{V1}/ai/translate"): (Reason.EXTERNAL, "provider call"),
    ("POST", f"{V1}/rag/embed"): (Reason.CORPUS, "embeddings key off Posts"),
    ("POST", f"{V1}/rag/search"): (
        Reason.COVERED_ELSEWHERE,
        "searches the caller's followed channels; ticket 21 PR 2 gave it the seam",
    ),
    ("GET", f"{V1}/rag/status"): (Reason.DEPLOYMENT_WIDE, "index health"),
    ("GET", f"{V1}/network/proxy-health"): (Reason.DEPLOYMENT_WIDE, "proxy pool"),
    ("POST", f"{V1}/network/test-proxy"): (Reason.EXTERNAL, "probes a proxy"),
    ("GET", f"{V1}/network/tor-ip"): (Reason.EXTERNAL, "asks Tor"),
    ("POST", f"{V1}/network/tor-new-identity"): (Reason.EXTERNAL, "asks Tor"),
    ("POST", f"{V1}/network/tor-restart"): (Reason.DEPLOYMENT_WIDE, "restarts Tor"),
    ("GET", f"{V1}/network/tor-status"): (Reason.EXTERNAL, "asks Tor"),
    ("GET", f"{V1}/telegram/bot-file/{{credential_id}}"): (
        Reason.COVERED_ELSEWHERE,
        "_resolve_bot_token takes may_act_on; test_auto_publish_scoping.py",
    ),
    ("POST", f"{V1}/telegram/bot-info"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("POST", f"{V1}/telegram/publish"): (Reason.COVERED_ELSEWHERE, "same file"),
    ("POST", f"{V1}/telegram/channel-info"): (Reason.EXTERNAL, "asks t.me"),
    ("GET", f"{V1}/telegram/channel-photo/{{channel_id}}"): (
        Reason.CORPUS,
        "avatar cache keyed by handle; shared like the Channel it depicts",
    ),
    ("GET", f"{V1}/telegram/post-thumb/{{channel_name}}/{{post_id}}"): (
        Reason.CORPUS,
        "thumbnail cache keyed by post; shared like the Post",
    ),
    ("POST", f"{V1}/telegram/resolve-start-time"): (Reason.EXTERNAL, "asks t.me"),
    ("POST", f"{V1}/telegram/scrape"): (Reason.EXTERNAL, "asks t.me"),
}


def test_every_mounted_operation_is_probed_or_excused() -> None:
    """The guard that makes this file an inventory rather than a sample.

    A new route joins the API and lands here as a failure, which is the one
    moment "whose rows does this touch?" is cheap to answer. `SCOPES` does this
    for tables and `IMPORT_WRITES` for the import's writes; this is the same
    rule for the surface a stranger can actually reach.
    """
    mounted = _mounted()
    classified = set(PROBED) | set(EXCUSED)

    unclassified = sorted(f"{m} {p}" for m, p in mounted - classified)
    assert not unclassified, (
        "these mounted operations are neither probed nor excused:\n  "
        + "\n  ".join(unclassified)
        + "\n\nAdd a probe below, or an EXCUSED entry saying why the route "
        "cannot leak one account's rows to another."
    )

    stale = sorted(f"{m} {p}" for m, p in classified - mounted)
    assert not stale, (
        "these entries name operations the app no longer serves:\n  "
        + "\n  ".join(stale)
        + "\n\nDrop them rather than leaving a classification nothing checks."
    )


def test_no_operation_is_both_probed_and_excused() -> None:
    """Overlap would let a probe be deleted without the guard noticing."""
    both = sorted(f"{m} {p}" for m, p in set(PROBED) & set(EXCUSED))
    assert not both, f"classified twice: {both}"


def test_every_excuse_names_a_reason_and_says_something() -> None:
    """An empty note is the same as no entry, and reads as though it were one."""
    thin = sorted(
        f"{m} {p}"
        for (m, p), (reason, note) in EXCUSED.items()
        if not isinstance(reason, Reason) or len(note.strip()) < 8
    )
    assert not thin, f"these excuses do not explain themselves: {thin}"


# --------------------------------------------------------------------------
# Making PROBED a claim the suite checks rather than one it takes on trust
# --------------------------------------------------------------------------

#: Every `(METHOD, url)` this module sends through the test client.
_REQUESTS: set[tuple[str, str]] = set()


def _template_to_regex(path: str) -> re.Pattern[str]:
    """`/data/summaries/{summary_id}` → a regex matching one concrete URL."""
    return re.compile(
        "^"
        + re.sub(
            r"\{[^}]+\}",
            r"[^/]+",
            re.escape(path).replace(r"\{", "{").replace(r"\}", "}"),
        )
        + "$"
    )


@pytest.fixture(scope="module", autouse=True)
def _probe_coverage() -> Iterator[None]:
    """Assert, at module teardown, that every `PROBED` entry was really probed.

    Found by review of PR 4, and it is the flaw that mattered most in this
    file. `test_every_mounted_operation_is_probed_or_excused` only checks dict
    *membership*, so an entry in `PROBED` cost nothing to write and proved
    nothing — nine of the twenty-nine had no probe behind them. That is exactly
    the failure the repo names for channel-creation paths: "declaration alone is
    bookkeeping, and a declared module that quietly stopped writing follows
    would pass". The fix there was to require the declared thing actually call
    the writer; this is the same fix, for requests.

    So the client is wrapped for the module and every request it sends is
    recorded, then matched back to the route templates on teardown. A `PROBED`
    entry nothing exercised fails here.

    Teardown rather than a test of its own, because a test would have to run
    last and this suite is deliberately run under random ordering. By teardown
    every test in the module has had its turn, whatever order they took.
    """
    from starlette.testclient import TestClient as _TC

    original = _TC.request

    def recording(self: Any, method: str, url: Any, *args: Any, **kwargs: Any) -> Any:
        _REQUESTS.add((str(method).upper(), str(url).split("?")[0]))
        return original(self, method, url, *args, **kwargs)

    _TC.request = recording  # type: ignore[method-assign]
    try:
        yield
    finally:
        _TC.request = original  # type: ignore[method-assign]

    unproven = sorted(
        f"{method} {path}"
        for method, path in PROBED
        if not any(
            m == method and _template_to_regex(path).match(u) for m, u in _REQUESTS
        )
    )
    assert not unproven, (
        "these entries claim a probe that no test in this file performs:\n  "
        + "\n  ".join(unproven)
        + "\n\nEither write the probe, or move the entry to EXCUSED with the "
        "reason it needs none. A declaration nothing exercises is the "
        "bookkeeping this guard exists to refuse."
    )


# --------------------------------------------------------------------------
# Two live accounts
# --------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Pin enforcement on for every probe in this file.

    It is the shipped default since PR 4, so this is belt and braces for the
    ordinary run — but the suite is deliberately exercised in **both** states
    (`TENANCY_ENFORCED=false pytest` is the rollback rehearsal), and without
    this pin twelve of the probes below fail there. They would be failing for
    the one reason that is not a defect: isolation is exactly what the rollback
    turns off.

    That those twelve fail without the pin is also the mutation evidence for
    this file. Every probe here was watched going red with the flag off before
    it was trusted green with it on — a guard nobody has seen fail is a guard
    nobody should believe.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


@pytest.fixture
def alice(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    yield from _account(client)


@pytest.fixture
def bob(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    yield from _account(client)


def _account(client: TestClient) -> Iterator[tuple[User, dict[str, str]]]:
    """A real account with a usable token.

    The password is set through `crud.create_user` and then used to log in, so
    the headers are a genuine JWT rather than a fabricated one — these probes
    are about what a *request* can reach.
    """
    from app import crud
    from app.models import UserCreate

    password = random_lower_string()
    with Session(engine) as session:
        email = f"{random_lower_string()}@isolation.test-account.com"
        user = crud.create_user(
            session=session, user_create=UserCreate(email=email, password=password)
        )
        session.commit()
        session.refresh(user)
        created = user

    headers = user_authentication_headers(
        client=client, email=created.email, password=password
    )
    yield created, headers

    with Session(engine) as session:
        session.exec(delete(User).where(User.id == created.id))  # type: ignore[call-overload]
        session.commit()


#: One family per row: how to seed a row owned by an account, the URL that
#: names it, and the detail string that family answers for a row that is not
#: there. The detail is the point — 404 alone would be satisfied by a generic
#: "Not found", which moves the enumeration oracle into the payload rather than
#: closing it (`assert_owner`'s rule).
FAMILIES: list[tuple[str, Any, str, str, str]] = [
    (
        "summary",
        lambda rid, owner: Summary(
            id=rid,
            user_id=owner,
            text="body",
            channels=["c"],
            start_date=1,
            end_date=2,
            language="en",
            model="m",
            post_count=1,
            timestamp=0,
        ),
        f"{DATA}/summaries/{{id}}",
        "Summary not found",
        "list:/summaries",
    ),
    (
        "chat-session",
        lambda rid, owner: ChatSession(
            id=rid, user_id=owner, title="t", timestamp=0, updated_at_ms=0
        ),
        f"{DATA}/chat-sessions/{{id}}",
        "Chat session not found",
        "list:/chat-sessions",
    ),
    (
        "tag-run",
        lambda rid, owner: TagRun(id=rid, user_id=owner, timestamp=0),
        f"{DATA}/tag-runs/{{id}}",
        "Tag run not found",
        "list:/tag-runs",
    ),
    (
        "discover-report",
        lambda rid, owner: DiscoverReport(
            id=rid, user_id=owner, timestamp=0, candidates=[], scope={}
        ),
        f"{DATA}/discover/reports/{{id}}",
        "report not found",
        "list:/discover/reports",
    ),
]


def _seed(row: Any) -> None:
    with Session(engine) as session:
        session.add(row)
        session.commit()


@pytest.mark.security
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f[0])
def test_a_foreign_row_is_not_found_by_id(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
    family: tuple[str, Any, str, str, str],
) -> None:
    """404 with the family's own string — not 403, and not a generic message."""
    _name, build, url, detail, _list_url = family
    row_id = f"iso-{uuid.uuid4()}"
    _seed(build(row_id, alice[0].id))

    response = client.get(url.format(id=row_id), headers=bob[1])

    assert response.status_code == 404, response.text[:200]
    assert response.json()["detail"] == detail, (
        "a foreign row answered with a detail of its own. Absent and forbidden "
        "have to be indistinguishable, or the oracle moves into the body."
    )


@pytest.mark.security
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f[0])
def test_a_foreign_row_cannot_be_deleted(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
    family: tuple[str, Any, str, str, str],
) -> None:
    """The write half. A read guard over a writable row is half a fix."""
    name, build, url, detail, _list_url = family
    row_id = f"iso-del-{uuid.uuid4()}"
    row = build(row_id, alice[0].id)
    model = type(row)
    _seed(row)

    response = client.delete(url.format(id=row_id), headers=bob[1])

    assert response.status_code == 404, f"{name}: {response.text[:200]}"
    with Session(engine) as session:
        assert session.get(model, row_id) is not None, (
            f"{name}: another account's row was deleted through a refusal that "
            "answered 404 — the guard ran after the delete, not before it"
        )


@pytest.mark.security
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f[0])
def test_your_own_row_is_still_reachable(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    family: tuple[str, Any, str, str, str],
) -> None:
    """The half a fail-closed bug would satisfy and an outage would too."""
    _name, build, url, _detail, _list_url = family
    row_id = f"iso-mine-{uuid.uuid4()}"
    _seed(build(row_id, alice[0].id))

    response = client.get(url.format(id=row_id), headers=alice[1])

    assert response.status_code == 200, response.text[:200]


@pytest.mark.security
@pytest.mark.parametrize("family", FAMILIES, ids=lambda f: f[0])
def test_a_list_shows_yours_and_not_theirs(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
    family: tuple[str, Any, str, str, str],
) -> None:
    """Both directions in one test, because either alone passes for the wrong
    reason: a route that returns nothing satisfies the absence, and one that
    returns everything satisfies the presence."""
    _name, build, _url, _detail, list_url = family
    path = f"{DATA}{list_url.removeprefix('list:')}"
    mine = f"iso-mine-{uuid.uuid4()}"
    theirs = f"iso-theirs-{uuid.uuid4()}"
    _seed(build(mine, alice[0].id))
    _seed(build(theirs, bob[0].id))

    body = client.get(path, headers=alice[1]).json()
    ids = {row["id"] for row in body}

    assert mine in ids, "an account cannot see its own row"
    assert theirs not in ids, "another account's row is on this page"


@pytest.mark.security
def test_credentials_and_destinations_are_isolated(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """The two families where the id is the leak, not the body.

    `bot_to_camel` never returns `token_encrypted`, so what a shared list leaked
    was the **id** — and a guessable credential id is what ticket 33's
    auto-publish exploit was reached through. Isolation here takes those ids out
    of reach rather than only out of the UI.
    """
    with Session(engine) as session:
        session.add(
            BotCredential(
                id="iso-bot", user_id=alice[0].id, name="a", token_encrypted="x"
            )
        )
        session.add(
            ChatDestination(id="iso-dest", user_id=alice[0].id, name="d", chat_id="1")
        )
        session.commit()

    bots = client.get(f"{DATA}/bot-credentials", headers=bob[1]).json()
    dests = client.get(f"{DATA}/chat-destinations", headers=bob[1]).json()

    assert "iso-bot" not in {row["id"] for row in bots}
    assert "iso-dest" not in {row["id"] for row in dests}

    assert "iso-bot" in {
        row["id"]
        for row in client.get(f"{DATA}/bot-credentials", headers=alice[1]).json()
    }, "the owner cannot see their own credential"

    overwrite = client.put(
        f"{DATA}/bot-credentials/iso-bot",
        json={"name": "stolen", "token": "9:9"},
        headers=bob[1],
    )
    assert overwrite.status_code == 404, overwrite.text[:200]
    with Session(engine) as session:
        row = session.get(BotCredential, "iso-bot")
        assert row is not None and row.name == "a", (
            "another account replaced a stored bot token by naming its id"
        )


@pytest.mark.security
def test_setting_groups_are_isolated(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """Renaming another account's group reschedules every channel in it."""
    created = client.post(
        f"{DATA}/setting-groups", json={"name": "alices-policy"}, headers=alice[1]
    )
    assert created.status_code in (200, 201), created.text[:200]
    group_id = created.json()["id"]

    listed = client.get(f"{DATA}/setting-groups", headers=bob[1]).json()
    assert group_id not in {g["id"] for g in listed}

    renamed = client.put(
        f"{DATA}/setting-groups/{group_id}", json={"name": "bobs"}, headers=bob[1]
    )
    assert renamed.status_code == 404, renamed.text[:200]
    with Session(engine) as session:
        row = session.get(ChannelSettingGroup, group_id)
        assert row is not None and row.name == "alices-policy"


@pytest.mark.security
def test_channels_are_isolated_by_follow(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """The corpus case: the Channel is shared, the Follow is what is private.

    Alice's page shows the handle she follows and Bob's does not, although both
    are looking at one `tg_channels` row. That is the whole shape of the seam
    for follow-scoped tables — nothing is hidden by copying it.
    """
    with Session(engine) as session:
        add_test_channel(session, "iso-chan", user_id=alice[0].id)
        session.commit()

    hers = client.get(f"{DATA}/channels", headers=alice[1]).json()
    his = client.get(f"{DATA}/channels", headers=bob[1]).json()

    assert "iso-chan" in {c["id"] for c in hers}
    assert "iso-chan" not in {c["id"] for c in his}

    assert (
        client.delete(f"{DATA}/channels/iso-chan", headers=bob[1]).status_code == 404
    ), "an account unfollowed a channel it does not follow"

    with Session(engine) as session:
        from app.models_tg import Channel

        assert session.get(Channel, "iso-chan") is not None, (
            "a refused unfollow still removed the shared Channel"
        )


@pytest.mark.security
def test_the_history_shows_only_your_own_artifacts(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """`/data/artifacts` unions four families, and the predicate goes on each
    leg — the union projects labelled columns and `user_id` is not among them,
    so there is nowhere outside to put it (ticket 17)."""
    mine = f"hist-mine-{uuid.uuid4()}"
    theirs = f"hist-theirs-{uuid.uuid4()}"
    _seed(FAMILIES[0][1](mine, alice[0].id))
    _seed(FAMILIES[0][1](theirs, bob[0].id))

    body = client.get(f"{DATA}/artifacts", headers=alice[1]).json()
    rows = body["items"] if isinstance(body, dict) else body
    ids = {row["id"] for row in rows}

    assert mine in ids
    assert theirs not in ids


@pytest.mark.security
def test_the_probe_accounts_really_are_distinct(
    alice: tuple[User, dict[str, str]], bob: tuple[User, dict[str, str]]
) -> None:
    """The premise, asserted.

    Every probe above compares two accounts, and all of them would pass if the
    fixtures handed back the same one — the refusals would simply never be
    exercised. This is the cheapest possible check on the thing they all assume.
    """
    assert alice[0].id != bob[0].id
    assert alice[1]["Authorization"] != bob[1]["Authorization"]


@pytest.mark.security
def test_the_seeded_rows_are_owned_by_who_we_think(
    alice: tuple[User, dict[str, str]],
) -> None:
    """The other premise: `_seed` writes the owner it is given.

    Ticket 21 PR 3 made `user_id` `NOT NULL`, so a builder that dropped the
    argument would now raise rather than silently write NULL — but it could
    still write a *constant*, and every isolation assertion here would then be
    comparing a row to itself.
    """
    row_id = f"iso-premise-{uuid.uuid4()}"
    _seed(FAMILIES[0][1](row_id, alice[0].id))

    with Session(engine) as session:
        stored = session.exec(select(Summary).where(Summary.id == row_id)).one()
        assert stored.user_id == alice[0].id


@pytest.mark.security
def test_turning_the_flag_off_reopens_cross_account_reads(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """What the rollback actually costs, written down rather than implied.

    `TENANCY_ENFORCED=false` is a real switch an operator can throw, and every
    disabled-path test in `test_tenancy_seam.py` promises it restores the
    pre-seam queries byte for byte. This is the other half of that promise and
    the uncomfortable half: pre-seam means **every account sees every account's
    rows**, because that is what a single-operator deployment's queries did.

    So the rollback is for an emergency, not a preference, and anyone reaching
    for it should be able to find this test. It also pins the direction of the
    flag: a mutation that made `tenancy_enforced()` ignore the setting would
    pass every probe above and fail here.
    """
    monkeypatch.setattr(settings, "TENANCY_ENFORCED", False)
    theirs = f"rollback-{uuid.uuid4()}"
    _seed(FAMILIES[0][1](theirs, bob[0].id))

    response = client.get(f"{DATA}/summaries/{theirs}", headers=alice[1])

    assert response.status_code == 200, (
        "with enforcement off a by-id read is expected to succeed across "
        "accounts — if this now refuses, the disabled branch has stopped being "
        "the pre-seam behaviour it promises to restore"
    )


@pytest.mark.security
def test_a_strangers_channel_edit_does_not_reach_your_own_view(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """PUT on an existing channel is how a second account *follows* it.

    Raised by review of PR 4, and the first reading was that this route
    bypasses the follow scoping: Bob PUTs a channel only Alice follows, gets
    the record back, and it starts appearing in his list. That is true and it
    is not the leak it looks like — `PUT /data/channels/{id}` is the add-a-
    channel endpoint, and a `Channel` is shared corpus that anybody may follow.
    Refusing it would mean an account could not add a handle somebody else had
    already scraped, which is the whole point of the corpus being shared.

    What must not happen is Bob's edit reaching **Alice's** view. Per-account
    fields live on the Follow (ticket 04 moved them off the Channel precisely
    so the second follower would not overwrite the first's), and that is the
    property worth pinning here.
    """
    with Session(engine) as session:
        add_test_channel(session, "put-chan", user_id=alice[0].id, tags=["hers"])
        session.commit()

    edited = client.put(
        f"{DATA}/channels/put-chan", json={"tags": ["his"]}, headers=bob[1]
    )
    assert edited.status_code == 200, edited.text[:300]

    hers = next(
        c
        for c in client.get(f"{DATA}/channels", headers=alice[1]).json()
        if c["id"] == "put-chan"
    )
    assert [t["name"] for t in hers["tags"]] == ["hers"], (
        "another account's edit reached this account's tags — the per-account "
        "fields are supposed to live on the Follow, not the shared Channel"
    )

    his = next(
        c
        for c in client.get(f"{DATA}/channels", headers=bob[1]).json()
        if c["id"] == "put-chan"
    )
    assert [t["name"] for t in his["tags"]] == ["his"]


# --------------------------------------------------------------------------
# The write half, per family
# --------------------------------------------------------------------------
#
# Added after review pointed out that `PROBED` listed eight by-id **writes**
# that nothing exercised. Ticket 17's rule is the reason they matter: a scoped
# read over a writable row is half a fix, because `upsert_*` merges into
# whatever row its id names — so a caller who cannot *see* another account's
# summary could still overwrite it by guessing the id, and every read guard
# would pass throughout.

#: `(name, PUT url template, body)` for the by-id writes. The bodies are the
#: smallest thing each endpoint accepts; what is asserted is the refusal and
#: that the stored row is unchanged, never the shape of a success.
WRITES: list[tuple[str, str, dict[str, Any]]] = [
    ("summary", f"{DATA}/summaries/{{id}}", {"text": "stolen"}),
    ("chat-session", f"{DATA}/chat-sessions/{{id}}", {"title": "stolen"}),
    ("tag-run", f"{DATA}/tag-runs/{{id}}", {"status": "stolen"}),
    (
        "discover-report",
        f"{DATA}/discover/reports/{{id}}/flags",
        {"handle": "x", "isFollowed": True},
    ),
]


@pytest.mark.security
@pytest.mark.parametrize("write", WRITES, ids=lambda w: w[0])
def test_a_foreign_row_cannot_be_written_by_id(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
    write: tuple[str, str, dict[str, Any]],
) -> None:
    """Ticket 17's rule at the route: the write is in scope, not only the read."""
    name, url, body = write
    family = next(f for f in FAMILIES if f[0] == name)
    row_id = f"iso-put-{uuid.uuid4()}"
    row = family[1](row_id, alice[0].id)
    model = type(row)
    _seed(row)

    response = client.put(url.format(id=row_id), json=body, headers=bob[1])

    assert response.status_code == 404, f"{name}: {response.text[:200]}"
    with Session(engine) as session:
        stored = session.get(model, row_id)
        assert stored is not None, f"{name}: a refused write deleted the row"
        assert stored.user_id == alice[0].id, (
            f"{name}: the refused write reassigned the row's owner, which is "
            "the takeover ticket 31 found on the import door"
        )


@pytest.mark.security
def test_a_foreign_credential_or_destination_cannot_be_deleted(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """The two families where the row is a secret, not just a record.

    `PUT /data/bot-credentials/{id}` naming a foreign id replaced that
    account's stored **bot token** before ticket 31; the delete is the same
    door with the same client-chosen id, and it had no owner check at all
    either.
    """
    with Session(engine) as session:
        session.add(
            BotCredential(
                id="iso-del-bot", user_id=alice[0].id, name="a", token_encrypted="x"
            )
        )
        session.add(
            ChatDestination(
                id="iso-del-dest", user_id=alice[0].id, name="d", chat_id="1"
            )
        )
        session.commit()

    assert (
        client.delete(f"{DATA}/bot-credentials/iso-del-bot", headers=bob[1]).status_code
        == 404
    )
    assert (
        client.delete(
            f"{DATA}/chat-destinations/iso-del-dest", headers=bob[1]
        ).status_code
        == 404
    )
    assert (
        client.put(
            f"{DATA}/chat-destinations/iso-del-dest",
            json={"name": "stolen", "chatId": "9"},
            headers=bob[1],
        ).status_code
        == 404
    )

    with Session(engine) as session:
        bot = session.get(BotCredential, "iso-del-bot")
        dest = session.get(ChatDestination, "iso-del-dest")
        assert bot is not None and bot.name == "a"
        assert dest is not None and dest.name == "d"


@pytest.mark.security
def test_a_foreign_setting_group_cannot_be_deleted(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """Deleting another account's policy row reschedules every channel in it."""
    created = client.post(
        f"{DATA}/setting-groups", json={"name": "alices-doomed"}, headers=alice[1]
    )
    group_id = created.json()["id"]

    response = client.delete(f"{DATA}/setting-groups/{group_id}", headers=bob[1])

    assert response.status_code == 404, response.text[:200]
    with Session(engine) as session:
        assert session.get(ChannelSettingGroup, group_id) is not None


@pytest.mark.security
def test_your_own_writes_still_land(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
) -> None:
    """The direction a fail-closed bug satisfies, for every write probed above.

    Eight refusals and no successes is an outage that passes as isolation. This
    is the cheapest possible check that the doors still open for their owner.
    """
    row_id = f"iso-own-put-{uuid.uuid4()}"
    _seed(FAMILIES[0][1](row_id, alice[0].id))

    updated = client.put(
        f"{DATA}/summaries/{row_id}", json={"text": "mine"}, headers=alice[1]
    )

    assert updated.status_code == 200, updated.text[:200]
    with Session(engine) as session:
        stored = session.get(Summary, row_id)
        assert stored is not None and stored.text == "mine"


# --------------------------------------------------------------------------
# Bulk follow: three routes that had no owner check at all
# --------------------------------------------------------------------------


def _follow_job_for(owner_id: uuid.UUID) -> str:
    """One in-memory follow job belonging to `owner_id`."""
    import asyncio

    from app.services.bulk_follow import create_follow_job

    job = asyncio.run(
        create_follow_job(
            channels=[{"name": f"iso-follow-{uuid.uuid4().hex[:8]}"}],
            user_id=str(owner_id),
        )
    )
    return job.follow_job_id


@pytest.mark.security
def test_a_foreign_bulk_follow_job_is_not_readable_or_cancellable(
    client: TestClient,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """Found by review of PR 4: all three routes took `_current_user` and never
    used it.

    `get_follow_job` is `_active_jobs.get(id)` with no owner parameter, so any
    signed-in account holding an id read another account's job — the handles
    being added, the per-channel progress, the errors — streamed its SSE, and
    **cancelled** it. `FollowJobState` has carried a required `user_id` since
    PR 2; carrying an owner was never the same thing as checking it.

    The cancel was worse than the read: it called `cancel_follow_job` and *then*
    answered 404 if nothing came back, so a foreign cancel took effect and was
    reported as a missing job. The check moved in front of the call, which is
    the fix — the status code was already right.
    """
    job_id = _follow_job_for(alice[0].id)

    read = client.get(f"{DATA}/channels/bulk-follow/{job_id}", headers=bob[1])
    assert read.status_code == 404, read.text[:200]
    assert read.json()["detail"] == "Follow job not found", (
        "a foreign follow job answered with a detail of its own"
    )

    cancelled = client.post(
        f"{DATA}/channels/bulk-follow/{job_id}/cancel", headers=bob[1]
    )
    assert cancelled.status_code == 404, cancelled.text[:200]

    from app.services.bulk_follow import get_follow_job

    still = get_follow_job(job_id)
    assert still is not None and still.status != "cancelled", (
        "the refusal answered 404 and cancelled the job anyway — the guard has "
        "moved back behind `cancel_follow_job`"
    )


@pytest.mark.security
def test_your_own_bulk_follow_job_is_still_yours(
    client: TestClient, alice: tuple[User, dict[str, str]]
) -> None:
    """The half that would make a fail-closed bug look like a fix.

    Bulk follow is watched through these routes for its whole run; refusing the
    owner satisfies the test above and makes the feature unusable.
    """
    job_id = _follow_job_for(alice[0].id)

    read = client.get(f"{DATA}/channels/bulk-follow/{job_id}", headers=alice[1])

    assert read.status_code == 200, read.text[:200]
    assert read.json()["followJobId"] == job_id


@pytest.mark.security
def test_every_bulk_follow_route_checks_the_owner() -> None:
    """All three, including the stream the test client cannot safely call.

    The SSE route is the reason this is structural rather than another probe: if
    its gate ever fails, a test client has no way to bound the read, so a
    behavioural test would hang rather than fail — the shape
    `test_admin_route_gating.py` documents for `/jobs/sync/{id}/events`. This
    fails in milliseconds and names the handler.

    It also pins **which** guard each one takes. A read may be gated and a write
    may not, so the cancel must not quietly go back to `_visible_follow_job`:
    that would leave the clobber open on the shipping config, which is exactly
    how `/jobs/sync/{id}/cancel` regressed.
    """
    import ast
    import pathlib as _pathlib

    module = (
        _pathlib.Path(__file__).resolve().parents[2] / "app/api/routes/data/channels.py"
    )
    tree = ast.parse(module.read_text())

    expected = {
        "get_bulk_follow_status": "_visible_follow_job",
        "bulk_follow_events": "_visible_follow_job",
        "cancel_bulk_follow": "_assert_may_cancel_follow_job",
    }

    handlers = {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef)
        and node.name in expected
    }
    assert set(handlers) == set(expected), (
        f"expected the three bulk-follow handlers, found {sorted(handlers)} — "
        "this guard is looking at the wrong thing"
    )

    wrong = [
        f"{name} does not call {expected[name]}"
        for name, node in handlers.items()
        if expected[name]
        not in {n.id for n in ast.walk(node) if isinstance(n, ast.Name)}
    ]
    assert not wrong, wrong


@pytest.mark.security
def test_cancelling_a_foreign_bulk_follow_is_refused_with_the_flag_off_too(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    alice: tuple[User, dict[str, str]],
    bob: tuple[User, dict[str, str]],
) -> None:
    """The ungated half, pinned where it is the only thing holding.

    Every other probe in this file runs under the autouse `_enforced` fixture,
    which is right for a *visibility* question and wrong for this one. Cancel
    takes `assert_owner_on_write` precisely so it refuses on the shipping
    config as well, and with the flag pinned on a mutation swapping it for the
    gated `assert_owner` would pass every test above — the half-fix signature
    ticket 31 names, arriving through a fixture rather than through the code.

    So this one turns enforcement off and asserts the refusal survives.
    """
    monkeypatch.setattr(settings, "TENANCY_ENFORCED", False)
    job_id = _follow_job_for(alice[0].id)

    response = client.post(
        f"{DATA}/channels/bulk-follow/{job_id}/cancel", headers=bob[1]
    )

    assert response.status_code == 404, response.text[:200]

    from app.services.bulk_follow import get_follow_job

    still = get_follow_job(job_id)
    assert still is not None and still.status != "cancelled"
