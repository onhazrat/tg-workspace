"""Citation pairs and counts stay equal to the References they summarise (DIR-05).

ADR-028: `tg_citation_pairs` holds one row per distinct citing and cited
Channel with its Reference count, `tg_citation_counts` per handle how many
distinct Channels cite it and it cites. `post_references.write_references`
maintains both in the transaction that inserts the References, from the rows
it reports as new; `post_references.fill_citations` builds both from the
References already stored. The guard here is the one the ADR asks for: after
either runs, what is stored equals a fresh aggregation over the References.

## Watched to fail

Each mutation was applied alone and this module went red:

* skip the count update in `write_references` -> the first writer case
* raise the counts by a new pair's References rather than by one -> the
  two-ways case (a forward and a mention would count their target twice)
* raise the counts for every pair written, existing ones too -> the re-cited
  case
* drop the Reference count increment for an existing pair -> the re-cited case
* make the first fill add rather than overwrite -> the fill re-run case
* an `UPDATE tg_citation_counts` string in `directory_reads.py` -> the
  sole-writer case
* let the mention-shadow migration's `EXISTS` match any kind -> the shadow
  case (a link with no mention beside it goes too)
* drop `target_post_id IS NULL` from it -> the shadow case (the link to one
  exact Post goes too)
* drop the pair `UPDATE` from it -> the shadow case (pairs out of step)
"""

from __future__ import annotations

import pathlib
import re
from collections import Counter

from sqlalchemy import text
from sqlmodel import Session, delete

from app.core.db import engine
from app.models_tg import Channel, CitationCount, CitationPair, Post
from app.services.channel_directory import record_probe_result
from app.services.post_references import (
    Reference,
    SourcedReferences,
    extract_batch,
    fill_citations,
    write_references,
)

Pairs = dict[tuple[str, str], int]
Counts = dict[str, tuple[int, int]]


def _fresh(session: Session) -> tuple[Pairs, Counts]:
    """What the two tables should hold, aggregated from the References."""
    pairs = {
        (str(s), str(t)): int(n)
        for s, t, n in session.execute(
            text(
                "SELECT source_channel, target_handle, count(*) "
                "FROM tg_post_references GROUP BY 1, 2"
            )
        ).all()
    }
    cited_by = Counter(t for _, t in pairs)
    cites = Counter(s for s, _ in pairs)
    counts = {h: (cited_by[h], cites[h]) for h in set(cited_by) | set(cites)}
    return pairs, counts


def _stored(session: Session) -> tuple[Pairs, Counts]:
    pairs = {
        (p.citing_handle, p.cited_handle): p.reference_count
        for p in session.query(CitationPair).all()
    }
    counts = {
        c.handle: (c.cited_by, c.cites) for c in session.query(CitationCount).all()
    }
    return pairs, counts


def _assert_in_step() -> None:
    with Session(engine) as session:
        assert _stored(session) == _fresh(session)


def _write(*refs: tuple[str, int, str, str]) -> None:
    """Write References as (source, post id, target, kind), one call."""
    with Session(engine) as session:
        write_references(
            session,
            [
                SourcedReferences(
                    source_chat_id=abs(hash(source)) % 10**9,
                    source_channel=source,
                    source_post_id=post_id,
                    timestamp=1_700_000_000_000 + post_id,
                    references=[Reference(target_handle=target, kind=kind)],
                )
                for source, post_id, target, kind in refs
            ],
            target_chat_ids={},
        )
        session.commit()


def test_a_new_pair_raises_both_counts_by_one() -> None:
    _write(("aa", 1, "bb", "mention"), ("aa", 2, "cc", "forward"))
    _assert_in_step()
    with Session(engine) as session:
        assert _stored(session)[1] == {"aa": (0, 2), "bb": (1, 0), "cc": (1, 0)}


def test_one_post_citing_a_channel_two_ways_is_one_pair() -> None:
    """A Post that forwards from and mentions one Channel: two References."""
    _write(("aa", 1, "bb", "mention"), ("aa", 1, "bb", "forward"))
    _assert_in_step()
    with Session(engine) as session:
        pairs, counts = _stored(session)
    assert pairs == {("aa", "bb"): 2}
    assert counts["bb"] == (1, 0)


def test_a_pair_cited_again_only_gains_references() -> None:
    _write(("aa", 1, "bb", "mention"), ("cc", 1, "bb", "mention"))
    _write(("aa", 2, "bb", "forward"), ("aa", 3, "bb", "link"))
    _assert_in_step()
    with Session(engine) as session:
        pairs, counts = _stored(session)
    assert pairs[("aa", "bb")] == 3
    assert counts["bb"] == (2, 0)


def test_a_re_run_that_writes_no_reference_changes_nothing() -> None:
    refs = (("aa", 1, "bb", "mention"), ("bb", 1, "aa", "reply"))
    _write(*refs)
    _write(*refs)
    _assert_in_step()


