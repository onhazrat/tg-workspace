# 30: Per-account Discover dismissals

**What to build:** Dismissing a Discover candidate is your judgement, not everybody's. `tg_discover_ignored` gains the owner half of its primary key so two accounts can dismiss and un-dismiss the same handle independently.

**Blocked by:** 03

**Blocks:** 21

**Status:** ready-for-agent

- [ ] The table is keyed by `(handle, user_id)`, with a cascading foreign key and existing rows backfilled to an owner
- [ ] Dismissing, listing, and undoing all read and write the caller's own rows
- [ ] Two accounts can hold opposite verdicts on one handle, and neither can see the other's
- [ ] Both flag states are green

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
