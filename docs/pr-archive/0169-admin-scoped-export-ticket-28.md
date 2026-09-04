# #169 📦 Admin-scoped export (ticket 28)

**State:** merged 2026-09-03 · **Branch:** `ticket-28-admin-scoped-export` into `main` · **Diff:** +2336 / -219 across 24 files · **Opened:** 2026-09-03

---

Closes ticket 28 of the multi-user tenancy programme.

`GET /data/export` was Admin-gated and complete, and about nobody in particular: it walked every table with a bare `select(Model)` and dressed the channel section in whoever happened to be asking. With two accounts, pressing Export downloaded everybody's summaries, credentials and logs.

## What changed

**Both doors take a `subject`.** Absent is the caller, a user id is that account, `all` is everybody. Making the default the narrow one is the behaviour change here, and it is the point: an export is the widest read in the deployment, and reaching it by *leaving a parameter off* is not something anybody chose. An unknown or malformed subject answers one 404 with one body — an Admin route is still not an account oracle.

**The seam grew an ungated twin.** `tenancy.subject_select` shares `scoped_select`'s dispatch and skips its flag check, because a flag may gate visibility and never identity: no state of `TENANCY_ENFORCED` makes "export user X" honestly mean everybody. The follow-scoped tables then give "the Posts of Channels the subject Follows" for free.

**One inventory, three readers.** `export_sections` is the document in order; the streamer, the pre-count and the coverage guard all walk it, and `EXPORT_OMISSIONS` says why a tenancy-scoped table is not in a backup. Four sections are new — `chat_sessions`, `tag_runs`, `discover_reports`, `user_settings` — so "Artifacts" stops meaning one of the four kinds History lists. Each gained an import door, owner-checked and attributed.

**The count arrives first.** `X-Export-Rows` carries the total and the document opens with per-section counts, both from one computation. A `StreamingResponse` sends headers before it pulls the first chunk, which is what makes "before starting" true rather than decorative. It is a pre-count under READ COMMITTED, not a manifest, and the docstring says so.

**Ticket 31's decision, re-taken rather than inherited.** New rows are stamped with the subject; an Admin importing for somebody is bound as the acting Owner, so no artifact claims that person uploaded it (ticket 27); a *third* account's existing row is still refused with that family's own 404; the document still names no owner anywhere. `subject=all` is refused on import.

**An import follows the handles its own Posts name** — the hole ticket 21 found and left here — through `follows.py` like every other creation path. `POST /data/posts/bulk` keeps raw ingest, and its excuse now says why instead of deferring.

## Frontend

`api.exportData(subject?)` and `api.importData(payload, subject?)`; an "Export data" item in the admin row menu, beside "View as", downloading that account's whole export. The Settings page's own export is unchanged. Nothing offers `subject=all` from the UI — a button on the widest read in the deployment is not an improvement.

## Verification

- `tests/api/test_admin_scoped_export.py`, 25 tests, scoping ones parametrised over **both flag states** because the new twin is ungated and a single-state file would pass the mutation that re-gates it. **Seven mutations run, all seven red**; the list is in the module docstring.
- Three existing guards moved with the decision rather than being deleted: the import battery grew the three new families, its caller-stamping test became a subject-stamping one, and `test_view_as_elevation.py`'s "the importer writes exactly one artifact family" became "every family it writes is attributed" — which is what its own failure message told the next person to do.
- **Backend suite: 2158 passed, 3 skipped.** Frontend unit: 901 passed. mypy, ty, ruff, biome, tsc all clean. Client regenerated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01Nu3cRrr3mhbRqATFjC4RQ3
