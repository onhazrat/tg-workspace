"""Aggregate for `tg_post_references` — the channel reference graph (CRG-01).

The **only** module that writes this table. A Reference is one Post naming one
Channel, once, in one way; `models_tg.PostReference` carries the argument for
the row's shape and `docs/migration/ADR-019-channel-reference-graph.md` the
three decisions that are hard to reverse.

## The extractor is a sibling of Discover's, not a caller

`discover.post_references` answers "which handles does this Post name", folding
a cross-channel reply into `link` and returning no Post ids at all. The graph
needs the ids and keeps the reply apart, so `references_for` is a second
implementation over the same primitives rather than a wrapper.

Two implementations of "what counts as a reference" can drift apart with
nothing to notice, which would make the graph quietly disagree with every
Discovery report. `test_post_references.py` asserts they find the same set of
target handles for the same Post. The kinds differ by design; the handles must
not.

## Deferral is "not selected yet", not "selected and left"

A Reference is keyed by the referencing Channel's chat id, which is not always
known. The obvious shape — read a page, skip the Posts you cannot write —
stalls: the walk is newest-first with no cursor, so a page made entirely of
unwritable Posts is re-read on every tick for ever.

So the eligibility test lives in the **predicate**. A Post whose Channel has no
chat id is simply not selected until either the id lands or the grace expires,
and every Post the walk does read is marked. Progress is therefore guaranteed
by construction rather than by the data being kind.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast

from sqlalchemy import func, or_, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlmodel import Session, col, select
from sqlmodel.sql.expression import SelectOfScalar

from app.core.config import settings
from app.models_tg import Channel, DirectoryEntry, DirectorySample, Post, PostReference
from app.services.discover import (
    _text_link_re,
    extract_mentions,
    normalize_handle,
)
from app.services.follows import followed_channel_names
from app.services.settings_registry import REFERENCE_GRAPH_KEY
from app.services.settings_store import get_global_setting
from app.services.telegram_web import extract_channel_post_from_href, is_channel_handle
from app.services.tenancy import unscoped_select

#: The four kinds, one wider than `discover.SignalKind`. A cross-channel reply
#: is `reply` here and `link` there; see the model docstring.
KINDS: tuple[str, ...] = ("forward", "mention", "link", "reply")

#: The columns `write_references` binds per row. Named here rather than
#: counted from the model, because the statement binds exactly the keys that
#: function builds and a model column it does not set would not be one of
#: them -- the number has to move when *that dict* does.
_BOUND_COLUMNS_PER_ROW = 9

#: References per `INSERT`. The wire protocol refuses a statement with more
#: than 65535 bind parameters, so this is the ceiling with a little room left
#: rather than a tuning knob.
_INSERT_CHUNK_ROWS = 65535 // _BOUND_COLUMNS_PER_ROW - 1

#: What the extractor reads (CRG-02). A `DirectorySample` is `Post` minus the
#: owner and the sync bookkeeping, and every field read below — the text, the
#: links blob, the forward attribution and the reply pointer — is spelled the
#: same on both, because the sample was modelled on the Post deliberately. A
#: union rather than a `Protocol`: two concrete classes are the whole set, and
#: mypy checks the attribute names against the columns this way.
ReferenceSource = Post | DirectorySample

_SCOPE_REASON = (
    "The reference graph is corpus-wide: it records what exists on Telegram "
    "rather than what anybody reads, and half its rows come from Directory "
    "samples whose handles have no Channel row to correlate against. Scoping "
    "the walk by Follow would hide exactly the Posts worth extracting."
)


@dataclass(frozen=True)
class Reference:
    """One extracted Reference, before it knows which Post produced it."""

    target_handle: str
    kind: str
    target_post_id: int | None = None


@dataclass(frozen=True)
class ExtractionCounts:
    """What one walk did.

    `deferring_channels` counts **Channels**, not Posts. The Posts waiting on a
    chat id are whatever those Channels hold, and counting them would mean an
    aggregate over the pending partial index on every tick — during the first
    backfill that is the whole corpus. The Channel count is one probe of a
    table with a couple of thousand rows, and it is the actionable number
    anyway: a gap in the graph is a list of Channels to go and look at.
    """

    scanned: int = 0
    written: int = 0
    skipped: int = 0
    deferring_channels: int = 0


def _source_text(source: ReferenceSource) -> str:
    return source.text or ""


def _link_references(source: ReferenceSource) -> list[Reference]:
    """Telegram links in the body, from the stored hrefs and the plain text.

    Mirrors `discover.extract_post_link_channels`, which unions the masked
    hrefs captured at scrape time with the URLs left in the text, and dedups
    because once the links backfill has run a plain `https://t.me/foo` appears
    in both. The regex is imported from there rather than copied: two spellings
    of which domains count is how the two extractors start disagreeing.

    Where that function keeps only the channel, this keeps the Post id too, so
    the stored `url` is preferred over the stored `channel` — they are built
    from the same href, so they never name different Channels, but only the url
    carries the id.
    """
    found: dict[tuple[str, int | None], None] = {}

    def add(parsed: tuple[str, int | None] | None) -> None:
        if parsed is None:
            return
        handle, post_id = parsed
        found.setdefault((normalize_handle(handle), post_id), None)

    for match in _text_link_re().finditer(_source_text(source)):
        add(extract_channel_post_from_href(f"https://t.me/{match.group(1)}"))

    for link in source.links or []:
        if not isinstance(link, dict):
            continue
        url = link.get("url")
        if isinstance(url, str):
            parsed = extract_channel_post_from_href(url)
            if parsed is not None:
                add(parsed)
                continue
        channel = link.get("channel")
        if isinstance(channel, str) and is_channel_handle(channel):
            add((channel, None))

    return [
        Reference(target_handle=handle, kind="link", target_post_id=post_id)
        for handle, post_id in found
    ]


def references_for(
    source: ReferenceSource,
    *,
    source_handle: str,
) -> list[Reference]:
    """Every Reference one Post makes, deduplicated.

    Self-references drop out, as they do in `discover.post_references`: a
    Channel naming itself is not an edge, and a same-channel reply — the common
    case — is exactly that.

    Deduplication is on `(target_handle, kind, target_post_id)`, matching the
    table's uniqueness. Two links from one Post to two different Posts of the
    same Channel are therefore two References; two links to the same Post are
    one.
    """
    self_handle = normalize_handle(source_handle)
    found: dict[tuple[str, str, int | None], Reference] = {}

    def add(handle: str, kind: str, target_post_id: int | None = None) -> None:
        normalized = normalize_handle(handle)
        if not normalized or normalized == self_handle:
            return
        ref = Reference(
            target_handle=normalized, kind=kind, target_post_id=target_post_id
        )
        found.setdefault((normalized, kind, target_post_id), ref)

    if source.forwarded_from:
        # CRG-03's column, parsed at scrape time out of the forward
        # attribution's href. Null for every Post scraped before it, and
        # permanently so — the href was never stored, so the Reference simply
        # names the Channel, as it did before.
        add(source.forwarded_from, "forward", source.forwarded_from_post_id)

    for handle in extract_mentions(_source_text(source)):
        add(handle, "mention")

    for ref in _link_references(source):
        add(ref.target_handle, ref.kind, ref.target_post_id)

    reply_channel = (source.reply_to or {}).get("channel")
    if isinstance(reply_channel, str) and is_channel_handle(reply_channel):
        add(reply_channel, "reply", source.reply_to_post_id)

    return list(found.values())


def _target_chat_ids(session: Session, handles: set[str]) -> dict[str, int]:
    """Chat ids the deployment already knows for these handles.

    **Both tables, and `tg_channels` first.** The Directory alone is not
    enough and gets the important case exactly backwards: `directory_harvest`
    filters followed handles out before enqueueing, on the grounds that sync
    already fetches those Channels, so a Channel somebody follows usually has
    no Directory row at all. Reading only the Directory would therefore leave
    `target_chat_id` NULL forever on precisely the edges that point at the
    Channels this deployment knows best.

    Two queries per page, never one per handle — the shape the harvest sweep's
    membership check uses, for its reason: a round trip per answer is the
    "compute it for everything, read one field" defect from the other
    direction.

    Nothing ever comes back to fill in what stays NULL. A target is usually a
    Channel nobody has probed, and a read resolves that by joining the
    Directory, whose rows are never deleted.
    """
    if not handles:
        return {}
    directory = session.exec(
        unscoped_select(
            select(DirectoryEntry.handle, DirectoryEntry.telegram_chat_id).where(
                col(DirectoryEntry.handle).in_(handles),
                col(DirectoryEntry.telegram_chat_id).is_not(None),
            ),
            reason=_SCOPE_REASON,
        )
    ).all()
    known = {handle: chat_id for handle, chat_id in directory if chat_id is not None}
    # A followed Channel's id overrides a Directory entry's, on the rare
    # occasions both exist: `tg_channels` is the row sync keeps current and
    # reconciles on every page, and a Directory entry is a probe's snapshot.
    known.update(_unambiguous_chat_ids(session, handles))
    return known


@dataclass(frozen=True)
class SourcedReferences:
    """One Post's References, with the identity of the Post that made them."""

    source_chat_id: int
    source_channel: str
    source_post_id: int
    timestamp: int
    references: list[Reference]


