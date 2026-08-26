# 31: Scope the import path (migrate)

**What to build:** `POST /data/import` stops writing rows that belong to other accounts.

**Blocked by:** 17

**Status:** done

- [x] Importing an id another account owns does not overwrite that row
- [x] The decision about whether an Admin may import *for* another account is written down, not implied
- [x] Bot credentials and chat destinations are covered, not just artifacts
- [x] Both flag states are green

## What was decided

**Design (1): import is per-account.** A row that already belongs to another
account is refused with that family's own 404, and the refusal is **not gated on
`TENANCY_ENFORCED`**.

Design (2) was not taken, and the reason turned out to be narrower than the
ticket's framing. **An import cannot express another account's ownership in the
first place**: every importer stamps a new row with the *caller's* id and the
export document carries no owner at all, so a restore into an empty database
already files every account's rows under whoever ran it. Refusing to overwrite a
foreign *existing* row therefore takes away nothing that worked, and no
permission constant was needed — ticket 28 is where export and import learn to
carry a subject, and that is the ticket that gets to re-take this decision.
`test_import_stamps_new_rows_with_the_caller_not_the_document` asserts that
premise so 28 cannot inherit the decision by accident.

Ungated for ticket 30's reason: the question is "is this row mine", not "may I
see it", and a flag cannot gate identity. It costs nothing — a single-account
deployment has no foreign row to refuse. A **NULL owner stays writable while the
flag is off**, because legacy and background-job rows carry no stamp and
refusing them would break the operator's own restore today.

The route's `Permission.DATA_ADMIN` gate (ticket 18) was already there and is
not this answer: it decides who may call import, not whose rows the call lands
on.

## What it covers

Checked: `Summary`, `BotCredential`, `ChatDestination`, and the three personal
log families. Excused with a reason each (`IMPORT_WRITES` in
`data_import_export.py`): the payload children, sync logs (Channel telemetry,
ticket 19), network logs (proxy behaviour, decision 23), the follow-scoped
corpus, and setting groups.

**`POST /data/bot-credentials/migrate` was covered too.** It is the same bulk
credential import merged by id, it carries tokens, and unlike `/data/import` it
is not even Admin-gated — closing one door and leaving that one open is the
"reaches the same tables by a different door" mistake this ticket exists to
correct.

## Widened after review, deliberately

The first cut closed the import door and left nine other by-id write paths on
the flag-**gated** `assert_owner`, which made this ticket's own premise false:
`PUT /data/summaries/{id}`, `POST /data/logs/{type}` and
`PUT /data/bot-credentials/{id}` are all plain `CurrentUser` with no permission
gate, and all three still rewrote another account's row on the shipping config.
Shipping a primitive whose docstring says the write question is never gated,
beside nine writes that gate it, is two answers to one question — the drift the
seam exists to prevent.

So one rule now holds everywhere: **a by-id read stays gated, a by-id write or
delete does not.** Ungated: `upsert_summary`, `delete_summary`, the same pair for
chat sessions and tag runs, `update_report_flags`, `delete_report`,
`create_logs`, and the four credential-family writes, which had no check at all.
Still gated, because refusing to *show* a row is a visibility change and that is
what the flag defers: `get_summary`, `get_chat_session`, `get_tag_run`,
`get_report`, `get_log`, `get_job`.

## Left open — needs its own ticket

`list_bot_credentials` and `list_chat_destinations` are unscoped **reads**. The
writes are closed above; the reads are a flag-gated seam adoption of exactly the
shape tickets 15 to 20 each did for one family, and no ticket covers these two.
That is the remaining gap, and it is ticket 21's problem or a new ticket's, not
this one's.

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

## For ticket 21: an unstamped row now blocks a restore under enforcement

Found by review, and worth carrying rather than fixing here. Once the flag
flips, `assert_owner_on_write` refuses an `owner_id is None` row, and an import
is **one transaction** — so the *first* ownerless row aborts the whole document.
A backup taken before the `user_id` stamp existed, or containing any log row a
background job wrote (`user_id` is nullable on all five log tables and every
`upsert_*` takes it as optional), no longer restores. It answers
`"Summary not found"` and nothing lands.

`test_an_ownerless_row_is_refused_under_enforcement` encodes this as intended,
because the alternative — letting a write silently *adopt* an unowned row — hands
ownership to whoever imports first, and the flag is exactly when that stops being
harmless. So ticket 21 needs an owner backfill for these tables in its migration,
the way ticket 30's migration settled dismissal owners and ticket 20's adopted
legacy Discover reports. Deferring it leaves a restore path that works today and
breaks on the flip.

## Note for ticket 21

Ticket 21 flips the flag. This hole is **not** closed by the flip — it is
invisible to the seam — so flipping does not create it and does not fix it. It
belongs on 21's list the way ticket 30 does: a known cross-account write that
should be closed before the deployment has a second account that matters, not a
reason to hold the flag.
