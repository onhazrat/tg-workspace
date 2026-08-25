# 31: Scope the import path (migrate)

**What to build:** `POST /data/import` stops writing rows that belong to other accounts.

**Blocked by:** 17

**Status:** ready-for-agent

- [ ] Importing an id another account owns does not overwrite that row
- [ ] The decision about whether an Admin may import *for* another account is written down, not implied
- [ ] Bot credentials and chat destinations are covered, not just artifacts
- [ ] Both flag states are green

## Why this is its own ticket

Found by review during ticket 17. That ticket's own argument is that **a scoped
read over a writable row is half a fix** — `upsert_*` merges into whatever row
its id names, so scoping only the read lets a second account overwrite the
first's summary by guessing an id. Ticket 17 closed that for the four artifact
families' own endpoints and did **not** close it for import, which reaches the
same tables by a different door.

`routes/data/admin.py::import_data` takes a plain `CurrentUser` with no
permission gate. `services/data_import_export.py` then does a bare
`session.get(Model, id)` and overwrites:

- `_import_summaries` (line ~209) — text, channels, dates, `extra`
- `_import_bot_credentials` (line ~281) — **these carry tokens**
- `_import_chat_destinations` (line ~312)

So `POST /data/import` with `{"summaries": [{"id": "<their id>", "text": "…"}]}`
rewrites another account's summary today, and will still do it after ticket 21
flips `TENANCY_ENFORCED`, because this path never consults the seam at all.

## Why ticket 17 did not just add `assert_owner`

Because the honest answer is not obvious, and guessing it in a ticket about
row *visibility* would have hidden the decision inside a drive-by fix.

Import is the other half of export, and the plan's **decision 6** makes export
Admin-only "for themselves **or for all users**". If an Admin may export every
account's data, restoring that backup necessarily writes rows they do not own —
which is exactly what `assert_owner` would refuse. So there are two coherent
designs and they are not the same ticket:

1. **Import is per-account.** Every write goes through `assert_owner`; an id
   belonging to someone else is a 404, the same answer its own endpoint gives.
   A full-deployment restore then needs a separate Admin path.
2. **Import is Admin-capable.** A caller with the export permission may write
   across accounts, through `unscoped_select`'s write-side equivalent with the
   reason stated at the call site, and everyone else is scoped as in (1).

(2) is probably right, because a restore that cannot restore is not a restore —
but it needs the permission constant that ticket 28 introduces, which is why
this is blocked by neither 17 alone nor 28 alone. Pick one, write down why, and
make the guard assert the reason rather than the state.

## Note for ticket 21

Ticket 21 flips the flag. This hole is **not** closed by the flip — it is
invisible to the seam — so flipping does not create it and does not fix it. It
belongs on 21's list the way ticket 30 does: a known cross-account write that
should be closed before the deployment has a second account that matters, not a
reason to hold the flag.