def write_references(
    session: Session,
    sourced: list[SourcedReferences],
    *,
    target_chat_ids: dict[str, int],
) -> int:
    """Insert what is not already there, and report how many were new.

    **One statement per chunk, not one per Post.** Every source column is
    already per-row, so there is nothing a per-Post call buys -- and at a scan
    limit of 500 it would be 500 round trips a tick, which is the defect
    `_target_chat_ids` and the harvest sweep both go out of their way to avoid.

    The chunk exists because the wire protocol has a hard ceiling of 65535
    bind parameters per statement and a row here spends nine of them, so a
    single `VALUES` list dies above 7281 References. The page size does not
    bound that: `references_for` is unbounded per Post, since a post listing
    twenty channels yields twenty References on its own. At the sweep's scan
    limit of 500 Posts it never came close; CRG-04's backfill reads thousands
    of Posts a batch, and the failure would be an `INSERT` rejected outright
    hours into an unattended run.

    `ON CONFLICT DO NOTHING` against the occurrence constraint, which is
    `NULLS NOT DISTINCT` — so a mention, whose `target_post_id` is null,
    actually collides with itself on a re-run. Under Postgres's default null
    semantics it would not, and the backfill would duplicate the majority of
    the table every time it ran.

    Not committed here. The caller writes and marks in one transaction, so a
    tick that dies between the two re-reads those Posts rather than losing
    their References.
    """
    rows = [
        {
            "id": uuid.uuid4(),
            "source_chat_id": one.source_chat_id,
            "source_channel": normalize_handle(one.source_channel),
            "source_post_id": one.source_post_id,
            "timestamp": one.timestamp,
            "target_handle": ref.target_handle,
            "target_chat_id": target_chat_ids.get(ref.target_handle),
            "target_post_id": ref.target_post_id,
            "kind": ref.kind,
        }
        for one in sourced
        for ref in one.references
    ]
    written = 0
    for start in range(0, len(rows), _INSERT_CHUNK_ROWS):
        # `RETURNING` rather than `rowcount`: a multi-row INSERT reports -1 on
        # this driver, and `ON CONFLICT DO NOTHING` returns only the rows it
        # actually inserted, which is exactly the number the caller wants.
        inserted = session.execute(
            pg_insert(PostReference)
            .values(rows[start : start + _INSERT_CHUNK_ROWS])
            .on_conflict_do_nothing(constraint="uq_tg_post_references_occurrence")
            .returning(col(PostReference.id))
        ).all()
        written += len(inserted)
    return written