def test_two_writes_in_one_transaction_stay_in_step() -> None:
    with Session(engine) as session:
        for post_id in (1, 2):
            write_references(
                session,
                [
                    SourcedReferences(
                        source_chat_id=1,
                        source_channel="aa",
                        source_post_id=post_id,
                        timestamp=post_id,
                        references=[Reference(target_handle="bb", kind="forward")],
                    )
                ],
                target_chat_ids={},
            )
        session.commit()
    _assert_in_step()


def test_the_walk_and_a_probe_keep_the_counts_too() -> None:
    """Both callers of the writer: the Post walk and a probe's samples."""
    with Session(engine) as session:
        session.add(Channel(id="walker_chan", name="walker_chan", telegram_chat_id=77))
        session.add(
            Post(
                channel_name="walker_chan",
                post_id=1,
                text="via @bravo_chan",
                timestamp=1,
            )
        )
        session.commit()
        extract_batch(session, limit=10)
        record_probe_result(
            session,
            "prober_chan",
            {
                "isTelegramPage": True,
                "kind": "channel",
                "telegramChatId": 88,
                "samples": [
                    {
                        "id": 5,
                        "text": "read @bravo_chan and @walker_chan",
                        "date": "2026-10-01T00:00:00+00:00",
                        "timestamp": 5,
                        "channelName": "prober_chan",
                    }
                ],
            },
        )
    _assert_in_step()
    with Session(engine) as session:
        assert _stored(session)[1]["bravo_chan"] == (2, 0)


#: Spellings of a write to either table. Readers name the models' columns.
_WRITES = re.compile(
    r"(INSERT INTO|UPDATE|DELETE FROM)\s+tg_citation_|"
    r"(insert|update|delete)\((CitationPair|CitationCount)\b|"
    r"(?<!class )\b(CitationPair|CitationCount)\("
)


def test_the_references_aggregate_is_the_only_writer() -> None:
    app = pathlib.Path(__file__).resolve().parents[2] / "app"
    writers = sorted(
        str(path.relative_to(app))
        for path in app.rglob("*.py")
        if _WRITES.search(path.read_text())
    )
    # The one migration that corrects stored pairs, once, under a table lock:
    # it deletes the mention shadows the old extractor wrote and takes them
    # back out of `reference_count` in the same statement.
    assert writers == [
        "alembic/versions/a7d3e9f1c2b4_a_mention_is_not_a_link.py",
        "services/post_references.py",
    ]


def test_the_first_fill_builds_both_and_can_run_again() -> None:
    _write(
        ("aa", 1, "bb", "mention"),
        ("aa", 1, "bb", "link"),
        ("aa", 2, "cc", "forward"),
        ("cc", 1, "bb", "reply"),
        ("dd", 1, "aa", "mention"),
    )
    with Session(engine) as session:
        session.exec(delete(CitationPair))
        session.exec(delete(CitationCount))
        session.commit()
        # A batch of one handle, so every batch boundary is crossed.
        fill_citations(session, batch=1)
    _assert_in_step()
    with Session(engine) as session:
        fill_citations(session, batch=2)
    _assert_in_step()


def test_the_migration_drops_only_the_links_that_are_a_mention() -> None:
    """The cleanup for References written before `discover.is_the_mention`.

    Seeded the way the old extractor wrote them: post 1 has a plain @bb, so a
    mention and its anchor as a link. Post 2 mentions @bb and links one exact
    Post of it, which is two References under the new rule as well. Post 3
    links @cc with no mention, and must survive.
    """
    from app.alembic.versions import a7d3e9f1c2b4_a_mention_is_not_a_link as mig

    chat_id = 4242

    def sourced(post_id: int, *refs: Reference) -> SourcedReferences:
        return SourcedReferences(
            source_chat_id=chat_id,
            source_channel="aa",
            source_post_id=post_id,
            timestamp=1_700_000_000_000 + post_id,
            references=list(refs),
        )

    with Session(engine) as session:
        write_references(
            session,
            [
                sourced(1, Reference("bb", "mention"), Reference("bb", "link")),
                sourced(2, Reference("bb", "mention"), Reference("bb", "link", 7)),
                sourced(3, Reference("cc", "link")),
            ],
            target_chat_ids={},
        )
        session.commit()
        before_counts = _stored(session)[1]

    with engine.begin() as bind:
        mig.drop_mention_shadows(bind)

    with Session(engine) as session:
        left = {
            (int(post_id), str(target), str(kind), target_post)
            for post_id, target, kind, target_post in session.execute(
                text(
                    "SELECT source_post_id, target_handle, kind, target_post_id "
                    "FROM tg_post_references"
                )
            ).all()
        }
        pairs, counts = _stored(session)
    assert left == {
        (1, "bb", "mention", None),
        (2, "bb", "mention", None),
        (2, "bb", "link", 7),
        (3, "cc", "link", None),
    }
    assert pairs == {("aa", "bb"): 3, ("aa", "cc"): 1}
    assert counts == before_counts, "no pair vanished, so no count may move"
    _assert_in_step()
