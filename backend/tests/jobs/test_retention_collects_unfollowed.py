"""Channels nobody follows are collected by retention (ticket 05).

Removal stopped deleting anything, so something has to. A Channel at zero
followers is unreachable — no account has it on a list, no scheduler holds a
deadline for it — and its Posts are a corpus nobody asked for. Retention is
where that gets reclaimed, which makes the delete deferred rather than gone.

The collection takes the Posts with it, and that is not a contradiction of
"removal leaves Posts alone": removal is one account acting on its own list,
collection is what happens once *no* account holds the corpus. `Post` has no
foreign key to `Channel` — it is keyed by `channel_name` — so a Channel
collected without its Posts leaves rows nothing can reach, reclaimable only by
the post retention window, which an operator is free to set to 0.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* skip the collection step entirely → the collects-a-channel test fails
* collect every channel instead of the followerless ones → the still-followed
  test fails
* delete the Channel row but leave the Posts → the posts assertion fails
* leave the dependent rows behind → the dependents test fails
* collect without committing → the re-read in a second session fails
* drop the backfill-marker gate, or make `follows_backfilled` always say yes →
  the refuses-before-the-backfill test fails
* drop the shared-name guard → the shared-corpus test fails
* ignore `COLLECT_LIMIT` → the pass-limit test fails
"""

from __future__ import annotations

from sqlmodel import Session, col, delete, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_settings_section
from app.models_tg import (
    Channel,
    ChannelFollow,
    Post,
    PostEmbedding,
    PostSyncState,
    PostTranslation,
)
from app.services.follows import FOLLOWS_BACKFILL_KEY, ensure_follow
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user


def _retention_off(session: Session) -> None:
    """Every window disabled, so only the new collection step can delete.

    Also records the follow backfill as complete, because collection refuses to
    run otherwise — see `test_collection_refuses_to_run_before_the_backfill`.
    """
    save_settings_section(
        session,
        "retention",
        {
            "postRetentionDays": 0,
            "logRetentionDays": 0,
            "payloadRetentionDays": 0,
            "reportRetentionDays": 0,
            "reportRetentionMax": 0,
        },
    )
    save_settings_section(
        session, FOLLOWS_BACKFILL_KEY, {"completedAt": 1_700_000_000_000}
    )


def _clear_backfill_marker(session: Session) -> None:
    save_settings_section(session, FOLLOWS_BACKFILL_KEY, {})


def _unfollow_everyone(session: Session, channel_id: str) -> None:
    """Leave the channel at zero followers, however it was created.

    The test helper writes the follow every production creation path writes, so
    "nobody follows this" has to be arranged rather than assumed — which is the
    state a real unfollow produces.
    """
    session.exec(
        delete(ChannelFollow).where(col(ChannelFollow.channel_id) == channel_id)
    )
    session.commit()


def _add_posts(session: Session, channel: str, count: int) -> None:
    for i in range(count):
        session.add(
            Post(
                channel_name=channel,
                post_id=i,
                text=f"{channel}-{i}",
                timestamp=1000 + i,
            )
        )


def _posts(session: Session, channel: str) -> list[Post]:
    return list(
        session.exec(select(Post).where(col(Post.channel_name) == channel)).all()
    )


def test_the_channel_helper_writes_a_follow() -> None:
    """The premise of every arrangement above, asserted rather than assumed.

    Every production path that creates a Channel writes a Follow — ticket 04's
    guard walks the AST to say so. The test helper did not, which cost nothing
    while zero followers was an impossible state and costs a great deal now
    that it is the state retention reclaims: a fixture channel would disappear
    mid-test in whichever suite happened to run a cleanup, and the failure
    would land nowhere near its cause.

    So `_unfollow_everyone` has to actually remove something. Without this,
    dropping the helper's follow write leaves the tests below green for the
    wrong reason.
    """
    with Session(engine) as session:
        add_test_channel(session, "helper-follow-ch", name="helper-follow-ch")

        followers = session.exec(
            select(ChannelFollow).where(
                col(ChannelFollow.channel_id) == "helper-follow-ch"
            )
        ).all()
        assert len(followers) == 1


def test_retention_collects_a_channel_nobody_follows() -> None:
    with Session(engine) as session:
        _retention_off(session)
        add_test_channel(session, "orphaned-ch", name="orphaned-ch")
        _add_posts(session, "orphaned-ch", 3)
        session.commit()
        _unfollow_everyone(session, "orphaned-ch")

        result = run_retention_cleanup(session)

        assert result["deletedChannels"] >= 1

    with Session(engine) as session:
        assert session.get(Channel, "orphaned-ch") is None
        assert _posts(session, "orphaned-ch") == []


def test_retention_keeps_a_channel_someone_still_follows() -> None:
    with Session(engine) as session:
        _retention_off(session)
        user = create_random_user(session)
        add_test_channel(session, "followed-ch", name="followed-ch", user_id=user.id)
        _add_posts(session, "followed-ch", 3)
        ensure_follow(session, channel_id="followed-ch", user_id=user.id)
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as session:
        assert session.get(Channel, "followed-ch") is not None
        assert len(_posts(session, "followed-ch")) == 3


