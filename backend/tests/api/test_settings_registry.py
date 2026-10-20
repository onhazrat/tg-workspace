"""The Settings registry's two routes, driven with two live Accounts (SET-02).

`GET /settings/registry` is the page: every Setting the caller may see, with
its value, its resolved default and whether the caller may change it.
`PUT /settings/{settingId}` is the one write door. Both are asserted the way a
caller sees them: which ids come back, which writes land, and what an existing
section route then reads. Nothing here asserts how a row was built.

The two Accounts are an ordinary one and an Owner, who holds
`settings:manage` through the seeded role. An Account without the Permission
sees the deployment Settings that affect it read-only, and the infrastructure
ones not at all: absent, not redacted.
"""

from __future__ import annotations

from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, col, delete

from app.api.deps import VIEW_AS_READ_ONLY_DETAIL
from app.core.config import Settings, settings
from app.core.db import engine
from app.core.permissions import ROLE_OWNER
from app.models import User
from app.models_rbac import UserRole
from app.models_view_as import ViewAsSession
from app.services.quota import Budget, resolve_budget_limits
from tests.utils.user import user_authentication_headers
from tests.utils.utils import random_lower_string

V1 = settings.API_V1_STR
REGISTRY = f"{V1}/settings/registry"

Account = tuple[User, dict[str, str]]


def _account(client: TestClient, *, role: str | None = None) -> Iterator[Account]:
    from app import crud
    from app.models import UserCreate

    password = random_lower_string()
    with Session(engine) as session:
        email = f"{random_lower_string()}@registry.test-account.com"
        user = crud.create_user(
            session=session, user_create=UserCreate(email=email, password=password)
        )
        if role is not None:
            session.add(UserRole(user_id=user.id, role_id=role))
        session.commit()
        session.refresh(user)
        created = user
    yield (
        created,
        user_authentication_headers(
            client=client, email=created.email, password=password
        ),
    )
    with Session(engine) as session:
        session.exec(delete(ViewAsSession))  # type: ignore[call-overload]
        session.exec(delete(User).where(col(User.id) == created.id))  # type: ignore[call-overload]
        session.commit()


@pytest.fixture
def member(client: TestClient) -> Iterator[Account]:
    yield from _account(client)


@pytest.fixture
def other_member(client: TestClient) -> Iterator[Account]:
    yield from _account(client)


@pytest.fixture
def operator(client: TestClient) -> Iterator[Account]:
    yield from _account(client, role=ROLE_OWNER)


def _rows(client: TestClient, headers: dict[str, str]) -> dict[str, dict[str, Any]]:
    response = client.get(REGISTRY, headers=headers)
    assert response.status_code == 200, response.text
    return {row["id"]: row for row in response.json()["rows"]}


def _put(
    client: TestClient, headers: dict[str, str], setting_id: str, body: dict[str, Any]
) -> Any:
    return client.put(f"{V1}/settings/{setting_id}", headers=headers, json=body)


# --------------------------------------------------------------------------
# Who sees what
# --------------------------------------------------------------------------


def test_an_account_sees_its_own_settings_and_the_deployment_rules_it_works_under(
    client: TestClient, member: Account
) -> None:
    rows = _rows(client, member[1])

    assert rows["retention.yours.logDays"]["scope"] == "account"
    assert rows["retention.yours.logDays"]["canEdit"] is True
    post_days = rows["retention.deployment.postDays"]
    assert post_days["scope"] == "deployment"
    assert post_days["canEdit"] is False
    assert post_days["lockReason"] == "Set by the Operator"
    assert "sync.deployment.intervalMinutes" in rows
    assert "ai.deployment.translation" in rows
    assert "reach.deployment.settlingAgeHours" in rows


def test_infrastructure_settings_are_absent_for_an_account_without_the_permission(
    client: TestClient, member: Account, operator: Account
) -> None:
    mine = _rows(client, member[1])
    theirs = _rows(client, operator[1])

    infrastructure = {
        "network.deployment.proxy",
        "jobs.deployment.autoSyncEnabled",
        "media.deployment.thumbCacheMaxSizeMb",
        "quota.deployment.autoSyncAllowance",
    }
    assert infrastructure.isdisjoint(mine)
    assert infrastructure <= set(theirs)
    assert {row["scope"] for row in mine.values()} <= {
        "browser",
        "account",
        "deployment",
    }


