"""The channel reference graph (CRG-01, ADR-019).

Two seams, as the spec names them. `references_for` is a pure transform over
one Post, so everything about *what counts as a Reference* is asserted there
with no session at all. `extract_batch` is the one DB entry point the sweep and
CRG-04's backfill both call unchanged, so everything about *dedup, deferral and
progress* is asserted through it rather than through the job that wraps it.

`write_references` is reached only through those two and is not tested
directly: pinning it would assert an implementation rather than a behaviour.

## Watched to fail

Per `CLAUDE.md`, each assertion was mutation-tested:

* re-create the constraint as a plain `UNIQUE` **in the database** → the
  re-run test fails on the mention, and only on the mention, which is the
  whole reason the clause is there. Swapping `constraint=` for
  `index_elements=` in the insert is *not* that mutation and stays green:
  both resolve to the same index, so the null semantics live in the
  migration and nowhere else
* fold `reply` into `link` in `references_for` → the reply-kind test fails and
  the parity test still passes, which is why both exist
* key the row on `source_channel` instead of `source_chat_id` → nothing fails,
  so identity is asserted through the constraint's columns directly
* mark deferred Posts as extracted → the deferral test fails
* drop the epoch from `_eligible` → the pre-existing-Post test fails
* drop the `_eligible` predicate and skip unwritable Posts in Python instead →
  the progress test fails, which is the failure mode that shape actually has
* let `extract_channel_post_from_href` skip the host check → the spoofed-host
  test fails
* clear `telegram_chat_id` in `requeue_probes` again → the recheck test fails
* drop `forwarded_from_post_id` from the forward `add` (CRG-03) → the exact-Post
  test fails and the pre-CRG-03 test stays green, which is the pair asserting
  that the missing id is a null rather than a withheld row
"""

from __future__ import annotations

import pathlib
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlmodel import Session, select

from app.core.db import engine
from app.models_tg import Channel, Post, PostReference
from app.services.channel_directory import record_probe_result, requeue_probes
from app.services.discover import post_references
from app.services.post_references import (
    ExtractionCounts,
    extract_batch,
    references_for,
)
from app.services.settings_registry import REFERENCE_GRAPH_KEY
from app.services.settings_store import put_global_setting
from app.services.telegram_web import extract_channel_post_from_href

SOURCE = "sourcechan"
SOURCE_CHAT_ID = 1001


def _post(
    post_id: int,
    *,
    channel_name: str = SOURCE,
    text: str = "",
    forwarded_from: str | None = None,
    forwarded_from_post_id: int | None = None,
    links: list[dict[str, Any]] | None = None,
    reply_to: dict[str, Any] | None = None,
    reply_to_post_id: int | None = None,
    timestamp: int | None = None,
    retrieved_at: int | None = None,
) -> Post:
    return Post(
        channel_name=channel_name,
        post_id=post_id,
        text=text,
        timestamp=timestamp if timestamp is not None else _ms(days_ago=1),
        retrieved_at=retrieved_at,
        forwarded_from=forwarded_from,
        forwarded_from_post_id=forwarded_from_post_id,
        links=links,
        reply_to=reply_to,
        reply_to_post_id=reply_to_post_id,
    )


def _ms(*, days_ago: float = 0) -> int:
    moment = datetime.now(UTC) - timedelta(days=days_ago)
    return int(moment.timestamp() * 1000)


def _seed(posts: list[Post], *, chat_id: int | None = SOURCE_CHAT_ID) -> None:
    with Session(engine) as session:
        session.add(Channel(id=SOURCE, name=SOURCE, telegram_chat_id=chat_id))
        for post in posts:
            session.add(post)
        session.commit()


def _seed_epoch(*, days_ago: float = 0) -> None:
    """Write the row CRG-01's migration writes.

    The per-test truncate clears `tg_app_settings`, so a test that cares about
    the grace floor has to put it back. Production gets it from the migration
    and never loses it.
    """
    with Session(engine) as session:
        put_global_setting(
            session, REFERENCE_GRAPH_KEY, {"epochMs": _ms(days_ago=days_ago)}
        )


def _probe(handle: str, *, chat_id: int) -> None:
    with Session(engine) as session:
        record_probe_result(
            session,
            handle,
            {
                "isTelegramPage": True,
                "kind": "channel",
                "telegramChatId": chat_id,
                "latestId": 3,
            },
        )


