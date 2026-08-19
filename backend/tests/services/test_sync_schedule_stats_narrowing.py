"""The scheduler must only pay for stats that can change its answer.

`jobs/auto_sync.py` ran `compute_channel_stats_batch` over every channel on every
60-second tick and read two values out of it, `has_posts` and `velocity`. On
staging that was `count(*)` plus `min`/`max` across 4.54M posts in a 5.9GB table:
**69 minutes of database time and 76M block reads per 10 hours**, ~11% of a core
burning continuously. 1,756 of the 2,077 channels had a dynamic deadline still in
the future, which fixes their answer whatever the stats say; **six** were live.

`sync_schedule.needs_dynamic_stats` is the predicate that skips the rest. Getting
it wrong in the cheap direction costs one stats row; getting it wrong in the other
silently stops syncing a channel, with nothing to notice — no error, no log, just a
feed that stops updating. So this asserts the implication over the **entire** input
space rather than at sampled points.

## Asserted in three directions

Following `client-split.conform.ts`: pinning only "the predicate is false a lot"
would be satisfied by both trivial implementations.

1. `test_the_predicate_never_hides_a_decision_that_depends_on_stats` — the safety
   property. `return True` passes it; `return False` does not.
2. `test_the_predicate_is_load_bearing_where_stats_really_matter` — `return False`
   fails here.
3. `test_the_tick_only_asks_the_database_about_the_channels_it_flagged` — the cost
   property, counting real SQL. `return True` fails here and nowhere else, which
   is exactly the mutation that restores the original 69 minutes while leaving
   every correctness test green.

Six mutations were watched go red before this was trusted. A seventh — changing
the stub `_schedule_view` substitutes — passed everything, so
`test_the_skipped_channels_are_scheduled_with_the_stats_this_file_proved_safe`
was added to close it.
"""

from __future__ import annotations

import itertools
from collections.abc import Iterator
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy import event
from sqlmodel import Session

from app.core.db import engine
from app.jobs.auto_sync import _schedule_view, _stats_for_scheduling
from app.models_tg import Channel, ChannelSettingGroup, Post
from app.services.sync_schedule import (
    due_reason,
    is_channel_due,
    needs_dynamic_stats,
)

NOW = 1_700_000_000_000

#: Straddles `now` in both directions, plus the "never scheduled" case.
DEADLINES = (None, NOW - 60_000, NOW + 60_000)

#: The stub `_schedule_view` substitutes when it skips the fetch, and every
#: distinguishable alternative: no posts, posts but dead, posts and live.
STATS = (
    {"has_posts": False, "velocity": 0.0},
    {"has_posts": True, "velocity": 0.0},
    {"has_posts": False, "velocity": 7.5},
    {"has_posts": True, "velocity": 7.5},
)
STUB = STATS[0]