def test_an_operator_may_change_deployment_settings(
    client: TestClient, operator: Account
) -> None:
    rows = _rows(client, operator[1])
    assert rows["retention.deployment.postDays"]["canEdit"] is True
    assert rows["retention.deployment.postDays"]["lockReason"] is None


def test_browser_settings_are_declared_for_the_page_to_fill_in(
    client: TestClient, member: Account
) -> None:
    rows = _rows(client, member[1])
    theme = rows["appearance.browser.theme"]
    assert theme["scope"] == "browser"
    assert theme["storage"] == "This browser: vite-ui-theme"
    assert [o["value"] for o in theme["options"]] == ["light", "dark", "system"]


def test_the_registry_names_the_topics_in_page_order(
    client: TestClient, member: Account
) -> None:
    topics = client.get(REGISTRY, headers=member[1]).json()["topics"]
    ids = [topic["id"] for topic in topics]
    assert ids[:4] == ["account", "appearance", "sync", "ai"]
    assert ids[-1] == "operator"


def test_the_registry_says_which_permissions_the_caller_holds(
    client: TestClient, member: Account, operator: Account
) -> None:
    assert client.get(REGISTRY, headers=member[1]).json()["permissions"] == []
    assert (
        "settings:manage"
        in client.get(REGISTRY, headers=operator[1]).json()["permissions"]
    )


# --------------------------------------------------------------------------
# Defaults
# --------------------------------------------------------------------------


def test_a_default_says_which_layer_it_comes_from(
    client: TestClient, member: Account
) -> None:
    rows = _rows(client, member[1])

    log_days = rows["retention.yours.logDays"]
    assert log_days["default"] == settings.RETENTION_LOG_DAYS_DEFAULT
    assert log_days["defaultSource"] == "env"
    assert log_days["value"] == log_days["default"]
    assert log_days["modified"] is False

    expected = rows["sync.yours.dynamicSyncExpectedPosts"]
    assert expected["default"] == 15
    assert expected["defaultSource"] == "code"


def test_the_defaults_that_lived_only_in_the_browser_come_from_the_registry(
    client: TestClient, member: Account, operator: Account
) -> None:
    mine = _rows(client, member[1])
    assert mine["publishing.yours.citationStyle"]["default"] == "asWritten"
    assert mine["publishing.yours.linkPreviews"]["default"] is False

    theirs = _rows(client, operator[1])
    assert theirs["network.deployment.torMode"]["default"] == "auto"
    assert theirs["network.deployment.torProxyUrls"]["default"] == (
        "socks5h://127.0.0.1:9050"
    )
    assert theirs["network.deployment.torControlPort"]["default"] == (
        settings.TOR_CONTROL_PORT
    )
    assert theirs["network.deployment.torControlPort"]["defaultSource"] == "env"


def test_the_quota_defaults_fall_back_to_env(
    client: TestClient, operator: Account
) -> None:
    rows = _rows(client, operator[1])
    allowance = rows["quota.deployment.autoSyncAllowance"]
    assert allowance["value"] == settings.QUOTA_DEFAULT_AUTO_SYNC_REQUESTS
    assert allowance["defaultSource"] == "env"
    ceiling = rows["quota.deployment.manualSingleCeiling"]
    assert ceiling["value"] == settings.QUOTA_DEFAULT_MANUAL_SINGLE_CEILING_REQUESTS


# --------------------------------------------------------------------------
# Writes, one per scope
# --------------------------------------------------------------------------


def test_an_account_write_lands_on_that_account_alone(
    client: TestClient, member: Account, other_member: Account
) -> None:
    response = _put(client, member[1], "retention.yours.logDays", {"value": 3})
    assert response.status_code == 200, response.text
    row = response.json()
    assert row["value"] == 3
    assert row["modified"] is True

    section = client.get(f"{V1}/data/settings/retention", headers=member[1])
    assert section.json()["value"]["logRetentionDays"] == 3
    theirs = client.get(f"{V1}/data/settings/retention", headers=other_member[1])
    assert theirs.json()["value"]["logRetentionDays"] == (
        settings.RETENTION_LOG_DAYS_DEFAULT
    )
    assert _rows(client, other_member[1])["retention.yours.logDays"]["value"] == (
        settings.RETENTION_LOG_DAYS_DEFAULT
    )