def _run(*, limit: int = 100, now: datetime | None = None) -> ExtractionCounts:
    with Session(engine) as session:
        return extract_batch(session, limit=limit, now=now)


def _stored() -> list[PostReference]:
    with Session(engine) as session:
        return list(
            session.exec(
                select(PostReference).order_by(
                    PostReference.target_handle, PostReference.kind
                )
            ).all()
        )


# --------------------------------------------------------------------------
# What counts as a Reference
# --------------------------------------------------------------------------


def test_a_post_naming_two_channels_makes_two_references() -> None:
    """The row count is the number of connections, not the number of Posts."""
    post = _post(1, text="see https://t.me/alphachan and https://t.me/betachan")

    refs = references_for(post, source_handle=SOURCE)

    assert {(r.target_handle, r.kind) for r in refs} == {
        ("alphachan", "link"),
        ("betachan", "link"),
    }


def test_forwarding_from_and_mentioning_one_channel_makes_two() -> None:
    """The kind is part of what a Reference is, so it is never collapsed."""
    post = _post(1, text="more from @alphachan", forwarded_from="alphachan")

    refs = references_for(post, source_handle=SOURCE)

    assert {r.kind for r in refs} == {"forward", "mention"}
    assert {r.target_handle for r in refs} == {"alphachan"}


def test_a_same_channel_reply_makes_no_reference() -> None:
    """The graph holds connections between Channels, so no self-loops."""
    post = _post(
        1,
        reply_to={"channel": SOURCE, "url": f"https://t.me/{SOURCE}/7"},
        reply_to_post_id=7,
    )

    assert references_for(post, source_handle=SOURCE) == []


def test_a_cross_channel_reply_is_its_own_kind() -> None:
    """`reply` is the fourth kind, where `SignalKind` folds it into `link`."""
    post = _post(
        1,
        reply_to={"channel": "alphachan", "url": "https://t.me/alphachan/7"},
        reply_to_post_id=7,
    )

    refs = references_for(post, source_handle=SOURCE)

    assert [(r.kind, r.target_post_id) for r in refs] == [("reply", 7)]


def test_the_discover_signal_vocabulary_is_unchanged() -> None:
    """Mutation: add "reply" to `SIGNAL_KINDS`.

    The graph gets the fourth kind; Discovery's counters do not, or every
    report's `scopeCounts` changes shape under a feature that claims to read
    nothing.
    """
    from app.services.discover import SIGNAL_KINDS

    assert SIGNAL_KINDS == ("forward", "mention", "link")


def test_a_forward_carries_the_exact_post_it_came_from() -> None:
    """CRG-03's column, parsed at scrape time out of the attribution href."""
    post = _post(1, forwarded_from="alphachan", forwarded_from_post_id=4271)

    refs = references_for(post, source_handle=SOURCE)

    assert [(r.kind, r.target_handle, r.target_post_id) for r in refs] == [
        ("forward", "alphachan", 4271)
    ]


def test_a_forward_scraped_before_crg_03_names_the_channel_and_no_post() -> None:
    """There is no backfill and there cannot be one — the href was never stored.

    The Reference is still written. A forward whose source Post is unknown is a
    real edge with a missing detail, not a row to withhold.
    """
    post = _post(1, forwarded_from="alphachan")

    refs = references_for(post, source_handle=SOURCE)

    assert [(r.kind, r.target_handle, r.target_post_id) for r in refs] == [
        ("forward", "alphachan", None)
    ]


def test_a_link_carries_the_exact_post_it_names() -> None:
    """The id the Discover parser discards survives on the stored href."""
    post = _post(
        1,
        links=[{"url": "https://t.me/alphachan/42", "channel": "alphachan"}],
    )

    refs = references_for(post, source_handle=SOURCE)

    assert [(r.target_handle, r.target_post_id) for r in refs] == [("alphachan", 42)]


def test_two_links_to_two_posts_of_one_channel_are_two_references() -> None:
    """`target_post_id` is part of identity, so these do not collapse."""
    post = _post(
        1,
        links=[
            {"url": "https://t.me/alphachan/42", "channel": "alphachan"},
            {"url": "https://t.me/alphachan/43", "channel": "alphachan"},
        ],
    )

    refs = references_for(post, source_handle=SOURCE)

    assert sorted(r.target_post_id for r in refs if r.target_post_id) == [42, 43]


