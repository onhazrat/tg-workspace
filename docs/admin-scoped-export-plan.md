# Admin-scoped export (ticket 28)

**What to build:** An Admin can export one User's data or everyone's, and an exported Summary still
cites Posts the export contains.

- [x] Export is Admin-only and takes a subject
- [x] It covers the subject's Follows, Artifacts, and settings
- [x] It includes the Posts of Channels the subject Follows
- [x] It streams, and reports the row count before starting
- [x] Import routes Channel creation through the Follow path

**Done.** The narrative of what shipped, and the decisions as they were finally
taken, is in `.scratch/multi-user-tenancy/issues/28-admin-scoped-export.md`;
this file is the plan it was built from and the reasoning behind each choice.

## Where this starts

`GET /data/export` is already `DATA_ADMIN`-gated and already streams. What it does *not* do is
choose whose rows it carries: `_stream_export_body` walks each table with a bare `select(Model)`
and emits the lot. The one per-account thing in the document is the Channel section, which reads
the *caller's* Follow for the six fields ticket 22 moved off `Channel` — so today's export is
"every account's rows, wearing my follows".

`POST /data/import` stamps every new row with the caller and refuses to overwrite a row that
belongs to somebody else (ticket 31). `data_import_export.py`'s own docstring says ticket 28 is
where that decision gets re-taken, and
`test_import_stamps_new_rows_with_the_caller_not_the_document` exists to make it come back rather
than be inherited silently.

## The decisions

### 1. A subject, and "everyone" has to be asked for by name

`subject` is a query parameter on both routes:

| `subject` | Export carries |
|---|---|
| omitted | the caller's own rows |
| a user id | that account's rows |
| `all` | every account's rows — today's document, unchanged |

The default is the caller rather than everyone, which is a behaviour change on an endpoint that
has existed for months. It is the right one: an export is the widest read in the deployment, and a
read that crosses accounts should have to say so. `subject=all` is the escape hatch and it is
`unscoped_select(reason=...)` underneath, which is the greppable form this codebase already uses
for exactly this.

An unknown or malformed subject is a 404 — the same answer the tenancy seam gives for a row that is
not yours, and for the same reason: an Admin route is still not an account oracle.

### 2. Import takes the same subject, and records who really wrote it

The rationale doc requires this ticket to re-take ticket 31's decision instead of inheriting it.
It is re-taken and reversed *for an Admin who names a subject*: `POST /data/import?subject=X`
stamps new rows with X, because an export that carries a subject and an import that cannot restore
it is half a feature. Ticket 31's rule survives untouched for everything else — the default subject
is still the caller, and a row already owned by a *third* account is still refused with that
family's own 404.

An Admin importing for somebody else is a write on another person's behalf, which ticket 27 already
has an answer for: the route binds an `ActingOwner` for the caller, so every artifact the document
restores records the Admin in `acted_by_*` and the User's History says so. Without that, a restore
would silently claim the User wrote rows an Admin uploaded.

### 3. Scoping is the seam, ungated

`scoped_select` is a no-op while `TENANCY_ENFORCED` is off, which is right for a read that derives
its subject from the caller and wrong for one that was *told* the subject. "Export user X" must
answer X's rows in both flag states, the same way `assert_owner_on_write` is ungated: **a flag may
gate visibility and never identity.**

So `tenancy.py` grows `subject_select`, the ungated twin of `scoped_select` sharing one dispatch
body. Both name a model class; neither call site writes `.where(Model.user_id == ...)`.

That gives box 3 for free: `Post`, `PostEmbedding`, `PostTranslation` and `SyncLog` are
`FOLLOW_SCOPED`, so the seam's `EXISTS` against `tg_channel_follows` *is* "the Posts of Channels the
subject Follows".

### 4. One inventory, three readers

The section list becomes a declared tuple — key, model, serialiser, optional join — and the
streamer, the counter and the guard all walk it. A user-owned table that is in `SCOPES` and in
neither the inventory nor a written excuse fails the guard, which is the only moment when "should
this be in a backup?" is cheap to ask.

New sections, all of them the subject's own rows: `chat_sessions`, `tag_runs`,
`discover_reports`, `user_settings`. With `summaries` that is all four artifact families, so
"covers the subject's Artifacts" stops meaning "one of the four kinds History shows".

### 5. The count is a pre-count, and it says so

`X-Export-Rows` is set from `export_row_counts` before the first byte of the body, and the same
dict is emitted as `"counts"` in the document ahead of `"data"`. Headers of a `StreamingResponse`
go out before the generator runs, which is what makes "before starting" true for a client that has
not parsed anything yet.

It is one `COUNT(*)` per section under READ COMMITTED, so a row written *during* a long export is
in the body and not in the count. That is a progress figure, not a manifest, and the docstring says
so rather than pretending to a consistency the isolation level does not give.

### 6. Import creates a Follow for the handles its Posts name

Ticket 21 left this here: `POST /data/posts/bulk` writes Posts for handles nobody follows, so under
enforcement they are invisible until somebody follows separately. A *posts-only* import through
`POST /data/import` had the same hole, because only the `channels` section creates Channels.

The decision: **an import follows every handle its own document mentions**, through
`follows.py` like every other creation path (ticket 04), because a restore that leaves its own rows
unreadable is not a restore. `POST /data/posts/bulk` keeps its raw-ingest behaviour — it is the
scraper's door, its caller already holds the Follow, and auto-following an uploaded file's handles
is not something a low-level ingest endpoint should decide. Its `EXCUSED` entry stops deferring to
this ticket and states that.

## Work — all done

1. `tenancy.py`: extract the dispatch, add `subject_select`.
2. `data_import_export.py`: `ExportSubject`, `EXPORT_SECTIONS`, `export_row_counts`, scoped
   streaming, four new sections, four new importers, Follows for imported Posts.
3. `user_settings.py`: a non-committing write, so an import stays one transaction.
4. `routes/data/admin.py`: `subject` on both routes, the count header, the acting-owner bind.
5. Guards: `tests/api/test_admin_scoped_export.py` for the five boxes; update
   `test_export_streaming.py`, `test_account_isolation.py`'s two excuses,
   `test_view_as_elevation.py`'s one-family assertion, `test_import_write_scoping.py`'s
   caller-stamping test.
6. Frontend: `subject` on `api.exportData`, an "Export data" item in the admin row menu, client
   regenerated.
