from sqlmodel import Session

from app.core.db import engine
from app.services.tag_runs import list_tag_runs, upsert_tag_run


def test_upsert_tag_run_roundtrip() -> None:
    with Session(engine) as session:
        created = upsert_tag_run(
            session,
            "tag-run-service-1",
            {
                "status": "pending",
                "source": "generated",
                "mode": "add",
                "channels": ["chan_a"],
                "postCount": 3,
                "promptText": "prompt",
                "allTagsSnapshot": ["Politics"],
                "channelContextOptions": {"includeBio": True, "includeTags": False},
                "createdAt": 10,
            },
            user_id=None,
        )
        assert created["id"] == "tag-run-service-1"
        assert created["status"] == "pending"
        assert created["channels"] == ["chan_a"]

        updated = upsert_tag_run(
            session,
            "tag-run-service-1",
            {
                "status": "completed",
                "responseText": '{"chan_a":["Politics"]}',
                "suggestions": {"chan_a": ["Politics"]},
            },
            user_id=None,
        )
        assert updated["status"] == "completed"
        assert updated["suggestions"] == {"chan_a": ["Politics"]}

        runs = list_tag_runs(session)
        ids = [run["id"] for run in runs]
        assert "tag-run-service-1" in ids