def view(**kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(**kwargs)


def _every_stats_independent_shape() -> Iterator[dict[str, Any]]:
    """The cross product of everything `sync_schedule` reads except the stats."""
    for is_frozen, regular_on, dynamic_on, regular_at, dynamic_at in itertools.product(
        (False, True), (False, True), (False, True), DEADLINES, DEADLINES
    ):
        yield {
            "is_frozen": is_frozen,
            "regular_sync_enabled": regular_on,
            "dynamic_sync_enabled": dynamic_on,
            "next_regular_sync_at": regular_at,
            "next_dynamic_sync_at": dynamic_at,
        }


def test_the_predicate_never_hides_a_decision_that_depends_on_stats() -> None:
    """The safety property, over all 144 stats-independent shapes x 4 stats.

    Where the predicate says no fetch is needed, **every** function in the module
    must answer identically for every stats value it could have fetched. Not "the
    channel is usually still not due" — identical, including the `due_reason`
    label, which decides the backoff `apply_failure_backoff` applies later.
    """
    checked = 0
    for shape in _every_stats_independent_shape():
        if needs_dynamic_stats(view(**shape, **STUB), NOW):
            continue
        stubbed = view(**shape, **STUB)
        for stats in STATS:
            real = view(**shape, **stats)
            assert is_channel_due(real, NOW) == is_channel_due(stubbed, NOW), (
                f"{shape} + {stats} changes is_channel_due"
            )
            assert due_reason(real, NOW) == due_reason(stubbed, NOW), (
                f"{shape} + {stats} changes due_reason"
            )
            checked += 1

    assert checked, "the predicate flagged every shape — it is doing no narrowing"


def test_the_predicate_is_load_bearing_where_stats_really_matter() -> None:
    """`return False` would satisfy the safety property by making it vacuous.

    A channel with dynamic sync on and an elapsed deadline is due iff it has
    posts and a non-zero velocity — the one case the fetch exists for.
    """
    shape = {
        "is_frozen": False,
        "regular_sync_enabled": False,
        "dynamic_sync_enabled": True,
        "next_regular_sync_at": NOW + 60_000,
        "next_dynamic_sync_at": NOW - 60_000,
    }

    assert needs_dynamic_stats(view(**shape, **STUB), NOW)
    assert due_reason(view(**shape, has_posts=True, velocity=7.5), NOW) == "dynamic"
    assert due_reason(view(**shape, has_posts=True, velocity=0.0), NOW) is None
    assert due_reason(view(**shape, has_posts=False, velocity=7.5), NOW) is None


def test_a_channel_never_scheduled_for_dynamic_sync_still_gets_stats() -> None:
    """`next_dynamic_sync_at` is null both before the first sync and forever
    after, for any channel whose velocity is zero — `compute_next_dynamic_sync_at`
    returns None below a positive velocity. Treating null as "not due" would drop
    exactly the channels that have just started posting."""
    shape = {
        "is_frozen": False,
        "regular_sync_enabled": True,
        "dynamic_sync_enabled": True,
        "next_regular_sync_at": NOW + 60_000,
        "next_dynamic_sync_at": None,
    }

    assert needs_dynamic_stats(view(**shape, **STUB), NOW)
    assert due_reason(view(**shape, has_posts=True, velocity=7.5), NOW) == "dynamic"


def test_a_frozen_channel_is_not_a_special_case_in_the_predicate() -> None:
    """The predicate deliberately ignores `is_frozen`, so its guarantee holds for
    `due_reason` on its own and not merely behind `is_channel_due`.

    Skipping frozen channels here would be sound for today's single caller and
    unsound for a caller that reads `due_reason` directly, with nothing marking
    the difference. It costs nothing: a frozen group disables both sync modes, so
    `dynamic_sync_enabled` already excludes those channels.
    """
    frozen_but_dynamic = {
        "is_frozen": True,
        "regular_sync_enabled": False,
        "dynamic_sync_enabled": True,
        "next_regular_sync_at": None,
        "next_dynamic_sync_at": None,
    }

    assert needs_dynamic_stats(view(**frozen_but_dynamic, **STUB), NOW)
    assert not is_channel_due(
        view(**frozen_but_dynamic, has_posts=True, velocity=7.5), NOW
    )


def test_the_skipped_channels_are_scheduled_with_the_stats_this_file_proved_safe() -> (
    None
):
    """Ties the guard's premise to the running code.

    Every equivalence above is stated against `STUB`. That is only a proof about
    the scheduler if `_schedule_view` really substitutes those values when it
    skips the fetch — and it was not: mutating the stub to `has_posts=True` left
    all seven other tests green. A guard whose assumption nothing checks is the
    false pass `CLAUDE.md` keeps warning about.

    `STUB` must also be the pair that makes `_is_dynamic_eligible` false, or the
    skip would invent due-ness rather than defer it.
    """
    group = SimpleNamespace(
        is_frozen=False,
        regular_sync_enabled=True,
        dynamic_sync_enabled=True,
    )
    channel = Channel(
        id="narrow-stub", name="narrow-stub", setting_group_id="narrow-stub-group"
    )

    stubbed = _schedule_view(channel, group, None)

    assert stubbed.has_posts == STUB["has_posts"]
    assert stubbed.velocity == STUB["velocity"]
    assert not is_channel_due(
        SimpleNamespace(
            is_frozen=False,
            regular_sync_enabled=False,
            dynamic_sync_enabled=True,
            next_regular_sync_at=None,
            next_dynamic_sync_at=None,
            has_posts=stubbed.has_posts,
            velocity=stubbed.velocity,
        ),
        NOW,
    ), "the stub makes a channel look due — it must be the inert value"


# --- the cost property ------------------------------------------------------


@contextmanager
def captured_sql() -> Iterator[list[str]]:
    statements: list[str] = []

    def before_cursor_execute(
        conn: object,
        cursor: object,
        statement: str,
        parameters: object,
        context: object,
        executemany: bool,
    ) -> None:
        statements.append(statement)

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        yield statements
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)


