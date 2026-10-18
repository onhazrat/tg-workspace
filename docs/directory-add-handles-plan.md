# Add handles to the Directory

An Operator pastes handles or t.me links and the Directory queues them for a
fetch, without following any of them. It is the Channels tab's Follow box with a
different action. Settled in a grilling session on 2026-10-18.

## Decisions

1. **Only `DATA_ADMIN` may add.** Fetches spend the deployment's proxies and no
   Account's Telegram Budget, so an ungated paste from one Account costs every
   Account. Same gate as the Priority boost. View-as is refused with no entry,
   because it is a write.
2. **One new band, `NAMED_PRIORITY = 1_750_000`**, between `HARVEST_PRIORITY`
   (1.5M) and `REFRESH_PRIORITY` (2M), one value for the whole paste. At one
   value the drain order falls through to `handle`, as it does for harvest. An
   Operator who wants a paste sooner uses the Priority boost.
3. **A handle the Directory already holds is skipped.** A verdict stays as it
   is (Refresh exists for that); a pending handle keeps the better of its two
   ranks. This is `enqueue_handles`' existing behaviour.
4. **No lookup while typing.** The box marks only "not a handle"; the server
   answers with counts after the click.
5. **No origin column, no "just added" view.** Pending entries are found with
   the existing `status == unknown` filter.

## Backend

- `channel_directory.py`: add `NAMED_PRIORITY` with its argument beside the
  other bands.
- `enqueue_handles` must hold 100,000 handles. Today it fails past 65,535,
  because `col(DirectoryEntry.handle).in_(...)` sends one bind parameter per
  handle, and it builds one ORM object per new row. Filter with
  `handle == any_(array)` (the pattern `directory_reads` uses) and insert new
  rows with one `INSERT ... ON CONFLICT DO NOTHING`. The report and harvest
  callers get the fix too. Keep the return value (how many were queued) and the
  better-rank update for pending rows.
- `POST /data/directory/add`, `DATA_ADMIN`, in `api/routes/data/directory.py`.
  Request `handles: list[str]`, at most 100,000, in `schemas/directory.py`.
  The server normalises each with `normalize_handle` and checks it with
  `telegram_web.is_channel_handle`, which is the authority (the client check is
  a hint). Response `{added, alreadyInDirectory, invalid}`.
- Regenerate the client; add the route to the isolation and route inventories
  the guards demand.

## Frontend

- `parsePastedHandles` takes a generic known set and returns `"known"` instead
  of `"following"`. Its `HANDLE` regex becomes the server's,
  `^[A-Za-z][A-Za-z0-9_]{4,31}$`. Reserved paths stay server-only and arrive in
  `invalid`. This also stops the Follow box offering a 4-character handle.
- Extract `HandlePasteBox` (textarea, parsed rows, submit, a slot for extra
  controls) from `FollowPasteBox`. `FollowPasteBox` becomes a wrapper that puts
  the Setting group select in the slot; its behaviour does not change.
- A pill at the start of `DirectoryBar`, **Add to Directory**, shown only to
  `DATA_ADMIN`. Pass no known set. On success: invalidate the Directory list
  and count queries, then show the three counts.

## Checks

- Backend: a test that enqueues 70,000 handles (past the bind limit); the band
  sorts after harvest and before refresh; a held verdict is skipped and a
  pending rank only improves; non-`DATA_ADMIN` is refused; invalid and reserved
  handles are counted and never inserted.
- Frontend: `paste-handles.test.ts` for the tightened regex and the known
  status; a render test for the Directory box (CRAP ratchet); the existing
  Follow box tests stay green unchanged.
