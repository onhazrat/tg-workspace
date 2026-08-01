"""Wire shapes for the last six untyped `/data` families (B6b).

Two of these are worth more than a key-set check.

`test_a_bot_token_never_reaches_the_wire` is a **security** assertion, not a
shape one, and the closed model is doing real work — demonstrated rather than
assumed. Making `bot_to_camel` emit `token` while `BotCredentialResponse` stays
closed leaves this test **passing**, because the model strips the key before it
reaches the wire. Opening the model with the same leaky serialiser makes it
**fail**. So a future serialiser change cannot leak the token past this model;
only editing the model itself can, which is visible in review and in the
generated client.

`test_channel_count_is_present_but_undeclared` covers a key that is *optional in
the serialiser but supplied by every caller*. `setting_group_to_camel` attaches
`channelCount` only when given one, and all three call sites give one — so it is
always on the wire today. The model still leaves it undeclared: declaring it with
a default would silently turn a future omission into `0` instead of an absent
key, which is the failure mode this whole family of models exists to avoid.
"""

from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = f"{settings.API_V1_STR}/data"

GROUP_KEYS = {
    "id",
    "name",
    "isDefault",
    "isReserved",
    "regularSyncEnabled",
    "dynamicSyncEnabled",
    "autoSyncIntervalMinutes",
    "dynamicSyncExpectedPosts",
    "autoFollowForwarded",
    "isFrozen",
    "isUnavailableOnWebView",
    "includeInSyncAll",
    "includeInBulkSync",
    "allowIndividualSync",
    "resetSyncEnabled",
    "createdAt",
    "updatedAt",
}


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_a_bot_token_never_reaches_the_wire(client: TestClient) -> None:
    """The response reports *whether* a token exists, never the token."""
    headers = _auth(client)
    secret = "123456:AAH-super-secret-bot-token"
    put = client.put(
        f"{PREFIX}/bot-credentials/b-secret",
        json={"name": "Secret Bot", "token": secret},
        headers=headers,
    )
    assert put.status_code == 200, put.text
    assert set(put.json()) == {
        "id",
        "name",
        "hasToken",
        "username",
        "photoUrl",
        "lastValidated",
    }
    assert put.json()["hasToken"] is True

    listed = client.get(f"{PREFIX}/bot-credentials", headers=headers)
    body = listed.text
    assert secret not in body, "the raw token leaked into the list response"
    assert "token" not in listed.json()[0], "a `token` key appeared on the wire"


def test_chat_destinations_keep_their_key_set(client: TestClient) -> None:
    headers = _auth(client)
    put = client.put(
        f"{PREFIX}/chat-destinations/d1",
        json={"name": "Ops", "chatId": "-100123"},
        headers=headers,
    )
    assert put.status_code == 200, put.text
    assert set(put.json()) == {"id", "name", "chatId"}
    assert put.json()["chatId"] == "-100123"


def test_channel_count_is_present_but_undeclared(client: TestClient) -> None:
    """All three endpoints emit `channelCount`; the model declares none of it.

    `setting_group_to_camel` takes `channel_count: int | None = None` and only
    attaches the key when given one — but every call site supplies it, so it is
    always on the wire. `SettingGroupResponse` is open and leaves it undeclared
    so that stays true by *observation* rather than by the model asserting it.
    """
    headers = _auth(client)
    created = client.post(
        f"{PREFIX}/setting-groups", json={"name": "B6b Group"}, headers=headers
    )
    assert created.status_code == 200, created.text
    assert set(created.json()) == GROUP_KEYS | {"channelCount"}
    assert created.json()["channelCount"] == 0

    group_id = created.json()["id"]
    try:
        listed = client.get(f"{PREFIX}/setting-groups", headers=headers).json()
        assert listed
        for row in listed:
            assert set(row) == GROUP_KEYS | {"channelCount"}
            assert isinstance(row["channelCount"], int)

        updated = client.put(
            f"{PREFIX}/setting-groups/{group_id}",
            json={"name": "B6b Group Renamed"},
            headers=headers,
        )
        assert updated.status_code == 200
        assert set(updated.json()) == GROUP_KEYS | {"channelCount"}
    finally:
        client.delete(f"{PREFIX}/setting-groups/{group_id}", headers=headers)


def test_deleting_a_group_still_answers_with_the_status_envelope(
    client: TestClient,
) -> None:
    headers = _auth(client)
    created = client.post(
        f"{PREFIX}/setting-groups", json={"name": "B6b Doomed"}, headers=headers
    )
    gid = created.json()["id"]

    deleted = client.delete(f"{PREFIX}/setting-groups/{gid}", headers=headers)
    assert deleted.status_code == 200
    assert deleted.json() == {"status": "deleted"}


def test_settings_reads_keep_the_key_value_envelope(client: TestClient) -> None:
    headers = _auth(client)
    for key in ("jobs", "sync", "retention", "translation"):
        body = client.get(f"{PREFIX}/settings/{key}", headers=headers).json()
        assert set(body) == {"key", "value"}
        assert body["key"] == key
        assert isinstance(body["value"], dict)

    network = client.get(f"{PREFIX}/settings/network", headers=headers).json()
    assert set(network) == {"key", "value"}
    assert network["key"] == "network"


def test_tag_run_list_omits_the_corpus_sized_fields(client: TestClient) -> None:
    """Same light/full split as summaries: `promptText` is a whole post corpus."""
    headers = _auth(client)
    run: dict[str, Any] = {
        "status": "done",
        "source": "manual",
        "mode": "suggest",
        "channels": ["ch"],
        "startDate": 0,
        "endDate": 1,
        "postCount": 2,
        "promptText": "word " * 200,
        "responseText": "some response",
        "suggestions": [{"channel": "ch", "tags": ["x"]}],
    }
    created = client.put(f"{PREFIX}/tag-runs/tr-1", json=run, headers=headers)
    assert created.status_code == 200, created.text
    assert created.json()["promptText"].startswith("word")

    rows = client.get(f"{PREFIX}/tag-runs", headers=headers).json()
    row = next(r for r in rows if r["id"] == "tr-1")
    for heavy in ("promptText", "responseText", "suggestions", "allTagsSnapshot"):
        assert heavy not in row, f"{heavy} leaked into the list projection"


def test_translations_keep_their_key_set(client: TestClient) -> None:
    headers = _auth(client)
    written = client.post(
        f"{PREFIX}/translations",
        json=[
            {
                "id": "ch_1_fa",
                "channelName": "ch",
                "postId": 1,
                "language": "fa",
                "translatedText": "سلام",
                "timestamp": 1000,
            }
        ],
        headers=headers,
    )
    assert written.status_code == 200
    assert written.json() == {"upserted": 1}

    rows = client.get(f"{PREFIX}/translations", headers=headers).json()
    assert rows
    assert set(rows[0]) == {
        "id",
        "channelName",
        "postId",
        "language",
        "translatedText",
        "timestamp",
    }
