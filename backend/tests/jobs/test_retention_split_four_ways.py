"""Retention deletes on four different windows, by what the rows are (ticket 20).

One person's settings must never delete another person's evidence. Before this
ticket every sweep ran on one blob of settings, narrowed by `user_id ==
operator OR IS NULL` — a filter that looked like scoping and was not. It
protected nobody once a second account existed, and `postRetentionDays` was a
way for any account to destroy every account's Posts on the next sweep.

The four windows, and why each is where it is:

* the **corpus** (Posts and their embeddings, translations, sync state) on the
  deployment's `postRetentionDays`, with no owner filter, because one scrape
  serves every follower and there is no account whose rows these are;
* **personal logs** (publish, LLM, embedding) on their *owner's*
  `logRetentionDays`;
* **shared and ownerless logs** (sync, network, and any row a background job
  wrote) on the deployment's `sharedLogRetentionDays`, because no per-account
  window can reach them;
* **Discover reports** on their own account's age and count caps.

## Watched to fail

Per `CLAUDE.md`, each assertion here was mutation-tested:

* put the post sweep back on `user_id == operator OR IS NULL` → the corpus test
  fails
* sweep personal logs on one deployment-wide window → the two-windows test
  fails
* sweep personal logs with no owner filter at all → the foreign-rows test fails
* drop `delete_unowned_logs_before` → the ownerless test fails
* discard the payload count the shared sweep returns → the payload-count test
  fails
* sweep sync logs on a per-account window → the telemetry test fails
* prune reports across the whole table → both report tests fail
* let the facade write a policy field for a non-Admin → see
  `tests/api/test_admin_route_gating.py`

`test_an_empty_owner_set_deletes_nothing` is the exception and says so in its
own docstring: it survives its mutation, because SQLAlchemy renders an empty
`IN` as false whether or not the early return is there.
"""

from __future__ import annotations

import time
import uuid

from sqlmodel import Session, select

from app.core.db import engine
from app.jobs.retention import run_retention_cleanup
from app.jobs.settings import save_settings_section
from app.models_tg import (
    DiscoverReport,
    EmbeddingLog,
    LLMLog,
    NetworkLog,
    Post,
    PostEmbedding,
    PostTranslation,
    PublishLog,
    SyncLog,
    SyncLogPayload,
)
from app.services.logs import (
    PERSONAL_LOG_TYPES,
    SHARED_LOG_TYPES,
    delete_owned_logs_before,
)
from tests.utils.user import create_random_user

DAY_MS = 24 * 60 * 60 * 1000


def _now() -> int:
    return int(time.time() * 1000)


def _policy(session: Session, **fields: int) -> None:
    """Set the deployment half, leaving anything unnamed disabled."""
    save_settings_section(
        session,
        "retention",
        {
            "postRetentionDays": 0,
            "sharedLogRetentionDays": 0,
            "payloadRetentionDays": 0,
            **fields,
        },
    )


def _prefs(session: Session, user_id: uuid.UUID, **fields: int) -> None:
    """Set one account's half, leaving anything unnamed disabled."""
    save_settings_section(
        session,
        "retention",
        {
            "logRetentionDays": 0,
            "reportRetentionDays": 0,
            "reportRetentionMax": 0,
            **fields,
        },
        user_id=user_id,
    )


def _publish(log_id: str, *, timestamp: int, user_id: uuid.UUID | None) -> PublishLog:
    return PublishLog(
        id=log_id,
        user_id=user_id,
        summary_id="s",
        bot_id="b",
        bot_name="bot",
        chat_id="c",
        chat_name="chat",
        status="success",
        timestamp=timestamp,
    )


def _llm(log_id: str, *, timestamp: int, user_id: uuid.UUID | None) -> LLMLog:
    return LLMLog(
        id=log_id,
        user_id=user_id,
        model="m",
        prompt="p",
        response="r",
        status="success",
        timestamp=timestamp,
    )


def _embedding(
    log_id: str, *, timestamp: int, user_id: uuid.UUID | None
) -> EmbeddingLog:
    return EmbeddingLog(
        id=log_id, user_id=user_id, status="success", timestamp=timestamp
    )


