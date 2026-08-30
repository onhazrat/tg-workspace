"""Ticket 16: the feed, lookup, counts, and Discover.

With `TENANCY_ENFORCED` on, `list_feed`/`lookup_posts`/`count_posts_in_scope`/
`compute_discover_candidates` return only Posts under Channels the caller
Follows. With it off they are byte-identical to what they did before, which is
the one thing every migrate ticket promises.

Three things here are not simply "the seam works" — `test_follows.py` already
proved that for `Post`:

* **The feed has two query shapes.** Without a per-channel cap it is a plain
  ordered select; with one it wraps the base select in a `row_number()`
  subquery and re-aliases `Post` onto it. The scoping predicate has to be
  inside the subquery or the window function ranks rows the caller may not see
  and the cap then discards visible ones. Both branches are tested.
* **`followed` is a second read, and there were four of it.** The feed's and
  the counts' `unfollowed_forwarded` filter, Discover's `isFollowed` flag, and
  a saved report's live `isFollowed` all answer "do I follow this handle?" from
  `tg_channels`. Left unscoped, Discover tells you a candidate is already
  followed because *somebody else* follows it, and the filter silently hides
  forwards from channels you cannot see. The fourth — the one inside
  `report_to_camel`, which runs *after* the aggregation and overwrites its
  answer — was found by review rather than by the first cut of this file,
  because every test here stopped at the aggregate. That is what
  `test_saving_a_report_keeps_the_scoped_is_followed` exists for.
* **Two followers of one handle both keep their posts.** The scope is
  `FOLLOW_SCOPED`, not `Post.user_id` — filtering on the stamp would hand the
  second follower an empty page for posts sitting right there.

Handle probes are the deliberate exception, and `test_probes_*` is the
checkbox: they are corpus, shared by everyone, and stay unscoped in both flag
states.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlmodel import Session, col, delete

from app.core.db import engine
from app.models import User
from app.models_tg import Post
from app.services.discover import compute_discover_candidates
from app.services.discover_probes import enqueue_handles, list_probes, queue_counts
from app.services.follows import ensure_follow
from app.services.post_filters import PostFilters
from app.services.posts import count_posts_in_scope, list_feed, lookup_posts
from tests.utils.setting_groups import add_test_channel
from tests.utils.user import create_random_user


@pytest.fixture
def session() -> Session:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def other_user(session: Session) -> User:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


@pytest.fixture
def enforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam on for one test. See `test_tenancy_seam.py`."""
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", True)


