# 02: Sample Posts

**What to build:** A Directory entry keeps a sample of the Channel's recent Posts, so an Operator can judge what a Channel actually publishes before following it. The samples expire on their own window; the map itself never does.

**Blocked by:** 01

**Status:** done

- [x] Channel info fetching takes a flag for whether to also parse the preview page's Posts; only the probe sets it
- [x] With the flag off the result carries no samples key at all, and latest-post-id derivation is identical either way
- [x] Sample media is parsed, bringing view and reaction counts along, but no media is downloaded and thumbnail paths are **not** rewritten to local cache paths
- [x] Samples live in their own table keyed by handle and post id, never in `tg_posts`, so no corpus query needs an exclusion predicate
- [x] One aggregate module is that table's sole writer, declares its service kind, and does not commit — the caller owns the transaction
- [x] A conclusive probe replaces the handle's samples wholesale, so a Post that fell off the preview window stops being reported as recent
- [x] A payload with **no samples key** leaves an existing snapshot untouched — it came from a fetch that never parsed them, and is not an empty sample set
- [x] An inconclusive fetch touches nothing; an unavailable verdict clears the samples
- [x] A recheck resets the verdict fields and keeps the samples; the next conclusive probe replaces them
- [x] Samples expire on their own deployment-policy window, separate from log and corpus retention; Directory metadata is never collected by age
- [x] The window's default ships in the env example and matches the code default

## Notes

Samples are an unversioned snapshot of one preview page, replaced wholesale — unlike a `tg_posts` row, which belongs to a contiguous synced history. They are never promoted into the corpus when a Channel is followed, and nothing is deleted because an Account acted.

No reader is built; nothing calls one until the browsing surface exists.

Seams: channel info fetching, and the probe write path.

## What shipped

- `app/services/channel_directory_samples.py` — the aggregate that owns
  `tg_channel_directory_samples` and is its only writer. Separate from
  `channel_directory.py` because an aggregate owns one table and these two have
  different lifetimes: an entry is kept indefinitely, its samples expire.
  Nothing here commits; `record_probe_result` writes the verdict and the
  snapshot as one unit, because half a probe stored is a row claiming `ok`
  beside the previous probe's Posts.
- `get_channel_info(..., with_samples=True)` parses the preview page's Posts off
  the soup it already built. The probe is the only caller that opts in. The key
  is **absent** when the flag is off, and `_enrich_posts_with_timestamps` grew
  `cache_media_paths=False` so no thumb path is rewritten to a cache a probe
  never fills.
- `directorySampleRetentionDays`, deployment policy beside `postRetentionDays`,
  swept from `captured_at` in `jobs/retention.py`. Directory *metadata* is on no
  retention inventory at all.
- `f1a2b3c4d5e6_directory_sample_posts.py` — the table, keyed `(handle,
  post_id)` with a cascading key to the entry. Verified with a from-zero
  `upgrade head`, a `downgrade -1`, a re-upgrade, and an autogenerate that
  reports no drift for the new table.

## Caught along the way

- **`unavailable` needs an empty sample list, not an absent key.** The verdict
  is synthesized in `jobs/discover_probe.py` with no page behind it, so it
  carried no `samples` key at all — and an absent key means "we did not look".
  A handle that had just gone private would have gone on advertising the Posts
  from its last public probe. Telegram saying "no readable web view" *is* the
  statement that there are no recent Posts, so the synthesized payload says so.
- **`text` was nullable where every other column was not.** SQLModel makes an
  explicit `sa_column=Column(Text)` nullable, which is how `Post.text` ended up
  that way; autogenerate reported the drift. Pinned `nullable=False` on the
  model rather than loosening the migration.
- The revision id collided with `c2d3e4f5a6b7_quota_limits_and_ceiling_lifts`,
  which alembic reports only as "Multiple head revisions are present" — check
  for a duplicate `revision` string before believing the branch story.

## Notes for the next ticket

- **The samples key is the seam ticket 03/04 will lean on.** Sync fetches this
  same metadata and never parses Posts, so feeding the Directory from the sync
  path must keep passing no `samples` key — an empty list there would blank
  every followed Channel's snapshot on every sync.
- No reader shipped. `samples_for` exists so the write path has an observable
  answer to assert against; the browsing surface is a separate feature, and
  `HandleProbeResponse` is deliberately unchanged, so the generated client
  needed no regeneration.
- `_policy` in `tests/jobs/test_retention_split_four_ways.py` enumerates the
  policy fields to disable them; a new one has to be added there or that file's
  helper stops meaning "everything unnamed is off".
