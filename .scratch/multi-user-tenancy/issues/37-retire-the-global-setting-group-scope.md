# 37. Retire the global setting-group scope

**Status:** done
**Blocked by:** None (can start immediately)

**What to build:** `services/channel_setting_groups.py` stops carrying a scope
that the schema no longer permits, and `_name_collision_scope_filter` says in its
own docstring why it still refuses the tenancy seam.

## This ticket was rewritten on 2026-09-04, and here is why

The first cut asked for a three-way decision about the ownerless preset rows in
`tg_channel_setting_groups`: adopt them at first-superuser creation, leave them
and narrow the filter, or leave both and delete the promise. That decision no
longer exists. **The rows are gone.**

`app/alembic/versions/d2e3f4a5b6c7_non_null_owners_ticket_21.py` (commit
`0f7f91e`, on `main`) does two things to the table:

- `_drop_unreferenced_global_groups` deletes every `user_id IS NULL` row, and
  checks rather than assumes: a row goes only if no `tg_channels` and no
  `tg_channel_follows` row points at it. Anything still referenced is left and
  the migration refuses the deploy with the table and count named.
- `_set_not_null` then `_add_owner_fk` make `user_id` `NOT NULL` with a cascading
  key to `"user"(id)`.

`models_tg.py` agrees: the field is `user_id: uuid.UUID`, not `| None`.