def _network(log_id: str, *, timestamp: int, user_id: uuid.UUID | None) -> NetworkLog:
    return NetworkLog(
        id=log_id,
        user_id=user_id,
        url="https://t.me/x",
        method="GET",
        status="success",
        timestamp=timestamp,
    )


def _account(session: Session) -> uuid.UUID:
    """An account with every window of its own disabled.

    Explicit rather than left at defaults: an account created by another test's
    fixture would otherwise sweep on the stock 30 days and delete rows this
    file seeded, which is a failure that depends on test ordering.
    """
    user_id = create_random_user(session).id
    _prefs(session, user_id)
    return user_id


# --------------------------------------------------------------------------
# The corpus runs on one deployment window, for everybody
# --------------------------------------------------------------------------


def test_the_post_sweep_ignores_who_scraped_the_row() -> None:
    """`Post.user_id` is a stamp, not an owner, so it decides nothing.

    Filtering on it deleted the first follower's rows and left the second
    follower's identical ones behind — for the same Channel, the same Post, in
    the same table.
    """
    now = _now()
    old = now - 40 * DAY_MS
    with Session(engine) as session:
        mine = _account(session)
        theirs = _account(session)
        _policy(session, postRetentionDays=30)
        for post_id, stamp in ((1, mine), (2, theirs), (3, None)):
            session.add(
                Post(
                    channel_name="corpus-ch",
                    post_id=post_id,
                    text="old",
                    timestamp=old,
                    user_id=stamp,
                )
            )
        session.add(
            Post(
                channel_name="corpus-ch",
                post_id=4,
                text="fresh",
                timestamp=now,
                user_id=theirs,
            )
        )
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        surviving = {
            row.post_id
            for row in check.exec(
                select(Post).where(Post.channel_name == "corpus-ch")
            ).all()
        }
    assert surviving == {4}, (
        "the corpus sweep is deployment policy: an expired Post goes whoever "
        "happened to scrape it first"
    )


def test_embeddings_and_translations_go_with_their_post() -> None:
    """They are keyed to the Post, so the corpus window governs them too."""
    now = _now()
    old = now - 40 * DAY_MS
    with Session(engine) as session:
        theirs = _account(session)
        _policy(session, postRetentionDays=30)
        session.add(
            Post(
                channel_name="dep-ch",
                post_id=1,
                text="old",
                timestamp=old,
                user_id=theirs,
            )
        )
        session.add(
            PostEmbedding(
                id="dep-emb", channel_name="dep-ch", post_id=1, model="m", dim=1
            )
        )
        session.add(
            PostTranslation(
                id="dep-tr",
                channel_name="dep-ch",
                post_id=1,
                language="en",
                translated_text="t",
            )
        )
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert (
            check.exec(
                select(PostEmbedding).where(PostEmbedding.channel_name == "dep-ch")
            ).first()
            is None
        )
        assert (
            check.exec(
                select(PostTranslation).where(PostTranslation.channel_name == "dep-ch")
            ).first()
            is None
        )


# --------------------------------------------------------------------------
# Personal logs run on their owner's window
# --------------------------------------------------------------------------


