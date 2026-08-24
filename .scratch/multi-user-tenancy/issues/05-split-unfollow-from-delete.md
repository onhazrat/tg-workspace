# 05: Split unfollow from delete

**What to build:** Removing a Channel takes it off your list and leaves its Posts alone. Channels nobody Follows are collected later by retention rather than deleted on the spot.

**Blocked by:** 04

**Status:** done

- [x] The removal action drops the Follow, not the Channel
- [x] Posts of the Channel are untouched by removal
- [x] A Channel with no remaining Followers is collected by retention
- [x] A test proves a second account's Posts survive the first account's removal

## What shipped

`app/services/follows.py` gained `remove_follow`, keyed on `(user_id,
channel_id)` and reporting through `RETURNING` for the reason already argued on
`ensure_follow`. `channels.delete_channel` became `unfollow_channel`: it drops
that one row, commits, and touches nothing else. `collect_unfollowed_channel` is
the deferred half, called from the retention job over the existing
`channel_ids_without_follows`.

The route keeps the name `delete_channel` — the generated client derives
`dataDeleteChannel` from it and a rename churns the SDK and every call site for
no change in behaviour — but answers `{"status": "unfollowed"}` rather than
claiming a deletion that no longer happens. The confirm dialogs stopped
promising to "permanently delete all scraped posts", which had become false.

## Decisions taken here

**A channel the caller does not follow answers 404, not 403.** 403 confirms the
row exists, which is the enumeration oracle signup was hardened against. The
detail still names the resource, so the oracle does not move into the body.

**No grace window before collection.** A window needs a setting, a timestamp
column, and an answer to what re-following inside it means. Re-following before
the next retention pass already keeps everything, because the check is made at
collection time rather than recorded at unfollow time.

**Collection takes the Posts, and the embeddings, translations and sync state
with them.** Not a contradiction of "removal leaves Posts alone": removal is one
account acting on its own list, collection runs only once *no* account holds the
corpus. None of those four tables has a foreign key to `tg_channels`, so nothing
cascades, and a Channel collected alone would leave rows only the post retention
window could ever reclaim — which an operator is free to set to 0.

## Known gap, closed by ticket 15

`list_channels` does not filter on follows yet, so while enforcement is off a
removed channel stays in the list until retention collects it. Closing it here
would mean changing a response while the flag is off, which is the one thing the
seam's batches may not do. Do not add a follow filter to `list_channels` ahead
of ticket 15.

## Verification

Backend 1268 passed / 2 skipped, mypy clean, `ty` at the 58-diagnostic baseline
`main` reports, ruff clean. Frontend 873 unit tests, `tsc` and biome clean.
Eighteen mutations, each watched to fail.

End-to-end ran against a backend image rebuilt from this branch
(`docker compose up -d --build db prestart backend`, plus mailcatcher):
**137 passed, 5 failed**. Both specs this ticket touched are fully green —
`summarizer.spec.ts` 54/54 and `tg-ui-primitives.spec.ts` 14/14.

The 5 failures are pre-existing and belong to the template auth shell: admin
user edit, item edit, two reset-password cases, and the theme toggle. Proven,
not assumed — the identical five fail on `cfeb6a1`, the commit this branch is
based on, run against the same backend. Three are Playwright "element is not
stable / detached from the DOM" flakes on dialog animations.

Two *other* pre-existing failures were fixed here, because they sat inside a
spec file this ticket had to edit and made it impossible to read the result:
K9 and K15 in `summarizer.spec.ts` drove command-palette entries that PR #94
(A4, the IndexedDB removal) had deleted or renamed. `clear cache` matched
nothing at all, and `clear indexeddb` matched Refresh Database Stats — an
action, not an entity root — so the flow never showed the filter the test typed
into. Red since A4, unnoticed because CI is disabled.

## Test-helper change worth knowing about

`tests/utils/setting_groups.py::upsert_sync_test_channel` now writes the follow
every production creation path writes. Zero followers used to be an impossible
state and is now the state retention reclaims, so a fixture channel would
otherwise vanish mid-test in whichever suite happened to run a cleanup — a
failure landing nowhere near its cause. Guarded by
`test_the_channel_helper_writes_a_follow`.
