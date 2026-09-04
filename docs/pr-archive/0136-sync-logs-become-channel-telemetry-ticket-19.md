# #136 🔒 Sync logs become Channel telemetry (ticket 19)

**State:** merged 2026-08-26 · **Branch:** `worktree-ticket-19-sync-log-telemetry` into `main` · **Diff:** +1436 / -43 across 16 files · **Opened:** 2026-08-26

---

A sync log answers "did this Channel deliver Posts, and if not why not". That is a fact about the Channel, not about whoever triggered the scrape, and the second follower of a handle has exactly as much right to it as the first.

`SyncLog` and `SyncLogPayload` move from `USER_OWNED` to `FOLLOW_SCOPED`, keyed on `channel_name`. Scoping them on `user_id` would have handed the second follower an empty Logs tab for scrapes that ran on their own behalf.

Ticket 19 is one of the last three blockers on ticket 21, with 20 and 30.

## The owner stops being written

`upsert_sync_log` accepts a `user_id` and no longer writes it. The parameter stays because `_LOG_IMPORTERS` dispatches all five log types through one uniform signature; ticket 22 drops the column and the parameter together. Nothing at a call site shows that it is ignored, so a guard hands it a real account and requires `None` on the row.

## The payload table gains channel_name

Denormalised the way `timestamp` already is. The seam correlates on a real column, and reaching the parent's name through a join would put `tg_sync_logs` (191k rows on staging) inside the predicate of every read of the table the payload split exists to keep cheap. `ADD COLUMN` is metadata-only on PG 11+, the backfill is one `UPDATE ... FROM`, and it is idempotent because prestart runs it every deploy.

## Three things the checkboxes did not say

**`assert_owner` on an ownerless row fails closed.** `owner_id is None` raises, so leaving ticket 18's write-takeover guard in place would have refused every sync log write the moment ticket 21 flips the flag. It is restated as a Follow check rather than deleted, and it checks both the Channel an incoming log names and the one an existing row at that id already names. Checking only the first leaves the takeover open, since the id is the part being guessed.

**Deleting one sync log row is now administrative.** A Follower deleting shared telemetry destroys the record for every other Follower, which is what ticket 20's own checkbox forbids and the argument ticket 05 made for unfollowing rather than deleting. `SHARED_LOG_TYPES` is derived from `SCOPES`, never listed.

**That gate closes a hole ticket 18 left.** Network log *reads* went Admin-only, but the single-row delete branch never had a permission check and `get_log` skips the owner check for Admin-only types, so any authenticated account could delete a proxy log one row at a time while being unable to read one. Watched to fail: with the gate removed a plain user gets `200` on both `sync` and `network`.

## Search

Stays inside the scope in both shapes. The payload subquery itself is deliberately unscoped: it is semi-joined into a statement already narrowed to visible logs, so it can only remove rows from that set.

## Guards

`backend/tests/services/test_sync_log_channel_telemetry.py`, both flag states. Six mutations run, each killing the tests it should. Two are recorded in the guard's docstring because they are weaker than they look: neutering the write check's call site leaves the `else` branch refusing via `assert_owner`, and the seam's own follow-key assertion is a tautology under a mutation that changes the declaration, which is why the key is pinned as a literal.

## Wire format

Unchanged. `SyncLogResponse` never carried `userId`; the only generated-client diff is JSDoc.

Backend 1544 passed, 2 skipped. Frontend 882 passed. mypy, ruff, tsc clean.

Plan: `docs/sync-log-channel-telemetry-plan.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
