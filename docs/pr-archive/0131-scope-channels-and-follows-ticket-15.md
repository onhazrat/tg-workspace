# #131 🔒 Scope Channels and Follows (ticket 15)

**State:** merged 2026-08-25 · **Branch:** `worktree-ticket-15-scope-channels-follows` into `main` · **Diff:** +698 / -47 across 10 files · **Opened:** 2026-08-25

---

## Summary

With `TENANCY_ENFORCED` on, the channel list, bios, stats, and single-channel stats route now show only Channels the caller follows; while it's off, `scoped_select` is a no-op and nothing changes. Per-channel settings (`tags`/`startId`/`startTime`/`followedAt`/`discoveredVia`) now read from the caller's own `ChannelFollow` row via `channel_to_camel(..., follow=)`, falling back to the Channel when no follow exists yet.

Since `Channel` stays authoritative until ticket 22 drops these columns, the three write paths that edit them (`upsert_channel`, `bulk_update_channel_tags`, `_import_channels`) now mirror the edit into the acting user's Follow via the new `sync_follow_settings` — otherwise the read side would show stale values right after an edit.

## Code-review round

A `/code-review` pass found and fixed two real bugs plus a duplication smell:

- `sync_follow_settings` originally mirrored all six fields unconditionally on every call, so an edit to an unmirrored field (`bio`) could clobber a Follow that had legitimately diverged from the Channel. It now takes a `fields` parameter naming only what the edit actually touched.
- `_import_channels`'s edit branch was still calling the additive `ensure_follow_for_channel` (a no-op against an existing row), so a re-import never reached the Follow at all.
- Collapsed three independent enumerations of the mirrored field list down to one shared `MIRRORED_CHANNEL_FIELDS` constant.

One finding (per-channel upsert in `bulk_update_channel_tags`'s loop) was evaluated and left as-is: `resolve_follow_owner`'s `session.get(User, ...)` hits SQLAlchemy's identity map after the first channel, so there's no repeated round trip, and nothing has measured this path as a bottleneck.

## Testing

14 new tests in `test_channel_tenancy_scoping.py`. Full backend suite: 1352 passed, 2 pre-existing skips, 0 failed. `mypy`/`ty`/`ruff` clean. No OpenAPI/schema changes — the generated client didn't need regeneration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