def _group(session: Session, group_id: str, *, dynamic: bool) -> ChannelSettingGroup:
    group = ChannelSettingGroup(
        id=group_id,
        name=group_id,
        is_frozen=False,
        regular_sync_enabled=True,
        dynamic_sync_enabled=dynamic,
    )
    session.add(group)
    return group


def _channel(
    session: Session, name: str, group_id: str, deadline: int | None
) -> Channel:
    channel = Channel(
        id=name,
        name=name,
        setting_group_id=group_id,
        next_dynamic_sync_at=deadline,
    )
    session.add(channel)
    session.add(Post(channel_name=name, post_id=1, text=name, timestamp=NOW))
    return channel


@pytest.mark.parametrize("noise", [0, 25])
def test_the_tick_only_asks_the_database_about_the_channels_it_flagged(
    noise: int,
) -> None:
    """The property the 69 minutes came from, and the only test `return True`
    fails.

    Two channels are live (elapsed and never-set deadlines); the rest are either
    on a future deadline or in a group with dynamic sync off. Parametrised over
    the size of that irrelevant majority because the defect was invisible at
    small N and quadratic at large N — the assertion is that the cost tracks the
    *flagged* count, not the total.
    """
    with Session(engine) as session:
        _group(session, "narrow-dyn", dynamic=True)
        _group(session, "narrow-static", dynamic=False)
        live = [
            _channel(session, "narrow-live-past", "narrow-dyn", NOW - 60_000),
            _channel(session, "narrow-live-null", "narrow-dyn", None),
        ]
        others = [
            _channel(session, f"narrow-future-{i:03}", "narrow-dyn", NOW + 60_000)
            for i in range(noise)
        ]
        others += [
            _channel(session, f"narrow-static-{i:03}", "narrow-static", None)
            for i in range(noise)
        ]
        session.commit()

        channels = live + others
        groups_by_id = {
            g.id: g
            for g in (
                session.get(ChannelSettingGroup, "narrow-dyn"),
                session.get(ChannelSettingGroup, "narrow-static"),
            )
            if g is not None
        }

        with captured_sql() as statements:
            stats = _stats_for_scheduling(session, channels, groups_by_id, NOW)

    assert set(stats) == {"narrow-live-past", "narrow-live-null"}, (
        "the fetch covered channels whose answer was already fixed"
    )

    aggregates = [s for s in statements if "count(" in s and "tg_posts" in s]
    assert len(aggregates) == 1, f"expected one aggregate query, got {aggregates}"
    # The names travel as bound parameters, so the flagged count is read off the
    # result rather than the SQL text — which is also what makes it robust to the
    # LATERAL's array-parameter form.
    assert len(stats) == 2


def test_no_channel_flagged_means_no_query_at_all() -> None:
    """The steady state on staging is close to this: every dynamic deadline in
    the future. It must cost zero queries, not one over an empty list."""
    with Session(engine) as session:
        _group(session, "narrow-none", dynamic=True)
        channels = [
            _channel(session, f"narrow-quiet-{i}", "narrow-none", NOW + 60_000)
            for i in range(3)
        ]
        session.commit()
        group = session.get(ChannelSettingGroup, "narrow-none")
        assert group is not None

        with captured_sql() as statements:
            stats = _stats_for_scheduling(session, channels, {group.id: group}, NOW)

    assert stats == {}
    assert not [s for s in statements if "tg_posts" in s]