So the original ticket was stale in exactly the way it accused its own docstring
of being. That is worth saying out loud rather than quietly deleting, because it
is the second forward reference in this tracker to expire between filing and
pickup (ticket 13's in `sync_queue.py` was the first), and the lesson is the same
one: **a requirement that names a future ticket is a requirement nobody owns.**

## What is actually left

Five items, and none of them is a decision about rows.

**1. A dead branch in the filter.** `_name_collision_scope_filter`
(`channel_setting_groups.py:213`) returns `me OR user_id IS NULL`. The second leg
cannot match a row any more. Narrowing it to `user_id == me` is a no-op change to
behaviour: nothing becomes newly available, because no global row was blocking a
name. The old ticket's fear ("narrowing would start allowing names the operator
has been prevented from using") was correct when it was written and is not now.

**2. The `None` scope is unreachable everywhere in the module.**
`scope_key(None)` still answers `"global"` (line 179), and it feeds the five
reserved-id builders (`default_group_id_for_user` and its four siblings, lines
183 to 200), so `default-global` is still a constructible id for a row that
cannot be inserted. `_legacy_duplicate_reserved_groups` (line 250),
`_find_group_by_name_ci` (line 687) and `_reject_duplicate_group_name` (line 708)
all still take `uuid.UUID | None`.

**3. The docstring at `channel_setting_groups.py:236` still names ticket 22**,
which never had this work. Re-pointing it is this ticket's job.

**4. `CLAUDE.md:72` is wrong on both clauses.** It reads *"The columns stay
nullable, and eliminating the `user_id=None` creation paths is still open."*
Ticket 21 made all fourteen `NOT NULL`. Whether every `user_id=None` creation
path is gone is a separate claim, so check it before rewriting the line rather
than asserting the opposite by symmetry.

**5. The unique index still wraps a column that cannot be NULL.** It is
`(COALESCE(user_id::text, 'global'), lower(name))`, created by
`n6o7p8q9r0s1_builtin_presets_and_unique_group_names.py:166` and never touched
since.

## The one decision this ticket takes

Item 5, and the recommendation is **leave the index alone and write down why**.

Rewriting it to `(user_id, lower(name))` buys a uuid comparison instead of a text
one and removes a `COALESCE` that reads as a live case when it is a fossil. It
costs a migration that drops and rebuilds a unique index under `ACCESS
EXCLUSIVE`, on a table whose correctness currently depends on that index being
present, for no behavioural gain. That is a bad trade on its own, and the
alternative is free: a sentence in the filter's docstring saying the `COALESCE`
is vestigial and the two now agree.

**Argue the losing side in the docstring, not only here.** The old ticket's whole
failure mode was a promise in code that pointed at a ticket file, and a ticket
file is not where the next reader is standing.

## The rule that did not change

The filter answers *which row is yours*, which is identity. It must not consult
`tenancy_enforced()` and must not become `scoped_select`. Ticket 30's rule and
`tenancy.OUT_OF_SCOPE` both still apply, and adopting the seam here would make a
duplicate name stop being rejected while enforcement is off, arriving as a
Postgres `UniqueViolation` instead of the route's 409.

**Narrowing the filter makes this harder to see, not easier.** Once the `OR NULL`
leg is gone the body is `ChannelSettingGroup.user_id == user_id`, which is
byte-for-byte what a scoped read looks like, and the next person simplifying this
module will reach for `scoped_select` on sight. So the guard has to assert the
*reason*, in the pattern `client-split.conform.ts` set: a test that fails if this
function starts calling `tenancy_enforced()` or `scoped_select`, not only a test
that the current query is right.

## Also in scope: one route that is two operations

`PUT /data/channels/{id}` is also the follow-an-existing-channel path. The
handler is `upsert_channel` at `app/api/routes/data/channels.py:207` and it
carries **no docstring at all**, so the name is the only hint and "upsert" does
not say that the create half is a Follow rather than a Channel. Ticket 22's first
cut returned 500 for an account with no follow yet, caught by
`test_account_isolation.py`. Write it at the handler.

This is here rather than in its own ticket because it is one paragraph of prose,
and a ticket per docstring is how a tracker stops being read.

## Checkboxes

- [x] `_name_collision_scope_filter` matches the index exactly, and its docstring
      records that the index's `COALESCE` is vestigial and why it was left
- [x] The `None` scope is gone from the module: `scope_key`, the five reserved-id
      builders, and the three private helpers no longer accept `uuid.UUID | None`
- [x] `channel_setting_groups.py:236` no longer names ticket 22
- [x] `CLAUDE.md:72` states what is true, with the `user_id=None` creation-path
      claim verified rather than inverted
- [x] A guard proves a duplicate name answers 409 and never a `UniqueViolation`,
      for a reserved preset name and an owned one, and proves the filter still
      consults neither `tenancy_enforced()` nor `scoped_select`
- [x] `upsert_channel` says at the handler that it is also a create, and that the
      thing created is a Follow
- [x] The guard was mutation-tested: each assertion watched to go red

## Not in scope

- **Rewriting the unique index.** Argued above. If the implementer disagrees,
  the argument belongs in the ticket before the migration, not after it.
- **`_find_group_by_name_ci` reads every group in the scope and lowercases in
  Python** (line 693) rather than pushing `lower(name) = :n` into SQL, which is
  what the index is built on. Real, separate, and unrelated to ownership. File it
  if you want it.
- **Dropping `is_superuser`.** Still a clean standalone change nobody has filed.

## One thing to check before starting, and its answer

The migration is on `main`, which says nothing about whether a given deployment
has run it. If staging had not deployed past `d2e3f4a5b6c7`, its
`tg_channel_setting_groups` would still hold ownerless rows and the narrowed
filter would behave there the way the original ticket feared.

**Checked on 2026-09-04, and it is clear.** Staging's `alembic_version` is
`a2b3c4d5e6f7`, the head of the local chain and eight revisions past
`d2e3f4a5b6c7`; deployed commit `2165235` (#175). Read against its real data
rather than inferred from the revision: `tg_channel_setting_groups` holds **0**
rows with `user_id IS NULL`, and `information_schema` reports the column
`is_nullable = NO`.

That is the read worth repeating rather than the revision id. A revision number
says a migration ran; the row count and the nullability say what it did.


## What was done

`_name_collision_scope_filter` is `user_id == me` and nothing else, and its
docstring carries both halves of the argument: that the index's `COALESCE` is a
fossil the two now agree through, and why the index was left alone. `scope_key`
answers `str(user_id)`, the five reserved-id builders and the three private name
helpers take a `uuid.UUID`, and `default-global` is no longer a constructible id.
`create_setting_group`'s docstring already claimed "the owner is non-optional for
the reason the five constructors above are"; it is true now.

The index was **not** rewritten, on the argument above.

`tests/services/test_setting_group_name_identity.py` is the guard, and it is a
row in `CLAUDE.md`'s table. Six mutations were applied and each watched to fail
the one row that names it: restoring the `IS NULL` leg, widening the filter to
every row, narrowing it to somebody else's rows, routing it through
`tenancy_enforced()`, reintroducing an optional owner on `scope_key`, and
dropping the collision check from the rename path.

`CLAUDE.md:72` no longer says the columns are nullable. The `user_id=None`
creation-path clause was checked rather than inverted: the remaining `| None`
owners in `app/` are `ExportSubject.everyone()` and the settings facade's
deployment-global keys, neither of which creates a user-owned row, and the
columns being `NOT NULL` with cascading keys settles the rest by construction.

`upsert_channel` at `api/routes/data/channels.py` now says at the handler that it
is also a create and that the thing created is a Follow. The service already
carried the reasoning inline; the route, which is where a reader meets it, had no
docstring at all.
