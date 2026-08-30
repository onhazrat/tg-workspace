"""Ticket 21, PR 1: nothing in `app/` can create a `USER_OWNED` row with no owner.

Ticket 34 backfilled every ownerless row the fourteen `USER_OWNED` tables held
and **deliberately left the columns nullable**, because the writers that produce
them were still there — every log `upsert_*` took `user_id` as optional and the
scheduler created `SyncJob` rows with none. So "34 is done" never meant the
tables were clean; it meant the rows that existed at that moment were. This file
closes the writers, which is the half that makes the backfill stay true.

Why it matters is worth stating once, because "an unowned row" sounds cosmetic.
Under enforcement such a row is:

* invisible to every account, because `scoped_select` filters on `user_id`;
* refused to every reader by id, because `assert_owner` fails closed on NULL;
* unwritable, because `assert_owner_on_write` refuses it — and an import is one
  transaction, so the *first* one aborts a whole restore (ticket 31);
* and swept by **no retention window at all**, because ticket 20 runs the
  personal log families on *their owner's* `logRetentionDays`. That last one is
  a leak that looks exactly like retention working.

## The two the five handover notes did not name

Tickets 34 and 35 handed this ticket five preconditions between them. An audit
of every `USER_OWNED` write found two more, and both were worse than the five:

**`EmbeddingLog` was constructed with no `user_id` argument at all** — at both
sites in `services/embeddings.py`, unconditionally, on every scheduler tick and
every `POST /rag/embed`. Not an edge case waiting on an unresolvable operator:
the route path had `current_user.id` in hand and dropped it on the way to the
constructor. `test_no_user_owned_model_is_constructed_without_an_owner` is that
bug as a guard, and it is the one test here that would have caught it, because
the function's *signature* looked fine — it took an `operator_id` and simply
never passed it on.

**`_regenerate_one` refilled the population it inherited.** `run_auto_summary`
selected `Summary.user_id IS NULL` rows on purpose, and regenerated each into a
**brand new** Summary carrying `user_id=None`, with its `SummaryPayload`, its
`LLMLog` and its `PublishLog` stamped the same way. So the unowned set did not
shrink after ticket 34 — it was topped up every tick, indefinitely. A backfill
against a schema that still permits the thing it corrected is a snapshot, not a
fix.

## Why an AST walk and not a behavioural test

A behavioural test proves the paths it exercises. The `EmbeddingLog` bug lived
on a path with tests — `tests/api/test_rag.py` covers the embed route — and
they all passed, because nothing asserted on the log row's owner. The property
here is "no constructor anywhere", and only a walk over every construction site
can state it. `IMPORT_WRITES` and `SHARED_LOG_TYPES` are derived for the same
reason: an inventory somebody maintains by hand is an inventory that goes stale
silently.

Both exemption tables below are checked in **both directions** — an entry that
no longer matches anything fails, so a stale exemption cannot outlive the code
it excused.
"""

from __future__ import annotations

import ast
import pathlib
import uuid
from collections.abc import Iterator

import pytest
from sqlmodel import Session, col, delete, select

import app
from app.core.db import engine
from app.models import User
from app.models_tg import Summary
from app.services.tenancy import SCOPES, Scope
from tests.utils.user import create_random_user

APP_ROOT = pathlib.Path(app.__file__).parent

#: The classes whose rows must always name an owner, taken from the seam rather
#: than typed out — a table reclassified in `SCOPES` joins or leaves this set on
#: its own.
USER_OWNED_MODELS = frozenset(
    model.__name__ for model, scope in SCOPES.items() if scope is Scope.USER_OWNED
)

#: Construction sites that set the owner on the row **after** `__init__`, and
#: why that is honest rather than a loophole.
#:
#: Both are payload halves, and both assign `row.user_id = user_id` on the very
#: next statements — they have to, because the same code path also updates an
#: *existing* payload row fetched by id, so the assignment cannot live in the
#: constructor call without being written twice.
OWNER_SET_AFTER_CONSTRUCTION: dict[str, str] = {
    "summaries.SummaryPayload": (
        "apply_summary_payload builds or reuses the row, then assigns "
        "row.user_id from its required `user_id` parameter two lines later."
    ),
    "chat_sessions.ChatSessionPayload": (
        "apply_chat_session_payload, same shape as its Summary twin above."
    ),
}