def test_collection_takes_the_dependent_rows_too() -> None:
    """Embeddings, translations and sync state are keyed by channel name.

    Nothing cascades them — no foreign key to `tg_channels` exists anywhere in
    this group — so a collection that removed only Posts would leave three
    tables pointing at a channel that is gone.
    """
    with Session(engine) as session:
        _retention_off(session)
        add_test_channel(session, "deps-ch", name="deps-ch")
        _add_posts(session, "deps-ch", 2)
        session.add(
            PostEmbedding(
                id="deps-emb-0",
                channel_name="deps-ch",
                post_id=0,
                vector=[0.1, 0.2],
                text="hi",
            )
        )
        session.add(
            PostTranslation(
                id="deps-tr-0",
                channel_name="deps-ch",
                post_id=0,
                language="en",
                translated_text="hi",
            )
        )
        session.add(PostSyncState(channel_name="deps-ch", post_id=0))
        session.commit()
        _unfollow_everyone(session, "deps-ch")

        run_retention_cleanup(session)

    with Session(engine) as session:
        assert (
            session.exec(
                select(PostEmbedding).where(
                    col(PostEmbedding.channel_name) == "deps-ch"
                )
            ).all()
            == []
        )
        assert (
            session.exec(
                select(PostTranslation).where(
                    col(PostTranslation.channel_name) == "deps-ch"
                )
            ).all()
            == []
        )
        assert (
            session.exec(
                select(PostSyncState).where(
                    col(PostSyncState.channel_name) == "deps-ch"
                )
            ).all()
            == []
        )


def test_collection_leaves_a_followed_channel_alone_in_the_same_run() -> None:
    """One followerless channel next to a followed one, one retention pass."""
    with Session(engine) as session:
        _retention_off(session)
        user = create_random_user(session)
        add_test_channel(session, "goes-ch", name="goes-ch")
        add_test_channel(session, "stays-ch", name="stays-ch", user_id=user.id)
        _add_posts(session, "goes-ch", 2)
        _add_posts(session, "stays-ch", 2)
        ensure_follow(session, channel_id="stays-ch", user_id=user.id)
        session.commit()
        _unfollow_everyone(session, "goes-ch")

        run_retention_cleanup(session)

    with Session(engine) as session:
        assert session.get(Channel, "goes-ch") is None
        assert session.get(Channel, "stays-ch") is not None
        assert _posts(session, "goes-ch") == []
        assert len(_posts(session, "stays-ch")) == 2


def test_collection_refuses_to_run_before_the_backfill() -> None:
    """The guard between an unpopulated follow table and a wiped corpus.

    An absent follow reads identically whether nobody follows the channel or
    nobody has written the row yet, and the two have opposite consequences.
    Retention fires ~60s after every boot, so on a database whose backfill has
    not run — native dev never invokes `prestart.sh`, and a restored
    pre-ticket-04 backup carries no marker — the unguarded version deletes
    every channel and every post a minute after startup. The operator's
    retention windows are no defence: collection ignores them.
    """
    with Session(engine) as session:
        _retention_off(session)
        add_test_channel(session, "premature-ch", name="premature-ch")
        _add_posts(session, "premature-ch", 3)
        session.commit()
        _unfollow_everyone(session, "premature-ch")
        _clear_backfill_marker(session)

        result = run_retention_cleanup(session)

        assert result["deletedChannels"] == 0

    with Session(engine) as session:
        assert session.get(Channel, "premature-ch") is not None
        assert len(_posts(session, "premature-ch")) == 3


def test_collection_spares_a_corpus_shared_with_a_surviving_channel() -> None:
    """`Channel.name` is neither unique nor immutable; the corpus is keyed by it.

    Two rows can name one handle — nothing stops it, and `apply_channel_fields`
    lets a caller rewrite `name`. Deleting posts by name would then destroy the
    still-followed row's whole corpus from a background job with nobody
    watching, which is exactly the failure that does not get noticed until it
    is far too late to undo.
    """
    with Session(engine) as session:
        _retention_off(session)
        user = create_random_user(session)
        add_test_channel(session, "twin-a", name="shared-handle")
        add_test_channel(session, "twin-b", name="shared-handle", user_id=user.id)
        _add_posts(session, "shared-handle", 4)
        ensure_follow(session, channel_id="twin-b", user_id=user.id)
        session.commit()
        _unfollow_everyone(session, "twin-a")

        run_retention_cleanup(session)

    with Session(engine) as session:
        assert session.get(Channel, "twin-a") is None
        assert session.get(Channel, "twin-b") is not None
        assert len(_posts(session, "shared-handle")) == 4


def test_collection_stops_at_the_pass_limit(monkeypatch) -> None:
    """One pass is bounded; the next hourly run takes the rest."""
    monkeypatch.setattr("app.jobs.retention.COLLECT_LIMIT", 2)
    with Session(engine) as session:
        _retention_off(session)
        for i in range(4):
            add_test_channel(session, f"capped-{i}", name=f"capped-{i}")
        session.commit()
        for i in range(4):
            _unfollow_everyone(session, f"capped-{i}")

        result = run_retention_cleanup(session)

        assert result["deletedChannels"] == 2