def test_a_mention_has_no_target_post() -> None:
    """Plain text carries no url, so there is nothing to recover."""
    post = _post(1, text="read @alphachan")

    refs = references_for(post, source_handle=SOURCE)

    assert [(r.kind, r.target_post_id) for r in refs] == [("mention", None)]


def test_the_two_extractors_agree_on_which_handles_a_post_names() -> None:
    """Mutation: drop the reply leg, or the links blob, from `references_for`.

    The graph and every Discovery report must mean the same thing by "this Post
    references @foo". They are two implementations over shared primitives, so
    nothing but this stops them drifting. The *kinds* differ on purpose, which
    is why the assertion is on the handle sets alone.
    """
    posts = [
        _post(
            1,
            text="see https://t.me/alphachan and @betachan",
            forwarded_from="gammachan",
        ),
        _post(2, links=[{"url": "https://t.me/deltachan/9", "channel": "deltachan"}]),
        _post(
            3,
            reply_to={"channel": "epsilon", "url": "https://t.me/epsilon/3"},
            reply_to_post_id=3,
        ),
        _post(4, text="nothing here at all"),
        _post(5, text=f"self @{SOURCE}", forwarded_from=SOURCE),
    ]

    for post in posts:
        graph = {r.target_handle for r in references_for(post, source_handle=SOURCE)}
        discover = set(post_references(post))
        assert graph == discover, f"post {post.post_id}"


# --------------------------------------------------------------------------
# The url helper
# --------------------------------------------------------------------------


def test_the_href_helper_returns_the_channel_and_the_post() -> None:
    assert extract_channel_post_from_href("https://t.me/alphachan/42") == (
        "alphachan",
        42,
    )
    assert extract_channel_post_from_href("https://t.me/alphachan") == (
        "alphachan",
        None,
    )
    assert extract_channel_post_from_href("https://t.me/s/alphachan/42") == (
        "alphachan",
        42,
    )


def test_the_href_helper_rejects_a_spoofed_host() -> None:
    """Mutation: search the string for the domain instead of parsing the host.

    The sibling helper states this case in its docstring because it is the one
    that looks harmless: a path segment is not a host.
    """
    # A handle long enough to pass `is_channel_handle`: with a short one the
    # assertion holds even when the host check is gone, which is how this test
    # passes for the wrong reason.
    assert (
        extract_channel_post_from_href("https://evil.example.com/t.me/alphachan/123")
        is None
    )


def test_the_href_helper_refuses_a_reserved_path_and_its_id_together() -> None:
    """A Post id is worth nothing attached to something nobody can follow."""
    assert extract_channel_post_from_href("https://t.me/joinchat/AAAA/12") is None
    assert extract_channel_post_from_href("https://t.me/c/1234/12") is None


# --------------------------------------------------------------------------
# The walk
# --------------------------------------------------------------------------


def test_the_walk_writes_references_and_marks_the_posts() -> None:
    _seed([_post(1, text="see https://t.me/alphachan/42")])

    counts = _run()

    assert counts.written == 1
    assert counts.scanned == 1
    stored = _stored()
    assert [(r.source_channel, r.source_chat_id, r.source_post_id) for r in stored] == [
        (SOURCE, SOURCE_CHAT_ID, 1)
    ]
    with Session(engine) as session:
        assert session.exec(select(Post.references_extracted)).all() == [True]


def test_a_second_run_writes_nothing_even_for_a_mention() -> None:
    """Mutation: plain `UNIQUE` instead of `NULLS NOT DISTINCT`.

    A mention's `target_post_id` is NULL, and under Postgres's default null
    semantics two identical mention rows never collide — so the constraint
    would cover the minority of the table and duplicate the majority on every
    re-run of CRG-04's backfill. The link is here as the control: it has an id,
    so it dedups either way, and a broken constraint would leave this test
    passing on that row alone.
    """
    _seed(
        [
            _post(1, text="read @alphachan and https://t.me/betachan/9"),
        ]
    )
    first = _run()
    assert first.written == 2

    # Re-present the same Post to the walk, exactly as a backfill re-run does.
    with Session(engine) as session:
        post = session.exec(select(Post)).one()
        post.references_extracted = False
        session.add(post)
        session.commit()

    second = _run()

    assert second.written == 0
    assert len(_stored()) == 2
    assert sum(1 for r in _stored() if r.kind == "mention") == 1


