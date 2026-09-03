# 28: Admin-scoped export

**What to build:** An Admin can export one User's data or everyone's, and an exported Summary still cites Posts the export contains.

**Blocked by:** 21

**Status:** done

- [x] Export is Admin-only and takes a subject
- [x] It covers the subject's Follows, Artifacts, and settings
- [x] It includes the Posts of Channels the subject Follows
- [x] It streams, and reports the row count before starting
- [x] Import routes Channel creation through the Follow path

## How

`GET /data/export?subject=` and `POST /data/import?subject=`. Absent means the
**caller**, a user id means that account, and `all` means every account — the
last one only on the export, and only through `unscoped_select(reason=...)`.

Making the default the narrow one is the behaviour change of this ticket. The
endpoint was Admin-gated and complete since long before there were two accounts,
so pressing Export downloaded every account's summaries, credentials and logs.
An export is the widest read in the deployment; reaching it by *leaving a
parameter off* is not something anybody chose.

An unshowable subject — no such account, or not a uuid at all — answers one 404
with one body. An Admin route is still not an account oracle.

### The seam grew an ungated twin

`scoped_select` is a no-op while the tenancy flag is off, which is right for a
read that derives its account from the caller and wrong for one that was *told*
the account. So `tenancy.subject_select` is the same dispatch, ungated, sharing
one `_narrow_to_owner` body with it. The rule is the one
`assert_owner_on_write` already states: **a flag may gate visibility and never
identity.**

Box 3 then costs nothing. `Post`, `PostEmbedding`, `PostTranslation` and
`SyncLog` are `FOLLOW_SCOPED`, so the seam's `EXISTS` against
`tg_channel_follows` *is* "the Posts of Channels the subject Follows" — and two
accounts following one handle both export its posts, which is what a shared
corpus means.

### One inventory, three readers

`export_sections` is the document in order; the streamer, the pre-count and the
coverage guard all walk it, so a section cannot stream without being counted and
a table cannot join `SCOPES` without somebody deciding whether a backup carries
it. `EXPORT_OMISSIONS` is the other half, with a reason each.

Four sections are new: `chat_sessions`, `tag_runs`, `discover_reports` and
`user_settings`. Before this, "Artifacts" in the export meant summaries and the
other three families History lists were simply absent from every backup.

### The count

`X-Export-Rows` carries the total and the document opens with the per-section
counts, both from one `export_row_counts` call. `StreamingResponse` sends
headers before it pulls the first chunk, which is what makes "before starting"
true rather than decorative — the guard reads the header with the body still
unconsumed.

It is a **pre-count, not a manifest**: separate statements under READ COMMITTED,
so a row written mid-export is in the body and not in the number. Pinning them
together means holding a REPEATABLE READ snapshot open for the whole transfer,
which is the `idle in transaction` cost the scheduler already paid once.

### The decision ticket 31 left here

Ticket 31 made an import per-account and recorded that ticket 28 had to
**re-take** that decision rather than inherit it — `data_import_export.py`'s
docstring said so and
`test_import_stamps_new_rows_with_the_caller_not_the_document` was built to fail
the moment export and import learned to carry a subject.

Re-taken, and reversed only where the subject made it expressible: new rows are
stamped with the **subject**, which is the caller unless an Admin named someone.
The rest of ticket 31 stands — a row owned by a *third* account is still refused
with that family's own 404, and the *document* still names no owner anywhere,
however hard a crafted file tries. What changed is that "the Admin who ran the
restore" stopped being the only answer a restore could express.

An Admin importing for somebody else binds an `ActingOwner` for the request, so
every artifact restored carries them in `acted_by_*` and shows it in that
account's History (ticket 27). An Admin restoring their own backup binds
nothing, and the stamp clears.

`import` refuses `subject=all` with a 422. A document carries no owners, so
"import for everybody" has no meaning other than "import for me", which omitting
the parameter already says — and the two requests mean different things to
whoever typed them.

### Posts that nobody could read

Ticket 21 found that `POST /data/posts/bulk` writes rows no account can see:
it creates no Channel and no Follow, and enforcement scopes Posts through the
follow. A posts-only `POST /data/import` had the same hole.

Closed for import: `_follow_handles_from_posts` follows every handle the
document's Posts name, creating the Channel where there is none, through
`ensure_follow_for_channel` like every other creation path (ticket 04) and
inside the document's single transaction. `create_followed_channel` could not be
reused — it opens its own `Session` and commits.

`POST /data/posts/bulk` deliberately keeps today's behaviour. It is the
scraper's raw ingest door, its caller already holds the Follow, and
auto-following whatever an uploaded file mentions belongs to the door that knows
it is restoring a backup. Its `EXCUSED` entry in `test_account_isolation.py`
stops deferring and says that.

### Where the guards are

`tests/api/test_admin_scoped_export.py`, 28 tests, the scoping ones parametrised
over **both flag states** because `subject_select` is ungated and a single-state
file would have passed the mutation that re-gates it. Seven mutations were run
and all seven went red; the list is in the module docstring.

Three existing guards moved with the decision rather than being deleted:
`test_import_write_scoping.py`'s battery grew the three new artifact families
and its caller-stamping test became a subject-stamping one;
`test_view_as_elevation.py`'s "the importer writes exactly one artifact family"
became "every family it writes is attributed", which is what its own failure
message told the next person to do.

## What review changed afterwards

`/code-review high` found five things (PR #170). Four were fixed; one was
measured and kept, which is the interesting one.

**The pre-count stays.** The finding was that counting every section before the
stream turns time-to-first-byte from ~0 into a scan of the largest table.
Measured on staging's 4.78M-row corpus it is **~1s**, essentially all of it
`tg_posts` (975ms unscoped, 987ms through the follow `EXISTS`); every other
table is single-digit milliseconds. A second in front of a download that then
streams for minutes is the trade this ticket asked for, and moving the counts to
the end of the document answers a question nobody still has by then. The number
is in `prepare_export`'s docstring so nobody has to re-derive it before daring
to touch the thing.

The four fixes: `X-Export-Rows` was **not exposed to CORS**, so the header whose
whole purpose is telling a browser the size of a download read back as `null` in
`fetch` — true only for `curl`, on a deployment whose dashboard is on another
host. The sections were **resolved twice** per download, once to count and once
to stream; `PreparedExport` is now the plan, built once. `updated_at` is stamped
only where the column exists, because SQLModel takes that assignment either way
and a family added later without one would read as stamped and be silently
unstamped. And `exportAccountBlob` **stopped parsing the document** — it took
the response as JSON and stringified it again, two or three copies in the tab of
a payload the server streams precisely so it never holds one.

One of the five was wrong on its facts: the review read `TagRun` as having no
`updated_at`. It has both that and `updated_at_ms`, and they mean different
things — the millisecond clock is what History renders, so a restored artifact
keeps the moment it was made, while `updated_at` records this install's write.
The asymmetry was real and undocumented, so it is now written down and asserted.

## Not done here

The frontend's Settings → Database export still asks for the caller's own rows
with the table selection applied client-side; the admin row menu gained "Export
data", which is the whole account and no filter. Nothing offers `subject=all`
from the UI — it is a deliberate operator action with `curl` or the API docs,
and putting a button on the widest read in the deployment is not an improvement.