def test_a_deployment_write_reaches_every_account(
    client: TestClient, operator: Account, member: Account
) -> None:
    response = _put(client, operator[1], "reach.deployment.sampleSize", {"value": 42})
    assert response.status_code == 200, response.text

    assert _rows(client, member[1])["reach.deployment.sampleSize"]["value"] == 42
    section = client.get(f"{V1}/data/settings/reach", headers=member[1])
    assert section.json()["value"]["reachSampleSize"] == 42


def test_a_nested_field_is_written_in_place(
    client: TestClient, operator: Account
) -> None:
    response = _put(
        client, operator[1], "jobs.deployment.retentionEnabled", {"value": False}
    )
    assert response.status_code == 200, response.text
    section = client.get(f"{V1}/data/settings/jobs", headers=operator[1]).json()
    assert section["value"]["retention"]["enabled"] is False
    assert section["value"]["auto_sync"]["enabled"] == (
        settings.JOBS_AUTO_SYNC_ENABLED_DEFAULT
    )


def test_a_quota_default_is_what_the_enqueue_then_resolves(
    client: TestClient, operator: Account, member: Account
) -> None:
    response = _put(
        client, operator[1], "quota.deployment.manualBulkAllowance", {"value": 7}
    )
    assert response.status_code == 200, response.text
    with Session(engine) as session:
        limits = resolve_budget_limits(session, Budget.MANUAL_BULK, member[0].id)
    assert limits.allowance == 7


def test_a_reset_returns_the_row_to_its_default(
    client: TestClient, member: Account
) -> None:
    _put(client, member[1], "publishing.yours.citationStyle", {"value": "numbered"})
    response = _put(
        client, member[1], "publishing.yours.citationStyle", {"reset": True}
    )
    assert response.status_code == 200, response.text
    assert response.json()["value"] == "asWritten"
    assert response.json()["modified"] is False


# --------------------------------------------------------------------------
# Refusals
# --------------------------------------------------------------------------


def test_an_id_the_caller_cannot_see_is_not_found(
    client: TestClient, member: Account
) -> None:
    assert (
        _put(client, member[1], "network.deployment.proxy", {"value": True}).status_code
        == 404
    )
    assert (
        _put(client, member[1], "nothing.yours.here", {"value": 1}).status_code == 404
    )


def test_a_setting_the_caller_cannot_change_answers_its_lock_reason(
    client: TestClient, member: Account
) -> None:
    response = _put(client, member[1], "retention.deployment.postDays", {"value": 1})
    assert response.status_code == 403
    assert response.json()["detail"] == "Set by the Operator"


@pytest.mark.parametrize(
    ("setting_id", "value"),
    [
        ("retention.yours.logDays", -1),
        ("retention.yours.logDays", "ten"),
        ("retention.yours.logDays", True),
        ("publishing.yours.citationStyle", "loud"),
        ("publishing.yours.linkPreviews", "yes"),
    ],
)
def test_a_value_outside_its_declaration_is_refused(
    client: TestClient, member: Account, setting_id: str, value: Any
) -> None:
    response = _put(client, member[1], setting_id, {"value": value})
    assert response.status_code == 422
    assert isinstance(response.json()["detail"], str)


def test_reach_settings_are_validated_against_each_other(
    client: TestClient, operator: Account
) -> None:
    response = _put(
        client, operator[1], "reach.deployment.estimationFloorHours", {"value": 500}
    )
    assert response.status_code == 422


def test_a_browser_setting_is_not_written_on_the_server(
    client: TestClient, member: Account
) -> None:
    response = _put(client, member[1], "appearance.browser.theme", {"value": "dark"})
    assert response.status_code == 422


# --------------------------------------------------------------------------
# View-as
# --------------------------------------------------------------------------