def test_a_post_whose_channel_has_no_chat_id_is_deferred() -> None:
    """Mutation: mark it extracted anyway.

    Deferral is what keeps an incomplete graph recoverable. A Post marked with
    no rows written is a Reference lost for good, and silently, because nothing
    ever reads that Post again.
    """
    _seed([_post(1, text="read @alphachan")], chat_id=None)

    counts = _run()

    assert counts.scanned == 0
    assert counts.written == 0
    assert counts.deferring_channels == 1
    assert _stored() == []
    with Session(engine) as session:
        assert session.exec(select(Post.references_extracted)).all() == [False]


def test_a_deferred_post_is_written_once_the_chat_id_lands() -> None:
    _seed([_post(1, text="read @alphachan")], chat_id=None)
    assert _run().written == 0

    with Session(engine) as session:
        channel = session.exec(select(Channel)).one()
        channel.telegram_chat_id = SOURCE_CHAT_ID
        session.add(channel)
        session.commit()

    assert _run().written == 1


def test_past_the_grace_the_post_is_skipped_for_good() -> None:
    """A Channel that never yields a chat id must not accumulate work."""
    _seed_epoch(days_ago=60)
    _seed(
        [_post(1, text="read @alphachan", retrieved_at=_ms(days_ago=30))],
        chat_id=None,
    )

    counts = _run()

    assert counts.skipped == 1
    assert counts.written == 0
    assert _stored() == []
    with Session(engine) as session:
        assert session.exec(select(Post.references_extracted)).all() == [True]


def test_a_pre_existing_post_gets_its_grace_from_the_epoch() -> None:
    """Mutation: drop the epoch from `_eligible`.

    Every Post already in the corpus is older than the window, so without the
    floor the grace expires the instant the feature deploys — for exactly the
    population it exists to protect. The epoch row is written by this effort's
    migration, so "now" is inside the window by construction.
    """
    _seed_epoch()
    _seed(
        [
            _post(
                1,
                text="read @alphachan",
                timestamp=_ms(days_ago=900),
                retrieved_at=_ms(days_ago=900),
            )
        ],
        chat_id=None,
    )

    counts = _run()

    assert counts.skipped == 0
    with Session(engine) as session:
        assert session.exec(select(Post.references_extracted)).all() == [False]


def test_the_walk_makes_progress_when_most_posts_are_deferred() -> None:
    """Mutation: select without `_eligible` and skip unwritable Posts in Python.

    The walk is newest-first with no cursor, so a page made entirely of
    unwritable Posts would be re-read on every tick for ever and the writable
    ones behind it would never be reached. Deferral therefore has to mean "not
    selected", not "selected and left".
    """
    with Session(engine) as session:
        session.add(Channel(id="mute", name="mute", telegram_chat_id=None))
        session.add(Channel(id=SOURCE, name=SOURCE, telegram_chat_id=SOURCE_CHAT_ID))
        for post_id in range(1, 6):
            session.add(
                _post(
                    post_id,
                    channel_name="mute",
                    text="read @alphachan",
                    timestamp=_ms(days_ago=0),
                )
            )
        session.add(
            _post(99, text="read @betachan", timestamp=_ms(days_ago=2)),
        )
        session.commit()

    counts = _run(limit=3)

    assert counts.written == 1
    assert [r.target_handle for r in _stored()] == ["betachan"]


def test_the_target_chat_id_is_filled_only_when_the_directory_knows_it() -> None:
    """No second write path ever comes back for the rest; a read joins instead."""
    _probe("alphachan", chat_id=555)
    _seed([_post(1, text="read @alphachan and @betachan")])

    _run()

    by_handle = {r.target_handle: r.target_chat_id for r in _stored()}
    assert by_handle == {"alphachan": 555, "betachan": None}


def test_a_followed_channel_target_gets_its_chat_id() -> None:
    """Mutation: read only `tg_channel_directory` in `_target_chat_ids`.

    `directory_harvest` filters followed handles out before enqueueing, so a
    Channel this deployment follows usually has no Directory row at all — which
    makes the Directory the wrong place to look for exactly the targets we know
    best. Reading only it left `target_chat_id` NULL forever on those edges,
    and the documented fallback ("a read joins the Directory") cannot recover
    a row that is not there.
    """
    with Session(engine) as session:
        session.add(Channel(id="alphachan", name="alphachan", telegram_chat_id=2002))
        session.commit()
    _seed([_post(1, text="read @alphachan")])

    _run()

    assert [(r.target_handle, r.target_chat_id) for r in _stored()] == [
        ("alphachan", 2002)
    ]


