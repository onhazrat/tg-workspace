# #42 🐛 Stop flagging channels younger than the retention cutoff as partial

**State:** merged 2026-07-28 · **Branch:** `worktree-partial-history-young-channels` into `main` · **Diff:** +268 / -4 across 10 files · **Opened:** 2026-07-28

---

## The bug

About 5% of channels showed a permanent **"Partial history"** badge. Investigating them by hand showed the pattern: the channel's *first visible post* is newer than 90 days — the current post retention.

`update_channel_coverage()` decided coverage with one test (`backend/app/services/channels.py`):

```python
channel.history_complete_to_cutoff = oldest_ts < scrape_cutoff_ms
```

It demands a post **older** than the cutoff as proof the backward walk crossed the boundary. A channel whose entire history is newer than the cutoff — a young channel, or one that purged its own old posts — can never satisfy that, so the flag was pinned to `False` forever.

Two knock-on effects beyond the badge:

- `backend/app/jobs/auto_sync.py` treats every `history_complete_to_cutoff=False` channel as a `partial_candidate` and rotates it into **every** auto-sync run, bypassing the normal schedule.
- `sync_orchestrator.py:448` sets `needs_backfill=True` on each of those syncs, so every run also re-walks the channel back to its origin. Scrape budget burned forever on history that does not exist.

The original design encoded this deliberately (`.cursor/plans/backward_sync_redesign_35736418.plan.md` §6.5) with no escape hatch, and `test_young_history_sets_incomplete_flag` asserted it.

## The fix

The orchestrator already learns the truth — backward pagination running off the beginning of a channel returns an empty page (`_apply_scrape_page`, the `if not posts` branch) — but that fact was transient. `update_channel_coverage` ran afterwards with no knowledge of *why* the walk stopped, and re-derived `False`.

This persists it as `Channel.history_reached_channel_start` and treats it as completeness:

```python
channel.history_complete_to_cutoff = (
    oldest_ts < scrape_cutoff_ms or channel.history_reached_channel_start
)
```

Design points:

- **Latched, not recomputed.** A later head-only (incremental) sync stops at the newest stored post and never revisits the beginning, so it would otherwise clear the flag on the next run.
- **A separate column, not stickiness on the existing bool.** If retention widens (90 → 365 days), a channel marked complete via `oldest_ts < cutoff` *should* fall back to partial; one that reached its true start should not. Those two need distinguishing.
- **Not set when the very first page is blank** (`before_id is not None`), so a private or deleted channel cannot claim it reached its own start.
- An interrupted walk — iteration limit, cancel — still reports partial and resumes next run, unchanged.
- Cleared by `_reset_channel_coverage_fields` alongside the other coverage fields.

**Existing affected channels self-heal** on their next backward pass — no backfill script needed. The auto-sync partial rotation picks them up (batch size `autoSyncPartialBatchSize`, default 1/run); the existing **Fix All Partial History** palette command drains them faster.

## Verification

- `617 passed, 1 skipped` — full backend suite.
- Both new regression tests were confirmed to **fail** without the fix (temporarily reverted the one-line condition; `assert False is True` on each), so they are not vacuous.
- New: `test_reaching_channel_start_completes_young_history`, `test_reached_channel_start_survives_later_head_only_sync`, `test_partial_channel_without_reaching_start_stays_incomplete`, plus end-to-end `test_sync_marks_channel_younger_than_cutoff_complete` driving a real sync job through a mocked scraper that runs out of pages.
- Migration `s1t2u3v4w5x6` round-trips (downgrade + upgrade). `alembic check` reports only pre-existing drift (partial indexes, `tg_tag_runs` JSON nullability) — nothing about the new column.
- mypy clean, ruff clean, biome clean, `bunx tsc --noEmit` clean.
- `ty` diagnostics 53 → 31: adding a bool field to `Channel` made ty's inference of `Channel(**payload)` cascade in the setting-groups test helper, so `payload` is now annotated `dict[str, Any]`.
- No client regeneration needed — these are hand-written routes; the field is absent from `frontend/openapi.json`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