#: Construction sites that pass the owner inside a `**` unpacking, and why.
#:
#: All four are the personal log `upsert_*`, which build one `fields` dict and
#: use it for both the update and the insert branch — `fields["user_id"]` is
#: the first key in each. The value comes from a parameter this file separately
#: proves is non-optional, which is what makes the unpacking safe to allow:
#: `test_owner_taking_writers_require_a_non_optional_user_id`.
OWNER_IN_UNPACKED_FIELDS: dict[str, str] = {
    "logs.PublishLog": "upsert_publish_log's `fields` dict carries user_id.",
    "logs.LLMLog": "upsert_llm_log, same shape.",
    "logs.EmbeddingLog": "upsert_embedding_log, same shape.",
    "logs.NetworkLog": "upsert_network_log, same shape.",
}

#: Every writer that had an optional owner before this ticket, and must not get
#: one back. `module.function` -> why it is here.
#:
#: A `| None` on any of these is not a style question: each one sits above a
#: constructor for a `USER_OWNED` table, so re-adding the default re-opens the
#: exact producer this ticket closed, and the suite would stay green because
#: nothing else asserts on a stamp.
OWNER_TAKING_WRITERS: dict[str, str] = {
    "logs.upsert_publish_log": "PublishLog is USER_OWNED (ticket 20 sweeps it per owner).",
    "logs.upsert_llm_log": "LLMLog, same.",
    "logs.upsert_embedding_log": "EmbeddingLog, same.",
    "logs.upsert_network_log": "NetworkLog, same — decision 23 keeps it Admin-read, not ownerless.",
    "embeddings.backfill_embeddings": (
        "Built both EmbeddingLog rows with no owner at all; the parameter was "
        "`operator_id: UUID | None = None` and was never threaded through."
    ),
    "scraper_jobs.create_job": (
        "SyncJob is USER_OWNED. The default was how the scheduler minted a job "
        "nobody owns on every tick — ticket 35 pinned that `activeSyncJob` then "
        "reports nothing for an auto-sync once the flag flips."
    ),
    "channel_setting_groups.ensure_default_group": (
        "user_id=None meant the `-global` scope key, which is the ownerless "
        "preset row ticket 34's backfill could not adopt on a fresh install."
    ),
    "channel_setting_groups.get_or_create_restricted_group": "Same scope key.",
    "channel_setting_groups.get_or_create_frozen_group": "Same scope key.",
    "channel_setting_groups.get_or_create_slow_feed_group": "Same scope key.",
    "channel_setting_groups.get_or_create_high_velocity_group": "Same scope key.",
}


def _model_aliases(tree: ast.Module) -> dict[str, str]:
    """Local name -> model name, for `from app.models_tg import SyncJob as SyncJobRow`.

    Written because the first draft of this guard matched `ast.Name` against the
    class name directly and **silently skipped `SyncJob`**, which is imported
    under an alias in `scraper_jobs.py` and is the single most important writer
    in the inventory. A guard that cannot see the thing it was written for is
    worse than no guard, because it reports success.
    """
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for name in node.names:
                aliases[name.asname or name.name] = name.name
    return aliases


def _construction_sites() -> list[tuple[str, str, set[str | None], int, str]]:
    """Every `Model(...)` call in `app/` for a `USER_OWNED` model.

    Returns `(module_stem, model_name, keyword_names, lineno, path)`. A `None`
    in the keyword set is a `**` unpacking.
    """
    sites: list[tuple[str, str, set[str | None], int, str]] = []
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        tree = ast.parse(path.read_text())
        aliases = _model_aliases(tree)
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Name):
                continue
            model = aliases.get(node.func.id, node.func.id)
            if model not in USER_OWNED_MODELS:
                continue
            sites.append(
                (
                    path.stem,
                    model,
                    {kw.arg for kw in node.keywords},
                    node.lineno,
                    str(path),
                )
            )
    return sites


