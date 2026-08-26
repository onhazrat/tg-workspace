# 30: Per-account Discover dismissals

**What to build:** Dismissing a Discover candidate is your judgement, not everybody's. `tg_discover_ignored` gains the owner half of its primary key so two accounts can dismiss and un-dismiss the same handle independently.

**Blocked by:** 03

**Blocks:** 21

**Status:** done

- [x] The table is keyed by `(handle, user_id)`, with a cascading foreign key and existing rows backfilled to an owner
- [x] Dismissing, listing, and undoing all read and write the caller's own rows
- [x] Two accounts can hold opposite verdicts on one handle, and neither can see the other's
- [x] Both flag states are green

## Why this is its own ticket

Ticket 16 scoped the feed, lookup, counts and Discover, and deliberately stopped
short of this one read. `DiscoverIgnoredChannel` is classified `USER_OWNED` in
`services/tenancy.py`, so the seam already says these rows belong to somebody —
but the table's primary key is `handle` **alone**, and `user_id` is a nullable,
unconstrained column nothing reads. Making dismissals per-account is therefore a
migration, not a call-site change: composite primary key, a real cascading
foreign key, and a backfill of the existing rows to an owner. That is the shape
ticket 06 used for the settings split, and it does not belong inside a ticket
whose promise was that no response changes.

**Do not "finish" this by adding `scoped_select` to the read.** Scoping only the
read is worse than leaving the table alone, because the write is idempotent
against a global key: `ignore_channels` skips any handle that already has a row.
So once A dismisses `@foo`, B's dismissal writes nothing at all, and a scoped
read then tells B the handle is not dismissed. B would be unable to ever dismiss
it, and the button would silently do nothing — a functional regression, not a
visibility one. The read and the key have to move together.

`unignore_channels` has the same coupling from the other side: it resolves a row
with `session.get(DiscoverIgnoredChannel, handle)`, a single-value primary-key
lookup that stops compiling the moment the key is composite. That is a useful
property — the type checker will find the call sites rather than leaving one
deleting another account's dismissal.

## Why it blocks 21

While the flag is off this is invisible, which is why ticket 16 could leave it.
The moment ticket 21 flips `TENANCY_ENFORCED`, `isIgnored` on every account's
Discover candidates and saved reports reflects **everyone's** dismissals — both a
wrong answer for the caller and a fact about another account's judgement, which
is the same leak ticket 16 closed for `isFollowed`. It is one boolean rather than
a row of content, so it is not a reason to hold the whole programme; it is a
reason not to flip the flag with it still open.

## Notes for whoever takes it

- `ignored_handles(session)` is read from two places: `discover.compute_discover_candidates`
  (live candidates) and `discover_reports.report_to_camel` (saved reports). Both
  already have the caller's id in hand after ticket 16 — `user_id` and
  `viewer_id` respectively — so the threading is done; only the aggregate needs
  to accept it.
- A backfill needs an owner for rows written before the stamp existed. The
  established answer is `follows.resolve_follow_owner`'s rule — the row's own
  `user_id`, else the first superuser — and **not** a nullable owner, which is
  the `operator.py` ambiguity the plan's decision 24 dissolves. A composite
  primary key cannot contain NULL, so this has to be settled by the migration
  rather than deferred to the readers.
- Worth checking whether a dismissal should survive as a deployment-wide default
  when there is exactly one account, or whether every account starts clean. The
  spec's list of eighteen per-User tables names "ignored Channels", so clean is
  the default reading, but say so in the ticket comments either way.

## Comments

**Every account starts clean; the existing rows go to the operator.** The ticket
asked for this to be settled either way. A dismissal is personal from here on —
the spec's list of per-User tables names "ignored Channels", so it is not a
deployment-wide default that new accounts inherit. The rows that already exist
are adopted by the operator rather than dropped, because on the single-operator
deployment this migrates, the operator is who made them.

**The owner filter is not `scoped_select`, deliberately.** Every other tenancy
batch is gated on the flag so it stays byte-identical until ticket 21. This one
cannot be: the owner is half the primary key, so filtering on it answers an
*identity* question (which row is yours), not a *visibility* one (which rows may
you see). Gated off, two accounts collide on one row again and the composite key
is decoration — `ignore_channels` would go back to skipping a handle another
account had already dismissed. So `discover_ignored.py` filters on `user_id`
directly and every guard is parametrised over both flag states, which is what
the fourth checkbox asks for.

Mutation-tested before being trusted. Gating the filter behind the flag fails
**only** the flag-off variants (5 of them) while every flag-on variant still
passes — that is precisely the shape a read-only half-fix takes, and the reason
the ticket refuses it.

**Migration branches verified against real rows**, not just round-tripped: a NULL
stamp and an id left behind by a deleted account both adopt the operator (the
orphan is the case that would otherwise abort the FK creation), a row with a live
owner keeps it, and a database with no account at all drops its rows rather than
leaving them unkeyable. It completes in one pass — alembic stamps a revision and
never re-runs it, so nothing is left "for the next deploy".

**Correction to the ticket's own note: the composite key does not break the
build.** The ticket predicted `session.get(DiscoverIgnoredChannel, handle)`
would "stop compiling the moment the key is composite", and treated that as the
property which would find the call site. It is not true — reverting that line
passes `mypy --strict` and `ty check` and fails only at runtime, as a 500 on
`DELETE /data/discover/ignored`. The call site was found by reading for it, and
what holds it is `test_undoing_never_reaches_another_accounts_dismissal`. Caught
in review; the docstring now points at the test rather than crediting the type
checker with a check it does not perform.

**The no-owner branch raises instead of deleting.** The first cut dropped every
row when no account could be resolved, justifying it in prose as unreachable
with a non-empty table. Nothing checked that, and the branch is more reachable
than it looked: since ticket 18 moved authorisation onto RBAC roles, nothing
reads `is_superuser`, so an operator clearing it breaks nothing visible until
this migration reads it as "no accounts exist" and silently deletes the
deployment's dismissals on the next `prestart.sh`. It now counts first and
refuses, naming the fix. The empty-table case — a fresh install migrated before
its first superuser — still completes silently, which is the case the prose
actually described.
