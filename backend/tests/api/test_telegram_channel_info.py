from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from app.core.config import settings

PREFIX = f"{settings.API_V1_STR}/telegram"
LIVE_FIXTURE = Path(__file__).parent.parent / "fixtures" / "live" / "telegram_387.html"


def _auth(client: TestClient) -> dict[str, str]:
    login = client.post(
        f"{settings.API_V1_STR}/login/access-token",
        data={
            "username": settings.FIRST_SUPERUSER,
            "password": settings.FIRST_SUPERUSER_PASSWORD,
        },
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_channel_info_includes_telegram_chat_id(client: TestClient) -> None:
    headers = _auth(client)
    html = LIVE_FIXTURE.read_text(encoding="utf-8")
    with patch(
        "app.services.scraper.fetch_with_retry",
        new_callable=AsyncMock,
        return_value=(html, {"success": True, "totalDuration": 1, "attempts": []}),
    ):
        response = client.post(
            f"{PREFIX}/channel-info",
            json={"channelName": "telegram"},
            headers=headers,
        )
    assert response.status_code == 200
    assert response.json()["telegramChatId"] == -1005640892
