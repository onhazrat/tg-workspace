# #126 🔒 Split unfollow from delete (ticket 05)

**State:** merged 2026-08-24 · **Branch:** `worktree-ticket-05-split-unfollow-from-delete` into `main` · **Diff:** +1095 / -86 across 23 files · **Opened:** 2026-08-24

---

Closes ticket 05 in `.scratch/multi-user-tenancy/issues/`.

## What changed

Removing a Channel deleted the Channel row and bulk-deleted every Post under it, for everybody, with no ownership check. That held while one operator owned the database and stops holding the moment a Channel is a shared corpus: the second follower of a handle lost a scrape they had nothing to do with because the first follower tidied their list.

Removal now drops one `(user_id, channel_id)` follow and touches nothing else. `collect_unfollowed_channel` is the deferred half — retention reclaims a Channel once nobody follows it, taking the Posts, embeddings, translations and sync state with it, because none of those has a foreign key to `tg_channels` and nothing would otherwise cascade.

| | before | after |
|---|---|---|
| `DELETE /data/channels/{id}` | deletes the Channel and every Post | drops the caller's follow |
| a channel you don't follow | 200, deletes it anyway | 404, `"Channel not found"` |
| response body | `{"status": "deleted"}` | `{"status": "unfollowed"}` |
| zero-follower Channel | impossible | collected on the next retention run |

## Decisions taken here

**404, not 403, for a channel you don't follow.** 403 confirms the row exists, which is the enumeration oracle signup was hardened against. The detail still names the resource so the oracle does not move into the body.

**No grace window before collection.** A window needs a setting, a timestamp column, and an answer to what re-following inside it means. Re-following before the next retention pass already keeps everything, because the check is made at collection time rather than recorded at unfollow time.

**The route keeps the name `delete_channel`.** The generated client derives `dataDeleteChannel` from it, so a rename churns the committed SDK and every call site for no change in behaviour. The service is named for what it does; the response body says `unfollowed`.

## The second commit is the important one

The collection step as first written was a data-loss path, caught in review. It fires ~60 seconds after every boot, ignores the operator's retention windows, and deletes whatever `channel_ids_without_follows` returns — which, on a database whose follow backfill has not run, is every channel and every post. The native dev flow never invokes `prestart.sh`, and a restored pre-ticket-04 backup carries no marker either.

An absent follow reads identically whether nobody follows the channel or nobody has written the row yet. `follows_backfilled()` tells those apart, and collection refuses to run until the marker is set. Ticket 04's own marker comment had already argued this hazard from the backfill's side.

Also fixed in that commit: the corpus is keyed by `channel_name` while the Channel is keyed by `id`, and `Channel.name` is neither unique nor immutable, so collecting one of two rows sharing a name would have destroyed the survivor's corpus unattended. One pass is now bounded by `COLLECT_LIMIT`. The avatar is deleted after the commit rather than inside the transaction. `touch_sync` moved to `commit=False` immediately before the commit, per the rule in CLAUDE.md. And the bulk removal loop caught nothing, so a single 404 aborted it mid-way — the remaining channels were never removed, the selection never cleared, and no toast fired.

## Known gap, closed by ticket 15

`list_channels` does not filter on follows yet, so while enforcement is off a removed channel stays visible until retention collects it. Closing it here would change a response while the flag is off, which is the one thing the seam's batches may not do. It is also why a 404 from a single removal is treated as already-removed in the UI: with an unscoped list, clicking Remove twice is an ordinary thing to do.

## Also in here

The drift audit stopped counting a followerless channel as drift — `--strict` would otherwise fail on a healthy database in the window between a removal and the next retention run. The count is still returned, under `channels_awaiting_collection`, so it stays assertable in both directions.

UI copy stopped promising to "permanently delete all scraped posts", which had become false. The card affordance, both palette entries and both confirm dialogs now say Remove, and the e2e specs that keyed on the old labels were updated with them.

The third commit repairs two palette tests that PR #94 (A4, the IndexedDB removal) had left driving commands that no longer exist — `clear cache` matched nothing at all, and `clear indexeddb` matched an action rather than an entity root, so the flow never showed the filter the test typed into. Red since A4 and unnoticed because CI is disabled. They sit in a spec file this ticket had to edit, and a file with two permanent failures cannot tell you whether the change under review broke anything.

## Verification

- **backend**: 1268 passed, 2 skipped; mypy clean; `ty` at the 58-diagnostic baseline from `main`; ruff clean
- **frontend**: 873 unit tests pass, `tsc` clean, biome clean
- **e2e**, against a backend image rebuilt from this branch (`docker compose up -d --build db prestart backend`, plus mailcatcher): **137 passed, 5 failed**. Both specs this ticket touched are fully green — `summarizer.spec.ts` 54/54, `tg-ui-primitives.spec.ts` 14/14
- **18 mutations, each watched to fail.** Two were initially *not* caught and led to real changes: one showed the test-helper follow write was unguarded, the other showed a 404 test green only because the bulk loop's own catch was masking it

The 5 e2e failures are pre-existing and belong to the template auth shell — admin user edit, item edit, two reset-password cases, the theme toggle. Proven rather than assumed: the identical five fail on `cfeb6a1`, the commit this branch is based on, run against the same backend. Three are Playwright "element is not stable / detached from the DOM" flakes on dialog animations. They are not this branch's to fix and are worth their own ticket.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_01W7dntDGH9s86Yyoj2gqvTw