def test_view_as_shows_the_targets_page_and_refuses_writes_until_elevated(
    client: TestClient, operator: Account, member: Account
) -> None:
    owner_headers = operator[1]
    target = member[0]

    looking = client.post(f"{V1}/view-as/{target.id}", headers=owner_headers)
    assert looking.status_code == 200, looking.text
    looking_headers = {"Authorization": f"Bearer {looking.json()['accessToken']}"}

    rows = _rows(client, looking_headers)
    assert "network.deployment.proxy" not in rows
    refused = _put(client, looking_headers, "retention.yours.logDays", {"value": 2})
    assert refused.status_code == 403
    assert refused.json()["detail"] == VIEW_AS_READ_ONLY_DETAIL

    elevated = client.post(f"{V1}/view-as/{target.id}/elevate", headers=owner_headers)
    assert elevated.status_code == 200, elevated.text
    elevated_headers = {"Authorization": f"Bearer {elevated.json()['accessToken']}"}
    written = _put(client, elevated_headers, "retention.yours.logDays", {"value": 2})
    assert written.status_code == 200, written.text
    assert _rows(client, member[1])["retention.yours.logDays"]["value"] == 2


# --------------------------------------------------------------------------
# Configuration (SET-04): `.env`, frontend build values and code constants
# --------------------------------------------------------------------------

CONFIGURATION = {"env", "code"}


def test_configuration_is_listed_for_an_operator_and_absent_for_an_account(
    client: TestClient, member: Account, operator: Account
) -> None:
    mine = _rows(client, member[1])
    theirs = _rows(client, operator[1])

    assert not [i for i, r in mine.items() if r["scope"] in CONFIGURATION]
    scopes = {r["scope"] for r in theirs.values()}
    assert CONFIGURATION <= scopes
    env_names = {r["envName"] for r in theirs.values() if r["scope"] == "env"}
    assert set(Settings.model_fields) <= env_names
    assert "VITE_API_URL" in env_names
    assert any(r["scope"] == "code" for r in theirs.values())