def extract_sample_references(
    session: Session,
    handle: str,
    samples: list[DirectorySample],
    *,
    source_chat_id: int | None,
) -> None:
    """Mine a Directory entry's samples for References.

    The tier that was free all along and never collected (CRG-02). A probe
    already fetched and parsed these Posts, so the graph grows to cover
    Channels nobody follows at no additional Telegram cost.

    **A sample gets no deferral, and that asymmetry with `extract_batch` is
    deliberate.** A Post defers by leaving its flag unset, so a later tick can
    retry it once the chat id lands. A sample carries no such flag and the whole
    snapshot is replaced on the next probe, so there is nothing to defer *with*.
    An entry with no chat id is therefore skipped outright — and the next probe
    re-mines exactly these Posts anyway, with the uniqueness constraint
    absorbing whatever overlap the previous one already wrote. The retry is
    built into the refresh window.

    **Does not commit.** `record_probe_result` writes the verdict, the snapshot
    and these in one transaction: a probe half stored is worse than one not
    stored at all.

    Returns nothing, unlike `extract_batch`. A probe reports a verdict, not a
    walk, and no caller has anywhere to put a count — `ExtractionCounts` exists
    because the sweep's deferrals are a gap somebody has to go and look at, and
    a sample has no deferral to report.
    """
    if source_chat_id is None or not samples:
        return

    extracted: list[SourcedReferences] = []
    targets: set[str] = set()
    for sample in samples:
        references = references_for(sample, source_handle=handle)
        extracted.append(
            SourcedReferences(
                source_chat_id=source_chat_id,
                source_channel=handle,
                source_post_id=sample.post_id,
                timestamp=sample.timestamp,
                references=references,
            )
        )
        targets.update(ref.target_handle for ref in references)

    write_references(
        session, extracted, target_chat_ids=_target_chat_ids(session, targets)
    )