def test_two_accounts_sweep_their_logs_on_their_own_windows() -> None:
    """The whole ticket in one test.

    A short window is a choice about your own evidence. Before the split there
    was one number, so whoever set it last decided for everybody.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        eager = _account(session)
        patient = _account(session)
        _policy(session)
        _prefs(session, eager, logRetentionDays=7)
        _prefs(session, patient, logRetentionDays=90)

        session.add(_publish("eager-old", timestamp=old, user_id=eager))
        session.add(_publish("patient-old", timestamp=old, user_id=patient))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(PublishLog, "eager-old") is None, (
            "the seven-day account's own log survived its own window"
        )
        assert check.get(PublishLog, "patient-old") is not None, (
            "one account's short window deleted another account's evidence"
        )


def test_a_short_window_reaches_all_three_personal_families() -> None:
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        me = _account(session)
        _policy(session)
        _prefs(session, me, logRetentionDays=7)
        session.add(_publish("p-old", timestamp=old, user_id=me))
        session.add(_llm("l-old", timestamp=old, user_id=me))
        session.add(_embedding("e-old", timestamp=old, user_id=me))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(PublishLog, "p-old") is None
        assert check.get(LLMLog, "l-old") is None
        assert check.get(EmbeddingLog, "e-old") is None


def test_an_empty_owner_set_deletes_nothing() -> None:
    """Nobody chose this window, so nothing is swept — not everything.

    This one pins behaviour rather than a branch, and says so: removing the
    early return in `delete_owned_logs_before` leaves it green, because
    SQLAlchemy already renders an empty `IN` as a false expression. It is here
    because the opposite reading — an empty owner set meaning "no filter" — is
    the shape that would delete every account's logs, and it deserves an
    assertion however the code happens to achieve it today.
    """
    now = _now()
    with Session(engine) as session:
        me = _account(session)
        session.add(_publish("untouched", timestamp=now - 99 * DAY_MS, user_id=me))
        session.commit()

        swept = delete_owned_logs_before(
            session, now, log_types=["publish"], user_ids=[]
        )

    assert swept.counts["publish"] == 0
    assert swept.payloads == 0
    with Session(engine) as check:
        assert check.get(PublishLog, "untouched") is not None


# --------------------------------------------------------------------------
# Shared and ownerless logs run on the deployment window
# --------------------------------------------------------------------------


def test_sync_logs_are_telemetry_and_no_account_window_reaches_them() -> None:
    """Ticket 19 made a sync log a fact about a Channel, not about a person.

    So the account whose window is one day cannot delete it, and the
    deployment's window can.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        me = _account(session)
        _policy(session)
        _prefs(session, me, logRetentionDays=1)
        session.add(
            SyncLog(id="telemetry", channel_name="c", status="success", timestamp=old)
        )
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(SyncLog, "telemetry") is not None, (
            "a personal log window deleted Channel telemetry"
        )

    with Session(engine) as session:
        _policy(session, sharedLogRetentionDays=7)
        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(SyncLog, "telemetry") is None, (
            "the deployment window did not reach Channel telemetry"
        )


def test_the_shared_sweep_reports_the_payloads_it_removed() -> None:
    """A payload deleted with its parent still has to be counted.

    `tg_sync_log_payloads` has no FK to cascade from, so the sweep takes the
    bodies along with the log row — and the first cut of the four-way split
    dropped that number on the floor, so `deletedPayloads` reported only what
    the *payload* window removed. The rows were gone either way; the operator's
    only view of how much disk came back was wrong.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        _account(session)
        # Payload window off, so anything counted here came from the log sweep.
        _policy(session, sharedLogRetentionDays=7)
        session.add(
            SyncLog(id="with-body", channel_name="c", status="success", timestamp=old)
        )
        session.add(
            SyncLogPayload(
                sync_log_id="with-body",
                channel_name="c",
                timestamp=old,
                full_response={"blob": "x" * 100},
            )
        )
        session.commit()

        result = run_retention_cleanup(session)

    assert result["deletedPayloads"] >= 1, (
        "the log sweep removed a payload and reported none"
    )
    with Session(engine) as check:
        assert check.get(SyncLogPayload, "with-body") is None


def test_network_logs_run_on_the_deployment_window() -> None:
    """Proxy behaviour belongs to the deployment, and the reads are Admin-only.

    The row carries the id of whoever triggered the request (decision 23), and
    that stamp must not put it on their window — this is the one family where a
    `user_id` is present and still decides nothing. So the account's own window
    runs first and leaves it, and only the deployment's reaches it.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        me = _account(session)
        _policy(session)
        _prefs(session, me, logRetentionDays=1)
        session.add(_network("proxy-old", timestamp=old, user_id=me))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(NetworkLog, "proxy-old") is not None, (
            "a personal log window deleted a network log — its `user_id` is "
            "who triggered the request, not who owns the row"
        )

    with Session(engine) as session:
        _policy(session, sharedLogRetentionDays=7)
        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(NetworkLog, "proxy-old") is None