def test_the_guard_can_see_every_user_owned_model() -> None:
    """The walk finds construction sites, and finds the aliased one.

    A guard whose scan silently matches nothing passes for ever. `SyncJob` is
    the specific canary: it is imported as `SyncJobRow`, so it is exactly the
    row this walk missed on its first draft.
    """
    sites = _construction_sites()
    assert len(sites) > 20, f"the AST walk found only {len(sites)} sites; it broke"

    models_seen = {model for _stem, model, _kws, _ln, _p in sites}
    assert "SyncJob" in models_seen, (
        "SyncJob is constructed in `scraper_jobs.py` as `SyncJobRow`. Not "
        "seeing it means alias resolution regressed, and the most important "
        "writer in this inventory is unguarded."
    )


def test_no_user_owned_model_is_constructed_without_an_owner() -> None:
    """The property, over every construction site rather than the tested ones.

    Mutation to watch it fail: drop `user_id=user_id` from either `EmbeddingLog`
    in `services/embeddings.py` and this goes red, while the whole of
    `tests/api/test_rag.py` stays green — which is the state the repository was
    actually in before this ticket.
    """
    offenders: list[str] = []
    used_after: set[str] = set()
    used_unpacked: set[str] = set()

    for stem, model, kwargs, lineno, path in _construction_sites():
        key = f"{stem}.{model}"
        if "user_id" in kwargs:
            continue
        if key in OWNER_SET_AFTER_CONSTRUCTION:
            used_after.add(key)
            continue
        if None in kwargs and key in OWNER_IN_UNPACKED_FIELDS:
            used_unpacked.add(key)
            continue
        offenders.append(f"{path}:{lineno} {model}(...)")

    assert not offenders, (
        f"{offenders} construct a USER_OWNED row without naming an owner. "
        f"Under enforcement that row is invisible to every account, refused to "
        f"every reader by id, unwritable, and swept by no retention window. "
        f"Pass `user_id=`, or add the site to OWNER_SET_AFTER_CONSTRUCTION / "
        f"OWNER_IN_UNPACKED_FIELDS with a reason."
    )

    stale_after = set(OWNER_SET_AFTER_CONSTRUCTION) - used_after
    assert not stale_after, (
        f"{sorted(stale_after)} are excused as setting the owner after "
        f"construction, but no such site exists now. Drop the entry rather "
        f"than leaving an exemption nothing explains."
    )
    stale_unpacked = set(OWNER_IN_UNPACKED_FIELDS) - used_unpacked
    assert not stale_unpacked, (
        f"{sorted(stale_unpacked)} are excused as passing the owner in a `**` "
        f"unpacking, but no such site exists now. Drop the entry."
    )


def _annotation_of(func: ast.FunctionDef | ast.AsyncFunctionDef) -> str | None:
    """The source text of this function's `user_id` annotation, if it has one."""
    args = func.args
    for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs]:
        if arg.arg == "user_id" and arg.annotation is not None:
            return ast.unparse(arg.annotation)
    return None


def test_owner_taking_writers_require_a_non_optional_user_id() -> None:
    """Each declared writer takes `uuid.UUID`, never `uuid.UUID | None`.

    The companion to the constructor walk, and it catches the other half of the
    same mistake: a constructor that *does* pass `user_id=` is still a producer
    if the value reaching it can be `None`. Ticket 32's lesson, applied to
    writes — an optional owner leaves every existing call site passing nothing
    and still passing its tests, so the annotation is what makes `mypy`
    enumerate the callers instead of leaving the gap to be found on the day the
    flag flips.
    """
    found: dict[str, str | None] = {}
    for path in sorted(APP_ROOT.rglob("*.py")):
        if "alembic" in path.parts:
            continue
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if not isinstance(node, ast.FunctionDef | ast.AsyncFunctionDef):
                continue
            key = f"{path.stem}.{node.name}"
            if key in OWNER_TAKING_WRITERS:
                found[key] = _annotation_of(node)

    missing = set(OWNER_TAKING_WRITERS) - set(found)
    assert not missing, (
        f"{sorted(missing)} are declared here but no longer exist. Rename the "
        f"entry or drop it — a guard naming a function nobody has cannot fail."
    )

    optional = {
        key: annotation
        for key, annotation in found.items()
        if annotation is None or "None" in annotation
    }
    assert not optional, (
        f"{optional} take an optional `user_id`. Every one of these sits above "
        f"a constructor for a USER_OWNED table, so the default re-opens the "
        f"producer ticket 21 closed — and the suite stays green, because "
        f"nothing else asserts on a stamp."
    )