def test_an_env_row_says_what_it_is_where_it_came_from_and_what_it_costs(
    client: TestClient, operator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    row = _rows(client, operator[1])["server.env.slowRequestLogMs"]
    assert row["envName"] == "SLOW_REQUEST_LOG_MS"
    assert "time-to-first-byte" in row["description"]
    assert row["value"] == settings.SLOW_REQUEST_LOG_MS
    assert row["default"] == 1000
    assert row["applies"] == "restart"
    assert row["canEdit"] is False
    assert row["lockReason"] == "Read at startup: change .env and restart"
    assert row["sourceRef"].startswith("backend/app/core/config.py:")

    monkeypatch.setenv("SLOW_REQUEST_LOG_MS", "1234")
    monkeypatch.setattr(settings, "SLOW_REQUEST_LOG_MS", 1234)
    changed = _rows(client, operator[1])["server.env.slowRequestLogMs"]
    assert changed["value"] == 1234
    assert changed["modified"] is True
    assert changed["storage"].startswith("Environment")


def test_a_secret_is_only_set_or_not_set_and_never_changed(
    client: TestClient, operator: Account, monkeypatch: pytest.MonkeyPatch
) -> None:
    secret = "a-very-secret-value-nobody-should-see"
    monkeypatch.setattr(settings, "GEMINI_API_KEY", secret)
    response = client.get(REGISTRY, headers=operator[1])
    assert response.status_code == 200
    assert secret not in response.text
    assert settings.SECRET_KEY not in response.text
    assert settings.POSTGRES_PASSWORD not in response.text

    rows = {r["id"]: r for r in response.json()["rows"]}
    secrets = [r for r in rows.values() if r["sensitive"]]
    assert {r["envName"] for r in secrets} >= {"GEMINI_API_KEY", "SECRET_KEY"}
    for row in secrets:
        # A frontend build value is filled in by the browser, never sent.
        allowed = (None,) if row["applies"] == "rebuild" else ("set", "not set")
        assert row["value"] in allowed, row["id"]
        assert row["default"] is None, row["id"]
        assert row["modified"] is False, row["id"]
    gemini = next(r for r in secrets if r["envName"] == "GEMINI_API_KEY")
    assert gemini["value"] == "set"


def test_a_frontend_build_value_is_rebuilt_to_apply(
    client: TestClient, operator: Account
) -> None:
    rows = _rows(client, operator[1])
    row = next(r for r in rows.values() if r.get("envName") == "VITE_API_URL")
    assert row["scope"] == "env"
    assert row["applies"] == "rebuild"
    assert row["canEdit"] is False
    # Only the browser knows what its bundle was built with.
    assert row["value"] is None


def test_a_code_constant_names_its_file_and_line(
    client: TestClient, operator: Account
) -> None:
    from app.services.channels import CHANNEL_CLAIM_LEASE_SECONDS

    row = _rows(client, operator[1])["sync.code.channelClaimLeaseSeconds"]
    assert row["value"] == CHANNEL_CLAIM_LEASE_SECONDS
    assert row["default"] == CHANNEL_CLAIM_LEASE_SECONDS
    assert row["modified"] is False
    assert row["type"] == "integer"
    assert row["applies"] == "deploy"
    assert row["lockReason"] == "Constant in code: needs a deploy"
    assert row["sourceRef"].startswith("backend/app/services/channels.py:")
    assert row["description"]


def test_every_row_id_is_unique(client: TestClient, operator: Account) -> None:
    response = client.get(REGISTRY, headers=operator[1])
    ids = [r["id"] for r in response.json()["rows"]]
    assert len(ids) == len(set(ids))


def test_configuration_cannot_be_written_and_is_not_found_without_the_permission(
    client: TestClient, member: Account, operator: Account
) -> None:
    refused = _put(client, operator[1], "server.env.slowRequestLogMs", {"value": 5})
    assert refused.status_code == 403
    assert refused.json()["detail"] == "Read at startup: change .env and restart"
    constant = _put(
        client, operator[1], "sync.code.channelClaimLeaseSeconds", {"value": 5}
    )
    assert constant.status_code == 403
    assert constant.json()["detail"] == "Constant in code: needs a deploy"
    hidden = _put(client, member[1], "server.env.slowRequestLogMs", {"value": 5})
    assert hidden.status_code == 404


# --------------------------------------------------------------------------
# AI preferences follow the Account (SET-05)
# --------------------------------------------------------------------------

AI_PREFS = f"{V1}/data/settings/ai_prefs"


def test_ai_preferences_default_to_the_deployments_model_and_language(
    client: TestClient, member: Account
) -> None:
    rows = _rows(client, member[1])
    model = rows["ai.yours.model"]
    assert model["scope"] == "account"
    assert model["value"] == model["default"] == settings.DEFAULT_AI_MODEL
    assert model["defaultSource"] == "env"
    language = rows["ai.yours.language"]
    assert language["value"] == language["default"] == settings.DEFAULT_AI_LANGUAGE
    assert language["defaultSource"] == "env"
    assert rows["ai.yours.temperature"]["default"] == 0.7
    assert not {"ai.browser.model", "ai.browser.language"} & set(rows)


def test_two_accounts_keep_separate_ai_preferences(
    client: TestClient, member: Account, other_member: Account
) -> None:
    mine = _put(client, member[1], "ai.yours.model", {"value": "m-1"})
    assert mine.status_code == 200, mine.text
    theirs = _put(client, other_member[1], "ai.yours.model", {"value": "m-2"})
    assert theirs.status_code == 200, theirs.text
    assert _rows(client, member[1])["ai.yours.model"]["value"] == "m-1"
    assert _rows(client, other_member[1])["ai.yours.model"]["value"] == "m-2"


def test_a_registry_write_is_what_the_action_tab_reads(
    client: TestClient, member: Account, other_member: Account
) -> None:
    """The run bar reads `SettingsContext`, which hydrates from this section."""
    _put(client, member[1], "ai.yours.model", {"value": "anthropic/claude-x"})
    _put(client, member[1], "ai.yours.language", {"value": "Persian"})
    _put(client, member[1], "ai.yours.temperature", {"value": 0.2})

    mine = client.get(AI_PREFS, headers=member[1]).json()["value"]
    assert mine == {
        "selectedModel": "anthropic/claude-x",
        "aiLanguage": "Persian",
        "aiTemperature": 0.2,
    }
    # An Account with none answers empty, which is what the one-time upload
    # from an older browser checks before it writes.
    assert client.get(AI_PREFS, headers=other_member[1]).json()["value"] == {}


@pytest.mark.parametrize(
    ("setting_id", "value"),
    [
        ("ai.yours.temperature", 1.5),
        ("ai.yours.language", "Klingon"),
        ("ai.yours.model", 3),
    ],
)
def test_an_ai_preference_outside_its_declaration_is_refused(
    client: TestClient, member: Account, setting_id: str, value: Any
) -> None:
    assert _put(client, member[1], setting_id, {"value": value}).status_code == 422