def unknown_targets_statement(
    *, limit: int, followed: set[str], followed_sources_only: bool
) -> SelectOfScalar[str]:
    """Reference targets with no Directory entry that nobody follows (DDS-02).

    What the harvest sweep queues. The graph already holds every handle a
    stored Post names, and a Directory sample names more, so reading it here
    replaced a second walk over the Posts that re-extracted the same handles.

    `followed_sources_only` narrows the sources to followed Channels, which is
    exactly the set the old Post walk could see: the rollback for the crawl
    past one hop. Followed names arrive normalised, the form both handle
    columns are stored in.

    **Newest Reference first**, the order the Post walk before it had. It is
    what lets a handle a Post named a moment ago reach the queue on the next
    tick while a backlog larger than the budget is still outstanding; ordered
    by handle, a target late in the alphabet would lose every tick to the
    samples arriving ahead of it. The handle breaks ties so the order is total.

    **An anti-join computed every tick, with no cursor.** `PostReference.id` is
    a random UUID, so there is no position to resume from, and a caught-up
    tick reads the whole table to find nothing. Measured on staging on
    2026-09-23: 19 ms over 79k References (21 MB), every 300 s.
    ponytail: the scan grows linearly with the graph; add a cursor column
    once `pg_stat_statements` shows the tick is costly.
    """
    on_map = (
        select(DirectoryEntry.handle)
        .where(col(DirectoryEntry.handle) == col(PostReference.target_handle))
        .exists()
    )
    statement = (
        select(col(PostReference.target_handle))
        .where(~on_map, col(PostReference.target_handle).not_in(followed))
        .group_by(col(PostReference.target_handle))
        .order_by(
            func.max(PostReference.timestamp).desc(),
            col(PostReference.target_handle),
        )
        .limit(limit)
    )
    if followed_sources_only:
        statement = statement.where(col(PostReference.source_channel).in_(followed))
    return unscoped_select(statement, reason=_SCOPE_REASON)


def unknown_targets(
    session: Session, *, limit: int, followed_sources_only: bool
) -> list[str]:
    """Run `unknown_targets_statement` against the Channels followed right now."""
    followed = {normalize_handle(name) for name in followed_channel_names(session)}
    return list(
        session.exec(
            unknown_targets_statement(
                limit=limit,
                followed=followed,
                followed_sources_only=followed_sources_only,
            )
        ).all()
    )


def graph_epoch_ms(session: Session) -> int:
    """When the reference graph started existing.

    The floor the grace counts from. Without it every Post already in the
    corpus is past a seven-day window the instant the feature deploys, which is
    the population the grace exists for. Written once by CRG-01's migration; a
    deployment missing the row behaves as though the graph has always existed,
    which is the conservative reading — Posts are given up on sooner, never
    later than they should be.
    """
    stored = get_global_setting(session, REFERENCE_GRAPH_KEY).get("epochMs")
    # `PUT /data/settings/{key}` writes an arbitrary JSON body to any global
    # key, so a hand-edited `{"epochMs": "soon"}` reaches this line. It must
    # not raise: this runs on every tick, and an exception here would take the
    # Directory sweep down with it. Falling back to 0 means "the graph has
    # always existed", which gives up on a Post sooner than intended and never
    # later -- the conservative direction.
    return int(stored) if isinstance(stored, int | float) else 0


def grace_cutoff_ms(*, now: datetime | None = None) -> int:
    """Posts whose clock is older than this have run out of grace."""
    moment = now or datetime.now(UTC)
    window = timedelta(days=settings.POST_REFERENCE_CHAT_ID_GRACE_DAYS)
    return int((moment - window).timestamp() * 1000)


