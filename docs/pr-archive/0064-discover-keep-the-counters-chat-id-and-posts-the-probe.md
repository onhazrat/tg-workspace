# #64 ✨ Discover: keep the counters, chat id and posts the probe already fetched

**State:** open 2026-08-01 · **Branch:** `discover-candidate-posts` into `main` · **Diff:** +1051 / -8 across 16 files · **Opened:** 2026-08-01

---

IDEA-011 **D16**. A probe fetches `t.me/s/<handle>` — the *preview* page. That one response carried far more than the seven fields we stored, and the rest was parsed and then dropped:

- the `photos` / `videos` / `files` / `links` counters,
- the numeric `telegramChatId`, decoded from the message widget's `data-view`,
- the channel's **most recent ~20 posts**, which `_parse_channel_meta` walked only to compute `max(post_id)`.

Keeping all of it costs no request, no proxy lane and no latency — only storage.

## What lands where

**Five columns on `tg_discover_probes`** for the counters and the chat id, named and typed to match `Channel` exactly, so a probed handle and a followed channel describe themselves identically and a follow needs no translation. `telegram_chat_id` is `BigInteger` for the same reason it is on `Channel`: these overflow int32.

**A new table, `tg_discover_candidate_posts`**, modelled on `tg_posts` and deliberately separate from it — which was the main design question.

### Why not a flag on `tg_posts`

The two carry different guarantees. A `tg_posts` row belongs to a contiguous history whose coverage the sync orchestrator tracks (`is_anchor`, `tg_post_sync_state`). A row here is an unversioned snapshot of one page, for a channel nobody follows, that the next probe replaces wholesale.

Sharing a table would force every existing query over `tg_posts` — feed, search, summaries, embeddings, retention, stats — to grow an exclusion predicate, and the first one that forgot would quietly mix unfollowed channels into the operator's corpus. For the same reason these rows are never *promoted* into `tg_posts` when a candidate is followed: they are deleted, and sync fetches the channel properly.

Dropped versus `Post`: `user_id` (probes are user-agnostic and stay that way for multi-user), `is_anchor` / `retrieval_*` (sync bookkeeping that would invite the sync logic to trust these rows), `updated_at` (rows are replaced, not edited — hence `captured_at`).

## Lifecycle

- **Replaced** wholesale on each conclusive re-probe. The preview is a sliding window, so merging would leave a pile whose "most recent 20" claim is true of no single moment.
- **Deleted** at both channel-creation paths — `create_followed_channel` (Discover bulk follow, auto-follow) and `upsert_channel`'s create branch (manual add).
- An **inconclusive** fetch touches nothing, matching the existing verdict rule. An `unavailable` verdict clears the rows, since the page is no longer readable.
- **Recheck** does not clear them — an empty table between the click and the next drain tick would be worse than a slightly stale one.

## Two details that are easy to get wrong

**Media is parsed but never downloaded.** Storing the `media` JSON brings `views` / `viewsCount` / `reactions` along free from the same parse. Caching thumbnails would reintroduce per-candidate network requests, which is the entire premise. That required a `finalize_media=False` path on `_enrich_posts_with_timestamps`, because the thumbnail rewrite points `media.thumbApiPath` at a local cache a probe never fills — it would render as a broken image.

**Post parsing is opt-in** (`get_channel_info(..., include_posts=True)`); sync and bulk follow call the same function and should not pay to parse ~20 messages they discard. The *absent* key is load-bearing too: a payload with no `posts` means "never fetched", which must not read as "this channel has no posts" and wipe a good snapshot. There is a test for exactly that.

## Accepted cost

**No retention**, deliberately. Up to ~20 rows per probed handle means a 900-candidate report can add on the order of 18k rows (text and JSON, no media files). Bounded by distinct handles ever probed, shrinking as candidates get followed, but otherwise only growing. Recorded in `docs/unbounded-query-audit.md` as a deferral rather than a feature; a `candidatePostRetentionDays` key beside the report keys is the obvious follow-up.

## Scope

**Storage only.** Nothing renders any of this yet — the point was to stop discarding something already paid for. It unblocks D2 (evidence inline) and the staleness signal the report still cannot express ("last posted 8 months ago").

Also registered `tg_discover_candidate_posts` in `TG_TABLES`, or test isolation would leak rows between tests.

## Verification

- `uv run pytest tests/ -q -p no:randomly` — **758 passed, 1 skipped** (serially, per the standing rule about shared `app_test`)
- 28 new tests: 13 for the table's semantics, 7 on the probe write path, 8 on the parser
- `uv run mypy app` — clean · `ruff check` / `format --check` — clean · `ty check` — no diagnostics in touched files
- `alembic upgrade head` and `downgrade -1` both applied; `alembic check` reports no drift for the new table (the pre-existing composite-index drift is unchanged)

Not verified end-to-end: the plan's local-compose steps (generate a report, watch the rows appear, follow a candidate and watch them vanish) need a live corpus.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