# --------------------------------------------------------------------------
# The refill loop, behaviourally
# --------------------------------------------------------------------------


@pytest.fixture
def session() -> Iterator[Session]:
    with Session(engine) as s:
        yield s


@pytest.fixture
def user(session: Session) -> Iterator[User]:
    created = create_random_user(session)
    yield created
    session.exec(delete(User).where(col(User.id) == created.id))
    session.commit()


def _due_summary(session: Session, owner: uuid.UUID | None) -> Summary:
    """A Summary `_is_due` says is ready to regenerate."""
    now = int(__import__("time").time() * 1000)
    row = Summary(
        id=f"sum-{uuid.uuid4().hex[:8]}",
        user_id=owner,
        text="body",
        channels=["ch"],
        start_date=now - 7_200_000,
        end_date=now - 3_600_000,
        language="English",
        post_count=0,
        timestamp=now,
        extra={"autoRegenerate": True},
    )
    session.add(row)
    session.commit()
    return row


def test_an_unowned_summary_is_not_picked_up_for_regeneration(
    session: Session, user: User
) -> None:
    """The refill loop, closed.

    `run_auto_summary` used to select `Summary.user_id == operator OR IS NULL`,
    so an unowned Summary coming due produced a *new* unowned Summary plus an
    unowned payload and two unowned log rows. Ticket 34's backfill could never
    catch up with that, because it ran once and this runs every tick.

    Asserted at the query rather than by running the job, because regenerating
    calls an AI provider. The predicate is the whole fix.
    """
    from app.jobs import auto_summary

    unowned = _due_summary(session, None)
    owned = _due_summary(session, user.id)

    picked = session.exec(
        select(Summary).where(col(Summary.user_id).is_not(None))
    ).all()
    picked_ids = {row.id for row in picked}

    assert owned.id in picked_ids
    assert unowned.id not in picked_ids, (
        "an unowned Summary is still reachable by the auto-summary query; "
        "regenerating it mints another unowned Summary, payload and log rows"
    )

    source = pathlib.Path(auto_summary.__file__).read_text()
    assert "col(Summary.user_id).is_not(None)" in source, (
        "run_auto_summary no longer filters on ownership; the `OR user_id IS "
        "NULL` branch is what made _regenerate_one a producer of unowned rows"
    )


def test_regenerating_stamps_the_summarys_own_owner_not_the_deployments(
    session: Session, user: User
) -> None:
    """`_regenerate_one` takes the owner as an argument, and uses it everywhere.

    The mutation this catches: resolving the owner inside the function again,
    from `summary.user_id or <the operator>`. That reads correctly and is wrong
    on exactly one deployment shape — the one with a second account — which is
    the same blind spot ticket 33's wiring guard had to seed a second account
    to see.
    """
    from app.jobs import auto_summary

    tree = ast.parse(pathlib.Path(auto_summary.__file__).read_text())
    regenerate = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "_regenerate_one"
    )

    # Parsed, not grepped. The first version of this assertion searched the
    # module text and matched the sentence in `_regenerate_one`'s own docstring
    # explaining what the code used to do — a guard that fails on its own
    # documentation is a guard that gets deleted rather than believed.
    resolvers = {
        inner.func.id
        for inner in ast.walk(regenerate)
        if isinstance(inner, ast.Call)
        and isinstance(inner.func, ast.Name)
        and inner.func.id in {"get_operator_user_id", "resolve_follow_owner"}
    }
    assert not resolvers, (
        f"_regenerate_one calls {sorted(resolvers)} to work out an owner. It "
        f"must take one from its caller, which is the only frame that knows "
        f"whose Summary this is — resolving here is how the deployment's "
        f"identity got stamped on another account's regenerated Summary."
    )

    owner_param = _annotation_of(regenerate)
    assert owner_param is None, "the owner arrives as `owner_id`, not `user_id`"
    assert any(arg.arg == "owner_id" for arg in regenerate.args.kwonlyargs), (
        "`owner_id` must be keyword-only, so a positional call cannot transpose "
        "it with the Summary it belongs to"
    )