def _eligible(epoch_ms: int, cutoff_ms: int) -> Any:
    """A Post this walk may read: writable now, or out of grace.

    The left half is the ordinary case. The right half is what stops a Channel
    that never yields a chat id from holding its Posts in the pending index for
    ever; such a Post is read, written nowhere and marked.
    """
    # `= 1`, not `EXISTS`. `Channel.name` is not unique, and a name carrying
    # two chat ids cannot say which one a Reference belongs to -- so such a
    # Post is not selected, exactly as one with no chat id is not.
    known_chat_id = (
        select(func.count())
        .select_from(Channel)
        .where(
            col(Channel.name) == col(Post.channel_name),
            col(Channel.telegram_chat_id).is_not(None),
        )
        .scalar_subquery()
        == 1
    )
    out_of_grace = (
        func.greatest(
            func.coalesce(col(Post.retrieved_at), col(Post.timestamp)), epoch_ms
        )
        < cutoff_ms
    )
    return or_(known_chat_id, out_of_grace)


def extract_batch(
    session: Session, *, limit: int, now: datetime | None = None
) -> ExtractionCounts:
    """Extract one page of Posts' References, write them, and mark the page.

    One session and one transaction for the read, the writes and the marks, in
    the shape `directory_harvest._harvest` established: committing them
    together is what makes a tick that dies mid-walk re-read those Posts rather
    than lose their References.

    **One page per call, deliberately.** That walk loops over pages inside one
    session and has to `expunge_all` between them, or the scan limit bounds one
    query and nothing bounds the tick. This one returns after a page, so the
    caller's loop -- the tick, or CRG-04's script -- is where the bound lives,
    and `limit` is the memory ceiling directly: up to that many Posts with
    their `text` loaded, once.
    """
    if limit <= 0:
        return ExtractionCounts()

    epoch_ms = graph_epoch_ms(session)
    cutoff_ms = grace_cutoff_ms(now=now)

    page = list(
        session.exec(
            unscoped_select(
                select(Post)
                .where(
                    col(Post.references_extracted) == False,  # noqa: E712
                    _eligible(epoch_ms, cutoff_ms),
                )
                .order_by(col(Post.timestamp).desc())
                .limit(limit),
                reason=_SCOPE_REASON,
            )
        ).all()
    )
    if not page:
        return ExtractionCounts(deferring_channels=_deferring_channels(session))

    chat_ids = _unambiguous_chat_ids(session, {post.channel_name for post in page})

    extracted: list[SourcedReferences] = []
    targets: set[str] = set()
    skipped = 0
    for post in page:
        source_chat_id = chat_ids.get(post.channel_name)
        if source_chat_id is None:
            # Out of grace: read, given up on, marked. The predicate only lets
            # a Post with no single chat id through once its window has closed,
            # so this branch is the give-up and never the deferral.
            skipped += 1
            continue
        references = references_for(post, source_handle=post.channel_name)
        extracted.append(
            SourcedReferences(
                source_chat_id=source_chat_id,
                source_channel=post.channel_name,
                source_post_id=post.post_id,
                timestamp=post.timestamp,
                references=references,
            )
        )
        targets.update(ref.target_handle for ref in references)

    written = write_references(
        session, extracted, target_chat_ids=_target_chat_ids(session, targets)
    )
    mark_references_extracted(session, [post.id for post in page])
    session.commit()

    return ExtractionCounts(
        scanned=len(page),
        written=written,
        skipped=skipped,
        deferring_channels=_deferring_channels(session),
    )


def _unambiguous_chat_ids(session: Session, names: set[str]) -> dict[str, int]:
    """Chat ids for these Channel names, skipping any name that has two.

    **`Channel.name` is not unique.** `channels.py` carries a detector for two
    `tg_channels` rows sharing a name precisely because it happens, and picking
    whichever the driver returned first would stamp References from one chat
    with another chat's identity -- merging two nodes, which the model docstring
    calls the one failure this table's whole keying exists to avoid.

    So a name with two ids resolves to nothing. On the **source** side that is
    belt to `_eligible`'s braces, which spells the same `= 1` and keeps such a
    Post out of the page entirely. On the **target** side there is no predicate
    in front of this at all, and an arbitrary pick would merge two nodes at the
    far end of the edge instead of the near one.
    """
    if not names:
        return {}
    rows = session.exec(
        unscoped_select(
            select(Channel.name, func.min(Channel.telegram_chat_id))
            .where(
                col(Channel.name).in_(names),
                col(Channel.telegram_chat_id).is_not(None),
            )
            .group_by(col(Channel.name))
            .having(func.count() == 1),
            reason=_SCOPE_REASON,
        )
    ).all()
    # `func.min` over a NOT NULL-filtered group cannot be NULL, but neither
    # type checker can see that through the aggregate.
    pairs = cast(list[tuple[str, int]], rows)
    return {name: chat_id for name, chat_id in pairs if chat_id is not None}