def test_a_log_nobody_owns_is_still_swept() -> None:
    """`user_id` is nullable on all five tables and jobs write rows without one.

    Once the personal families moved to per-account windows those rows were
    reachable by no window at all — a slow leak that looks exactly like
    retention working.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        me = _account(session)
        _policy(session, sharedLogRetentionDays=7)
        _prefs(session, me, logRetentionDays=0)
        session.add(_llm("orphan", timestamp=old, user_id=None))
        session.add(_publish("orphan-p", timestamp=old, user_id=None))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(LLMLog, "orphan") is None
        assert check.get(PublishLog, "orphan-p") is None


def test_the_deployment_window_does_not_reach_an_owned_personal_log() -> None:
    """The other direction: `sharedLogRetentionDays` is not a master window.

    If it swept owned rows too, an Admin shortening it would delete everyone's
    logs — the same defect from the other side.
    """
    now = _now()
    old = now - 10 * DAY_MS
    with Session(engine) as session:
        me = _account(session)
        _policy(session, sharedLogRetentionDays=1)
        _prefs(session, me, logRetentionDays=90)
        session.add(_llm("mine-kept", timestamp=old, user_id=me))
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(LLMLog, "mine-kept") is not None


def test_the_two_log_groups_partition_the_five_families() -> None:
    """Derived sets, so a family cannot fall out of both or into both.

    A family in neither is swept by nobody; a family in both is swept twice on
    two different windows, and which one wins depends on ordering.
    """
    from app.services.logs import LOG_MODELS

    assert SHARED_LOG_TYPES | PERSONAL_LOG_TYPES == set(LOG_MODELS)
    assert not SHARED_LOG_TYPES & PERSONAL_LOG_TYPES


# --------------------------------------------------------------------------
# Reports run on their own account's caps
# --------------------------------------------------------------------------


def test_report_pruning_is_per_account_end_to_end() -> None:
    """Through `run_retention_cleanup`, not just the helper.

    The helper being per-account is worth nothing if the job calls it once with
    somebody's caps and lets it loose on the table.
    """
    now = _now()
    with Session(engine) as session:
        strict = _account(session)
        keeper = _account(session)
        _policy(session)
        _prefs(session, strict, reportRetentionDays=7)
        _prefs(session, keeper, reportRetentionDays=0)

        for report_id, owner in (("strict-old", strict), ("keeper-old", keeper)):
            session.add(
                DiscoverReport(
                    id=report_id,
                    user_id=owner,
                    channels=["c"],
                    candidates=[],
                    timestamp=now - 30 * DAY_MS,
                )
            )
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(DiscoverReport, "strict-old") is None
        assert check.get(DiscoverReport, "keeper-old") is not None, (
            "one account's report window deleted another account's report"
        )


def test_one_count_cap_does_not_prune_another_accounts_newest() -> None:
    """The sharper edge of the two caps.

    Applied across the table, an account generating a burst pushed every other
    account's newest report past the offset.
    """
    now = _now()
    with Session(engine) as session:
        busy = _account(session)
        quiet = _account(session)
        _policy(session)
        _prefs(session, busy, reportRetentionMax=1)
        _prefs(session, quiet, reportRetentionMax=0)

        for i in range(3):
            session.add(
                DiscoverReport(
                    id=f"busy-{i}",
                    user_id=busy,
                    channels=["c"],
                    candidates=[],
                    timestamp=now - i * 1000,
                )
            )
        session.add(
            DiscoverReport(
                id="quiet-only",
                user_id=quiet,
                channels=["c"],
                candidates=[],
                timestamp=now - 99 * DAY_MS,
            )
        )
        session.commit()

        run_retention_cleanup(session)

    with Session(engine) as check:
        assert check.get(DiscoverReport, "busy-0") is not None
        assert check.get(DiscoverReport, "busy-1") is None
        assert check.get(DiscoverReport, "quiet-only") is not None, (
            "a busy account's count cap reached a quiet account's only report"
        )


# --------------------------------------------------------------------------
# The two sweeps that are not windows at all
# --------------------------------------------------------------------------


def test_asset_pruning_stays_deployment_wide() -> None:
    """Avatars and thumbs live on the deployment's disk, so they have no owner.

    A per-account cache budget would be a number with no disk behind it. This
    asserts the run reports both sweeps regardless of any account's windows —
    the counts are the only observable the job returns for them.
    """
    with Session(engine) as session:
        me = _account(session)
        _policy(session)
        _prefs(session, me)

        result = run_retention_cleanup(session)

    assert "deletedPhotos" in result
    assert "deletedChannels" in result
