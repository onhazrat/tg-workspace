# 37. Reconcile the name-collision filter with its unique index

**Status:** ready-for-agent
**Blocked by:** None (can start immediately)

**What to build:** `_name_collision_scope_filter` and the unique index it mirrors
answer the same question the same way, so a duplicate name is refused by the
route's 409 rather than arriving as a Postgres `UniqueViolation`.

## What is open

`services/channel_setting_groups.py::_name_collision_scope_filter` (line 213)
answers "is this name already taken". It mirrors the unique index
`(COALESCE(user_id::text, 'global'), lower(name))` on
`tg_channel_setting_groups`, and it is deliberately **wider** than that index —
`me OR NULL` rather than exactly the caller's scope.

Its own docstring says why, and then says who fixes it:

> It stays *wider* than the index [...] because that is what it has always been,
> and narrowing it to match the index would start allowing names the operator has
> been prevented from using since the presets were seeded. **Ticket 22 can
> reconcile the two once the global rows are gone.**

**Ticket 22 did not make the global rows go away.** It dropped `Channel`'s
`setting_group_id` — the *Channel's* pointer at a group — not the global
`tg_channel_setting_groups` rows themselves. Those rows are still there, still
owned by nobody, and ticket 34's migration deliberately left them: a fresh
install migrates before its first superuser exists, so there is no account to
adopt them to.

So the forward reference expired the way ticket 13's did in `sync_queue.py`.
Ticket 22's implementer corrected the CLAUDE.md line rather than leave it
pointing at themselves, which was right — and it means the requirement now points
nowhere. **The docstring at `channel_setting_groups.py:236` still names ticket
22**; re-pointing it is this ticket's work, not a drive-by fix.

## Why the mismatch is not cosmetic

The filter and the index disagreeing means there is a band of names the
application believes are free and the database refuses. That surfaces as a 500
carrying a `UniqueViolation` where the route has a 409 ready — the same class of
failure as ticket 34's migration collision, arriving through a request instead of
a deploy.

It is currently masked: while the global rows exist, the wider filter catches the
collision first and answers 409 correctly. Narrowing it without settling the rows
would *unmask* the problem rather than fix it, which is why the docstring's
sequencing ("once the global rows are gone") is right even though its ticket
number is wrong.

## The decision this ticket has to take

The global preset rows are the actual subject. Three options, and the ticket must
argue for one rather than picking silently:

- **Adopt them at first-superuser creation** rather than in a migration, which is
  where ticket 34 could not reach. `init_db` runs after `alembic upgrade head`.
- **Leave them global and narrow the filter to match the index exactly**,
  accepting that names the operator could not use before become usable.
- **Leave both as they are** and delete the docstring's promise, recording that
  the mismatch is permanent and masked. A defensible answer, and better than a
  pointer that keeps moving from ticket to ticket.

`tenancy.OUT_OF_SCOPE` and ticket 30's rule both apply: the owner in a key
answers *which row is yours*, so this filter deliberately does not consult
`tenancy_enforced()` and must not become `scoped_select`. Adopting the seam here
would make a duplicate name stop being rejected while enforcement is off.

## Also in scope: one route that is two operations

Ticket 22's review found that **`PUT /data/channels/{id}` is also the
follow-an-existing-channel path**. Its first cut returned 500 for an account with
no follow yet, caught by `test_account_isolation.py`. Fixed there, but nothing
says so at the route: it reads as an edit and is also a create. Write that down
where the next person meets it — the handler, not only a ticket file. This is
here rather than in its own ticket because it is one paragraph of prose, and a
ticket per docstring is how a tracker stops being read.

## Checkboxes

- [ ] The filter and the unique index agree, or the docstring records why they permanently do not
- [ ] Whichever is chosen, the alternative is written down with why it lost
- [ ] `channel_setting_groups.py:236` no longer names ticket 22
- [ ] A guard proves a duplicate name answers 409 and never a `UniqueViolation`, for both a global-preset name and an owned one
- [ ] `PUT /data/channels/{id}` says at the handler that it is also a create
- [ ] The filter still does not consult `tenancy_enforced()` and is still not `scoped_select`

## Not in scope

Dropping `is_superuser` is a clean standalone change nobody has filed. The seam
itself is settled; this is about one identity filter that never joined it.