@pytest.fixture
def unenforced(monkeypatch: pytest.MonkeyPatch) -> None:
    """Turn the seam off for one test — the rollback state, since PR 4.

    The flag-off tests here used to read the ambient default and needed no
    fixture. Ticket 21 PR 4 flipped that default, so what they describe is what
    an operator gets by setting `TENANCY_ENFORCED=false` in `.env`. Still worth
    asserting: it is the programme's rollback, and a revert that only
    half-reverts is worse than none.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", False)


def _post(
    session: Session,
    channel_name: str,
    post_id: int,
    *,
    text: str = "",
    timestamp: int = 1,
    forwarded_from: str | None = None,
) -> None:
    session.add(
        Post(
            channel_name=channel_name,
            post_id=post_id,
            text=text,
            timestamp=timestamp,
            forwarded_from=forwarded_from,
        )
    )
    session.commit()


def _split_corpus(session: Session, user: User, other_user: User) -> tuple[str, str]:
    """One channel each, a post in each. Returns `(mine, theirs)`."""
    add_test_channel(session, "t16-mine", user_id=user.id)
    add_test_channel(session, "t16-theirs", user_id=other_user.id)
    _post(session, "t16-mine", 1, text="mine", timestamp=100)
    _post(session, "t16-theirs", 2, text="theirs", timestamp=200)
    return "t16-mine", "t16-theirs"


# --------------------------------------------------------------------------
# The feed
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_feed_hides_posts_from_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    _split_corpus(session, user, other_user)

    rows = list_feed(session, user_id=user.id)

    assert [r["id"] for r in rows] == [1]


def test_feed_is_unfiltered_while_the_flag_is_off(
    session: Session,
    user: User,
    other_user: User,
    unenforced: None,
) -> None:
    """The one thing this ticket promises not to change yet."""
    _split_corpus(session, user, other_user)

    ids = {r["id"] for r in list_feed(session, user_id=user.id)}

    assert {1, 2} <= ids


@pytest.mark.usefixtures("enforced")
def test_capped_feed_scopes_inside_the_window(
    session: Session, user: User, other_user: User
) -> None:
    """The cap branch is a different query, so it needs its own proof.

    A `max_per_channel` feed ranks rows with `row_number()` over a subquery. If
    the scoping predicate sat outside that subquery the window would rank the
    other account's posts too — harmless for `partition_by=channel_name` today,
    but the cap would still be computed over rows the caller cannot see.
    """
    mine, _theirs = _split_corpus(session, user, other_user)
    _post(session, mine, 3, text="mine again", timestamp=300)

    rows = list_feed(session, user_id=user.id, max_per_channel=5)

    assert {r["id"] for r in rows} == {1, 3}


@pytest.mark.usefixtures("enforced")
def test_two_followers_of_one_channel_both_see_its_posts(
    session: Session, user: User, other_user: User
) -> None:
    """`FOLLOW_SCOPED`, not a `Post.user_id` filter.

    The channel was scraped by `other_user`, so every Post row carries their
    stamp. Filtering on it would hand `user` an empty page for posts sitting
    right there — the exact failure the seam's dispatch-by-model exists to
    prevent.
    """
    add_test_channel(session, "t16-shared", user_id=other_user.id)
    _post(session, "t16-shared", 7, text="shared", timestamp=100)
    ensure_follow(session, channel_id="t16-shared", user_id=user.id)
    session.commit()

    assert [r["id"] for r in list_feed(session, user_id=user.id)] == [7]
    assert [r["id"] for r in list_feed(session, user_id=other_user.id)] == [7]


# --------------------------------------------------------------------------
# Lookup
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_lookup_omits_a_post_you_may_not_see(
    session: Session, user: User, other_user: User
) -> None:
    """Absent rather than an error — `lookup_posts` already drops unknown pairs.

    A missing entry is what a caller gets for a post that does not exist, so a
    post they may not see answers identically. That is the same reason
    `assert_owner` returns 404 rather than 403.
    """
    mine, theirs = _split_corpus(session, user, other_user)

    rows = lookup_posts(session, [(mine, 1), (theirs, 2)], user_id=user.id)

    assert [r["id"] for r in rows] == [1]


def test_lookup_is_unfiltered_while_the_flag_is_off(
    session: Session,
    user: User,
    other_user: User,
    unenforced: None,
) -> None:
    mine, theirs = _split_corpus(session, user, other_user)

    rows = lookup_posts(session, [(mine, 1), (theirs, 2)], user_id=user.id)

    assert {r["id"] for r in rows} == {1, 2}


# --------------------------------------------------------------------------
# Counts
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_counts_exclude_a_channel_you_do_not_follow(
    session: Session, user: User, other_user: User
) -> None:
    mine, _theirs = _split_corpus(session, user, other_user)

    assert count_posts_in_scope(session, user_id=user.id) == {mine: 1}


def test_counts_are_unfiltered_while_the_flag_is_off(
    session: Session,
    user: User,
    other_user: User,
    unenforced: None,
) -> None:
    mine, theirs = _split_corpus(session, user, other_user)

    counts = count_posts_in_scope(session, user_id=user.id)

    assert counts[mine] == 1
    assert counts[theirs] == 1


@pytest.mark.usefixtures("enforced")
def test_counts_and_feed_agree_about_the_scope(
    session: Session, user: User, other_user: User
) -> None:
    """`prompt_assembly` refuses a selection by comparing these two.

    It sums `count_posts_in_scope` to decide whether a prompt fits, then calls
    `list_feed` to assemble it. If only one of them were scoped the 413 guard
    would be measuring a different set of posts than the one it assembles.
    """
    _split_corpus(session, user, other_user)

    counts = count_posts_in_scope(session, user_id=user.id)
    feed = list_feed(session, user_id=user.id)

    assert sum(counts.values()) == len(feed)


# --------------------------------------------------------------------------
# The `followed` set: a second read, independently scoped
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_discover_is_followed_reflects_your_own_follows(
    session: Session, user: User, other_user: User
) -> None:
    """`isFollowed` is the flag that leaks another account's channel list.

    `other_user` follows `t16-target`; `user` does not. Reading the followed
    set unscoped would tell `user` the candidate is already followed — which is
    both wrong for them and a fact about somebody else's account.
    """
    add_test_channel(session, "t16-carrier", user_id=user.id)
    add_test_channel(session, "t16-target", user_id=other_user.id)
    _post(session, "t16-carrier", 1, text="see @t16target", forwarded_from="t16-target")
    session.commit()

    result = compute_discover_candidates(
        session, channel_names=["t16-carrier"], user_id=user.id
    )
    flags = {c["name"].lower(): c["isFollowed"] for c in result["candidates"]}

    assert flags.get("t16-target") is False


@pytest.mark.usefixtures("enforced")
def test_unfollowed_forwarded_filter_uses_your_own_follows(
    session: Session, user: User, other_user: User
) -> None:
    """A forward from a channel only *they* follow is unfollowed, to you.

    The filter asks "is the forward source one of my channels?". Answered from
    the whole `tg_channels` table it hides posts forwarded from channels the
    caller cannot see, so the `unfollowed_forwarded` view silently loses rows.
    """
    add_test_channel(session, "t16-carrier", user_id=user.id)
    add_test_channel(session, "t16-source", user_id=other_user.id)
    _post(session, "t16-carrier", 1, text="fwd", forwarded_from="t16-source")
    session.commit()

    rows = list_feed(
        session,
        user_id=user.id,
        filters=PostFilters(forwarded="unfollowed_forwarded"),
    )

    assert [r["id"] for r in rows] == [1]


# --------------------------------------------------------------------------
# Discover aggregation
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_discover_aggregates_only_posts_you_may_see(
    session: Session, user: User, other_user: User
) -> None:
    add_test_channel(session, "t16-carrier", user_id=user.id)
    add_test_channel(session, "t16-hidden", user_id=other_user.id)
    _post(session, "t16-carrier", 1, text="a", forwarded_from="alpha_channel")
    _post(session, "t16-hidden", 2, text="b", forwarded_from="beta_channel")
    session.commit()

    result = compute_discover_candidates(
        session,
        channel_names=["t16-carrier", "t16-hidden"],
        user_id=user.id,
    )

    assert result["postsInScope"] == 1
    assert {c["name"].lower() for c in result["candidates"]} == {"alpha_channel"}


def test_discover_is_unfiltered_while_the_flag_is_off(
    session: Session,
    user: User,
    other_user: User,
    unenforced: None,
) -> None:
    add_test_channel(session, "t16-carrier", user_id=user.id)
    add_test_channel(session, "t16-hidden", user_id=other_user.id)
    _post(session, "t16-carrier", 1, text="a", forwarded_from="alpha_channel")
    _post(session, "t16-hidden", 2, text="b", forwarded_from="beta_channel")
    session.commit()

    result = compute_discover_candidates(
        session,
        channel_names=["t16-carrier", "t16-hidden"],
        user_id=user.id,
    )

    assert result["postsInScope"] == 2
    assert {c["name"].lower() for c in result["candidates"]} == {
        "alpha_channel",
        "beta_channel",
    }


# --------------------------------------------------------------------------
# Handle probes stay corpus — the ticket's second checkbox
# --------------------------------------------------------------------------


@pytest.mark.parametrize("enforce", [False, True])
def test_probes_are_shared_by_everyone_in_both_flag_states(
    session: Session,
    user: User,
    other_user: User,
    monkeypatch: pytest.MonkeyPatch,
    enforce: bool,
) -> None:
    """A probe is a fact about a handle, not about an account.

    "@foo cannot be followed by anyone" is true for every caller, and the queue
    is drained by a scheduled job that has no user at all
    (`jobs/discover_probe.py` is deliberately unmetered for the same reason).
    Scoping this would make each account re-probe every handle, multiplying the
    load on Telegram by the number of accounts to reach the same answer.
    """
    from app.core import config

    monkeypatch.setattr(config.settings, "TENANCY_ENFORCED", enforce)
    enqueue_handles(session, ["t16probehandle"])
    session.commit()

    handles = {row["handle"] for row in list_probes(session)}

    assert "t16probehandle" in handles
    assert queue_counts(session)["queued"] >= 1


#: The probe reads on a request path, each of which must say why it is unscoped.
#: Named individually rather than counted: a count is satisfied by any two call
#: sites, so adding a fourth read and marking one of the existing ones twice
#: would pass. `probe_map` is on this list because the first cut of the guard
#: counted instead of naming, and `probe_map` was the read it missed.
PROBE_READ_FUNCTIONS = ("probe_map", "list_probes", "queue_counts")


def test_every_probe_read_states_its_reason_at_the_call_site() -> None:
    """An unscoped read is indistinguishable from a forgotten one.

    `unscoped_select` is a no-op by construction; its entire job is to make the
    call site greppable and force the reason to be written down. Parsing the
    module rather than grepping it, so the assertion is about the function each
    call actually sits in — a `reason=` anywhere in the file, or an
    `unscoped_select` in a fourth function, cannot stand in for the read this
    is about.
    """
    import ast
    import pathlib

    backend_dir = pathlib.Path(__file__).resolve().parents[2]
    source = (backend_dir / "app" / "services" / "discover_probes.py").read_text()
    tree = ast.parse(source)

    marked = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        and any(
            isinstance(call.func, ast.Name)
            and call.func.id == "unscoped_select"
            and any(kw.arg == "reason" for kw in call.keywords)
            for call in ast.walk(node)
            if isinstance(call, ast.Call)
        )
    }

    assert set(PROBE_READ_FUNCTIONS) <= marked, (
        f"probe reads not marked unscoped with a reason: "
        f"{sorted(set(PROBE_READ_FUNCTIONS) - marked)}"
    )


# --------------------------------------------------------------------------
# Saving a report must not undo the scoping the aggregation just did
# --------------------------------------------------------------------------


@pytest.mark.usefixtures("enforced")
def test_saving_a_report_keeps_the_scoped_is_followed(
    session: Session, user: User, other_user: User
) -> None:
    """The projection runs *after* the aggregation and can overwrite it.

    `create_report` scopes `compute_discover_candidates` and then hands the
    stored candidates to `report_to_camel`, which resolves `isFollowed` live
    against `tg_channels`. That read was a fourth unscoped copy of
    `select(Channel.name)`, so the saved report answered `isFollowed: true`
    because *another account* follows the handle — contradicting
    `/discover/candidates` for byte-identical input. Found by review, not by
    the first cut of these tests, because every other test here stops at the
    aggregate.
    """
    from app.services.discover_reports import create_report

    add_test_channel(session, "t16-carrier", user_id=user.id)
    add_test_channel(session, "t16-target", user_id=other_user.id)
    _post(session, "t16-carrier", 1, text="fwd", forwarded_from="t16-target")
    session.commit()

    live = compute_discover_candidates(
        session, channel_names=["t16-carrier"], user_id=user.id
    )
    saved = create_report(
        session,
        channel_names=["t16-carrier"],
        start_date=None,
        end_date=None,
        signals=None,
        filters=PostFilters(),
        max_per_channel=0,
        user_id=user.id,
    )

    def flags(result: dict[str, Any]) -> dict[str, bool]:
        candidates: list[dict[str, Any]] = result["candidates"]
        return {c["name"].lower(): c["isFollowed"] for c in candidates}

    assert flags(saved) == flags(live)
    assert flags(saved).get("t16-target") is False


def test_handle_probe_is_classified_as_corpus() -> None:
    """The claim above, asserted against the seam rather than a comment."""
    from app.models_tg import DiscoverHandleProbe
    from app.services.tenancy import Scope, scope_of

    assert scope_of(DiscoverHandleProbe) is Scope.CORPUS


# --------------------------------------------------------------------------
# The signature itself
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "func",
    [list_feed, lookup_posts, count_posts_in_scope, compute_discover_candidates],
)
def test_every_scoped_read_demands_a_user_id(func: object) -> None:
    """No default, for the reason `scoped_select` takes none.

    A defaulted `user_id=None` would let a call site forget the argument and
    still compile, and the seam would then have to invent a meaning for "no
    user" — the tempting one being "match rows whose owner is NULL", which
    hands back every row written before the stamp existed.
    """
    import inspect

    param = inspect.signature(func).parameters["user_id"]  # ty: ignore

    assert param.default is inspect.Parameter.empty
    assert param.kind is inspect.Parameter.KEYWORD_ONLY
    assert param.annotation in (uuid.UUID, "uuid.UUID")
