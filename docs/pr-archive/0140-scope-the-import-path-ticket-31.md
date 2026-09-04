# #140 🔒 Scope the import path (ticket 31)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-31-scope-import` into `main` · **Diff:** +1566 / -56 across 14 files · **Opened:** 2026-08-26

---

`POST /data/import` reached `Summary`, `BotCredential`, `ChatDestination` and the log tables through a bare `session.get(Model, id)` and an overwrite, with no owner check underneath. Importing an id another account owned rewrote that row — including its **bot token** — and because every log `upsert_*` assigns `user_id` on its existing branch too, the clobber was a *takeover*, not only a rewrite. Ticket 17 closed this for the four artifact families' own endpoints and left the import door open; that is why ticket 31 exists.

## The decision, which was the actual work

**Import is per-account.** A row already belonging to somebody else is refused with that family's own 404, and the refusal is **not gated on the tenancy flag**.

The ticket offered a second design — let an Admin write across accounts, since a restore that cannot restore is not a restore. Not taken, for a narrower reason than a preference: **an import cannot express another account's ownership in the first place.** Every importer stamps a new row with the *caller's* id and an export document carries no owner at all, so a restore into an empty database already files every account's rows under whoever ran it. Refusing a foreign *existing* row takes away nothing that worked, and needs no new permission constant. Ticket 28 is where export and import learn to carry a subject; `test_import_stamps_new_rows_with_the_caller_not_the_document` fails the moment they do, so 28 has to re-take the decision rather than inherit it.

The route's `DATA_ADMIN` gate (ticket 18) is not this answer: it decides who may *call* import, never whose rows the call lands on.

**Ungated**, for ticket 30's reason — the question is whether the row is yours, not whether you may see it, and a flag cannot gate identity. It costs nothing: a single-account deployment has no foreign row to refuse. The one flag-dependent half is NULL — an unstamped row stays writable while the flag is off, since legacy and background-job rows carry no owner and refusing them would fail closed against the only account a single-operator install has.

## Widened after review, deliberately

The first commit closed the import door and left **nine** other by-id writes on the flag-*gated* `assert_owner`, which made this ticket's own premise false. Three sit behind routes with no permission gate at all: on the shipping config, `PUT /data/summaries/{id}` naming another account's id rewrote that summary, `POST /data/logs/{type}` rewrote another account's log row and reassigned `user_id` with it, and `PUT /data/bot-credentials/{id}` replaced a stored **bot token** — that family had no check at all, not a gated one, none.

So one rule now holds everywhere: **a by-id read may be gated, a by-id write or delete may not.**

- Ungated: `upsert_summary`, `delete_summary`, the same pair for chat sessions and tag runs, `update_report_flags`, `delete_report`, `create_logs`, and the four credential-family writes.
- Still gated, because refusing to *show* a row is a visibility change and that is exactly what the flag defers: `get_summary`, `get_chat_session`, `get_tag_run`, `get_report`, `get_log`, `_visible_job`.

`test_only_reads_use_the_gated_ownership_guard` pins that split by walking `app/`.

Deferring the credential families was the first cut's mistake. The reasoning was that scoping a write without its read is the half-fix ticket 17 names — but that ticket's half-fix was scoping a *read* and leaving the write, the opposite direction. The write is identity and ungated; the read is visibility and gated. They are separable, and only one of them lets a stranger replace a token.

## Coverage

`IMPORT_WRITES` places or excuses every table the import writes, and its guard now walks the module AST rather than comparing two hard-coded sets — a new `_import_*` section writing an unplaced table fails it. `INDIRECT_WRITES` records the two tables reached through another aggregate's writer, keyed by string so naming `ChannelFollow` does not trip the one-writer guard, which is right to match the bare identifier and whose own comment predicts this false positive.

The two log doors had disagreed: `create_logs` owner-checks every non-follow-scoped type, network included, while the import gated on `PERSONAL_LOG_TYPES` and excused network. That is a *retention* partition, and borrowing it to answer a write-authority question was the category error. Both doors now ask the seam. Sync logs stay excused with the reason stated — they carry no owner, and the API door's follow check is create-only, which a restore cannot adopt without refusing every re-import.

**`POST /data/bot-credentials/migrate` is covered too**: the same bulk credential import merged by id, carrying tokens, and not even Admin-gated.

## Verification

- `test_import_write_scoping.py` — 89 guards, the behavioural ones parametrised over **both** flag states
- Full backend suite, flag off: **1686 passed, 2 skipped**
- Full backend suite, flag forced on: failure set identical to `origin/main`'s except one deliberate off-state assertion in `test_tenancy_seam.py`, which joins the group that file already keeps for that purpose
- mypy strict, `ty` (no new diagnostics against baseline), ruff, all pre-commit hooks green including the frontend SDK check

**Sixteen mutations run.** Thirteen went red as predicted, including gating the check behind the flag, which fails *only* the flag-off parametrisations — the half-fix signature ticket 30 named. **Three were watched passing, and each one changed the work:**

- pinning a detail string against the constant the production code uses moves with it. The guard now compares the import refusal against what that family's endpoint answers for a genuinely absent id — two independent paths.
- placing the check after the mutation passes, and correctly: the document is one transaction and nothing commits on the way to the raise. That claim was removed rather than propped up with a test that cannot fail.
- re-gating `upsert_summary`, and separately deleting the credential checks, passed everything — because the review fixes had shipped with no guard holding them. Review caught the fixes; the mutations caught that nothing was keeping them.

## Carried forward, not fixed here

- **Ticket 21 needs an owner backfill.** Under enforcement `assert_owner_on_write` refuses a NULL owner, and an import is one transaction — so the *first* ownerless row aborts a whole restore. Letting a write silently *adopt* an unowned row hands ownership to whoever imports first, which is worse. Written into ticket 31's file for 21 to pick up.
- **`list_bot_credentials` / `list_chat_destinations` are unscoped reads.** The writes are closed; the reads are a flag-gated seam adoption of the shape tickets 15–20 each did for one family, and no ticket covers these two.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