def _deferring_channels(session: Session) -> int:
    """Channels holding a Post back for want of a chat id.

    **Both halves of that matter.** Counting every chat-id-less Channel would
    keep reporting a number long after the grace has swept their Posts away,
    which is the opposite of the actionable list `ExtractionCounts` promises.
    The `EXISTS` is what makes it fall to zero when there is nothing left
    waiting, and it costs nothing on a caught-up deployment: the outer filter
    runs first, so the probe happens only for Channels with no chat id, which
    is a short list or the graph has bigger problems.
    """
    pending = (
        select(Post.id)
        .where(
            col(Post.channel_name) == col(Channel.name),
            col(Post.references_extracted) == False,  # noqa: E712
        )
        .exists()
    )
    return int(
        session.exec(
            unscoped_select(
                select(func.count())
                .select_from(Channel)
                .where(col(Channel.telegram_chat_id).is_(None), pending),
                reason=_SCOPE_REASON,
            )
        ).one()
    )


def mark_references_extracted(session: Session, post_ids: list[uuid.UUID]) -> None:
    """Record that these Posts' References have been extracted.

    A bulk `UPDATE`, and `synchronize_session=False`, because `auto` resolves
    to `evaluate`, which walks the whole identity map per call, so a catch-up
    pass would be quadratic in the scan limit.

    **Not committed here.** See `write_references`.
    """
    if not post_ids:
        return
    session.execute(
        update(Post)
        .where(col(Post.id).in_(post_ids))
        .values(references_extracted=True)
        .execution_options(synchronize_session=False)
    )


@dataclass(frozen=True)
class PendingCounts:
    """What a walk still has in front of it, without walking it (CRG-04).

    `pending` is every Post whose flag is unset; `eligible` is the subset a
    walk would read right now, so `deferred` is the Posts waiting on a chat id
    or on their grace to expire.

    **This is the aggregate over the pending partial index that
    `ExtractionCounts` deliberately refuses to do.** That refusal is about
    cost per *tick*: the sweep runs every few minutes forever, and during the
    first backfill the index covers the whole corpus. A dry run is one
    operator, once, before a multi-hour job — it is the number that decides
    whether to run at all, and it is worth the scan there.
    """

    pending: int = 0
    eligible: int = 0
    deferring_channels: int = 0

    @property
    def deferred(self) -> int:
        return self.pending - self.eligible


def pending_counts(session: Session, *, now: datetime | None = None) -> PendingCounts:
    """Count what `extract_batch` would do, writing nothing.

    Shares `_eligible` with the walk rather than restating it, so the dry run
    cannot report a population the real run then disagrees with — which is the
    whole reason CRG-04's script has no predicate of its own.

    **One statement, with the eligible leg as a `FILTER` rather than a second
    query.** Two counts would take two snapshots under READ COMMITTED, and the
    scraper inserts Posts the whole time this runs — every one of them pending,
    most of them eligible. So `eligible` would pick up rows `pending` never
    saw, and `deferred`, being the subtraction, would print *negative* on the
    line an operator reads to decide whether to run. One statement also walks
    the pending set once instead of twice, which matters here more than it
    looks: `_eligible` correlates a scalar subquery against `tg_channels`, so
    the walk is per row and the second pass is not free.
    """
    epoch_ms = graph_epoch_ms(session)
    cutoff_ms = grace_cutoff_ms(now=now)

    pending, eligible = session.exec(
        unscoped_select(
            select(
                func.count(),
                func.count().filter(_eligible(epoch_ms, cutoff_ms)),
            )
            .select_from(Post)
            .where(col(Post.references_extracted) == False),  # noqa: E712
            reason=_SCOPE_REASON,
        )
    ).one()

    return PendingCounts(
        pending=int(pending),
        eligible=int(eligible),
        deferring_channels=_deferring_channels(session),
    )
