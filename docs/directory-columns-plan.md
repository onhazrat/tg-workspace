# Directory columns plan

Status: implemented 2026-10-15 (`.scratch/directory-columns/spec.md`, ticket prefix `DCOL`).

The Directory tab's Columns pill offers every column of `tg_channel_directory`.
The Operator decides which columns are on by default for the whole deployment.
Each Account can override any column, and one action resets it to the defaults.

## Today

- `COLUMNS` in `frontend/src/components/directory/DirectoryTable.tsx` lists the
  10 hideable columns: Lang, Subs, Reach, Posts/wk, Fwd %, Last post, Yours,
  Cited by, Cites, Found. The Channel cell and Follow always show. Shared
  parents and children appear only while their Condition is on.
- `useDirectory.ts` stores the hidden columns as a list in `scopedStorage`
  under `directory.hiddenColumns`.
- `DirectoryRowResponse` carries every field on every row, whether or not it
  is shown.

## Decisions

### Which columns

1. The menu lists every column of `tg_channel_directory` except four. handle,
   display_name and photo_url are already in the Channel cell. `kind` is
   always `channel` in this list. The menu heading says so.
2. The new columns go after today's ten, in groups. The menu's "More columns"
   section uses the same order.
   - **Content**: Photos, Videos, Files, Links. These are already sortable
     Measures.
   - **Probe**: Status, Followable, Bio, Sample size (`sample_count`), Checked
     (`checked_at`), Refresh due (`refresh_due_at`).
   - **Internals**: Attempts, Last error, Last attempt (`attempted_at`), Retry
     after, Priority, Chat id (`telegram_chat_id`), Latest id (`latest_id`).
3. The Internals are visible only to holders of `Permission.DATA_ADMIN`.
   `last_error` is `str(exc)` of any probe exception
   (`jobs/discover_probe.py`), so it can carry a proxy URL, and the proxy
   settings themselves sit behind `DATA_ADMIN`. For a non-holder the server
   omits the Internals and the menu does not list them.
4. The new columns are display-only, with a header that is not a button, like
   Lang. Bio and Last error render as one truncated line, with the full text
   in a tooltip.

### Defaults (deployment policy)

5. Defaults live in `tg_app_settings` under a `directory_columns` key,
   classified in `services/settings_registry.py` with a reason. A column the
   stored row does not name is off. With no row stored, today's ten are on.
   Implemented as that code fallback rather than the seed migration first
   planned: the behaviour is the same, and the test suite truncates
   `tg_app_settings` between tests, which would have removed a seeded row.
6. `DATA_ADMIN` may change the defaults. No new Permission until somebody
   needs one without the other.
7. `GET /data/directory/columns` returns `[{key, default}]` for the columns
   this caller may see. `PUT /data/directory/columns` is `DATA_ADMIN` only.
   Labels and descriptions stay in the frontend's `COLUMNS`. The response is
   cached in TanStack Query under a `queryKeys` entry.
8. View-as reads the catalogue as the target. The PUT is a write, so View-as
   refuses it without elevation, and a target holding `DATA_ADMIN` is never
   elevatable.
9. The Columns menu shows holders a "Make these the defaults for everyone"
   action. It saves the holder's current effective selection and clears the
   holder's own explicit states back to Default.

### Each Account's choices

10. Every column is in one of three states: Default, On or Off. These are
    stored per Account per browser in `scopedStorage`, keyed `{key: "on" |
    "off"}`. A column with no entry is Default, so it follows the
    deployment's defaults as they change.
11. In the menu, the checkbox shows the effective state, and a click always
    sets an explicit On or Off. An explicit state carries a marker and a
    per-row ↺ that puts the row back to Default. "On by default" and "on by
    your choice" look different.
12. The menu has two sections, "Default columns" then "More columns".
13. The selection is Custom while any column has an explicit state. The pill
    badge reads "N set". A "Reset to default columns" button in the menu
    header appears only while the selection is Custom and clears every
    explicit state.
14. The old `directory.hiddenColumns` value is read once, each hidden key
    becomes an explicit Off, and the old key is removed.

### What the list read carries

15. The list body takes a required `columns` list typed as a `Literal` union,
    so the generated TS union and an `every<>` record make frontend/backend
    drift a compile error. An unknown key answers 422. A gated column asked
    for by a non-holder is dropped silently, so a stored explicit On from
    when the Account held the Permission does no harm.
16. `DirectoryRowResponse` declares as required the fields every row needs:
    handle, displayName, photoUrl, followed, followable, dismissed, tags,
    match, sharedParents and sharedChildren. Every column field is optional
    and **omitted**, never `null`, when it was not requested, because `null`
    already means "not measured". Companion fields travel with their column:
    reachEstimated with Reach, mineLastAt with Yours. The model is not
    all-optional, so it stays in the generated client under
    `client-split.conform.ts`.
17. A hidden column skips its work as well as its field. Cited by, Cites and
    Yours are aggregates over `tg_post_references`. When a column is hidden
    and neither the sort nor the filter reads it, the read does not compute
    it.
18. Turning on a column the loaded page lacks triggers a new read. Turning
    one off triggers no read: the cached field stays hidden until the next
    read for another reason (page, filter, sort).

## Guards to touch

- `tests/api/test_account_isolation.py`: probe or excuse the two new
  operations.
- `tests/api/test_permission_checks.py` and `test_route_inventory.py`: the
  new route and its Permission.
- `tests/services/test_settings_table_split.py`: the new key's
  classification.
- `tests/api/test_view_as.py`: the PUT is refused at every tier, or derived.
- A `test_*_projection.py` for the row: unrequested keys are absent, not
  `null`, and gated keys are absent for a non-holder.
- Playwright `page.route` mocks of `/directory/list`: the response shape
  changes.
- Regenerate the client after the schema change.