def test_a_name_with_two_chat_ids_writes_nothing() -> None:
    """Mutation: `EXISTS` instead of `= 1`, or drop the `HAVING`.

    `Channel.name` is not unique — `channels.py` carries a detector for the
    collision — so picking whichever row came back first would stamp one chat's
    References with another chat's identity. That is the merged node the whole
    keying decision exists to prevent, and it is unrecoverable once written.
    """
    with Session(engine) as session:
        session.add(Channel(id="one", name=SOURCE, telegram_chat_id=111))
        session.add(Channel(id="two", name=SOURCE, telegram_chat_id=222))
        session.add(_post(1, text="read @alphachan"))
        session.commit()

    counts = _run()

    assert counts.written == 0
    assert counts.skipped == 0
    assert _stored() == []


def test_a_target_name_with_two_chat_ids_is_left_unresolved() -> None:
    """Mutation: drop the `HAVING count(*) = 1` from the chat-id lookup.

    The source side is already covered by the walk's predicate, so the `HAVING`
    looks like belt to that's braces — but the **target** side has no predicate
    in front of it, and stamping an arbitrary one of two ids is the merged node
    again, just at the other end of the edge. Nothing else stops it.
    """
    with Session(engine) as session:
        session.add(Channel(id="t1", name="alphachan", telegram_chat_id=111))
        session.add(Channel(id="t2", name="alphachan", telegram_chat_id=222))
        session.commit()
    _seed([_post(1, text="read @alphachan")])

    _run()

    assert [(r.target_handle, r.target_chat_id) for r in _stored()] == [
        ("alphachan", None)
    ]


def test_the_deferring_count_falls_to_zero_once_nothing_is_waiting() -> None:
    """Mutation: drop the `EXISTS` and count every chat-id-less Channel.

    The number is meant to be a list of Channels to go and look at. Counting
    Channels with nothing pending keeps reporting a gap that the grace has
    already swept away.
    """
    _seed_epoch(days_ago=60)
    _seed(
        [_post(1, text="read @alphachan", retrieved_at=_ms(days_ago=30))],
        chat_id=None,
    )
    assert _run().deferring_channels == 0  # the Post was swept in this same run

    _seed_epoch()
    with Session(engine) as session:
        session.add(_post(2, text="read @alphachan", retrieved_at=_ms(days_ago=1)))
        session.commit()

    assert _run().deferring_channels == 1


def test_a_hand_edited_epoch_does_not_stop_the_walk() -> None:
    """Mutation: `int(stored)` on any type.

    `PUT /data/settings/{key}` writes an arbitrary JSON body to any global key,
    so a string here is reachable by an Admin. This runs every tick, and until
    the sweep caught it an exception took the Directory harvest down with it.
    """
    with Session(engine) as session:
        put_global_setting(session, REFERENCE_GRAPH_KEY, {"epochMs": "soon"})
    _seed([_post(1, text="read @alphachan")])

    assert _run().written == 1


# --------------------------------------------------------------------------
# What must not change
# --------------------------------------------------------------------------


def test_a_recheck_keeps_the_remembered_chat_id() -> None:
    """Mutation: restore `row.telegram_chat_id = None` in `requeue_probes`.

    The chat id is immutable, which `_apply_page_metadata` already argues; this
    line used to contradict it. It became load-bearing when References started
    keying on the value, because a recheck then blinded the graph for that
    entry until the next probe returned.
    """
    _probe("alphachan", chat_id=777)

    with Session(engine) as session:
        requeue_probes(session, ["alphachan"])

    from app.models_tg import DirectoryEntry

    with Session(engine) as session:
        row = session.get(DirectoryEntry, "alphachan")
        assert row is not None
        assert row.status == "unknown"
        assert row.telegram_chat_id == 777


def test_retention_cannot_reach_the_graph() -> None:
    """Mutation: add `PostReference` to retention's sweeps.

    "Never pruned" is what makes a Reference worth more than the Post it came
    from: the `t.me` permalink still resolves against Telegram after retention
    deletes our copy. Retention works from explicit model references, so this
    asserts the table is on neither inventory rather than trusting nobody adds
    it — the table is small, so a well-meant "prune everything old" would find
    no resistance and no symptom until somebody asked about last year.
    """
    from app.jobs import retention

    source = pathlib.Path(retention.__file__).read_text()
    assert "PostReference" not in source
    assert "tg_post_references" not in source
