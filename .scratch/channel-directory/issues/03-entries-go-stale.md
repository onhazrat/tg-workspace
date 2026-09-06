# 03: Entries go stale and refresh

**What to build:** A Directory entry for a live Channel goes stale and comes due again on a schedule the Operator controls; a dead one never does; and a Channel somebody follows stays current for free.

**Blocked by:** 02

**Status:** done

- [x] Due-ness is a new column, separate from the retry-backoff field
- [x] A dead verdict — bot, group, user account, private, deleted — never becomes due again
- [x] A live entry becomes due after a configurable window, defaulting to one week, as deployment policy rather than per-Account
- [x] Widening the window reduces steady-state request volume, and is the Operator's lever if Telegram pushes back
- [x] An entry can be refreshed on demand, jumping the queue
- [x] Due-ness and retry backoff move independently
- [x] The metadata sync already fetches on every run also updates that Channel's Directory entry, with no additional request
- [x] That metadata-only update does not clear existing samples

## Notes

The retry field means "this fetch failed, back off"; due-ness means "this answer is old". Same type, opposite cause, and conflating them once already produced a starvation bug the module documents.

This is where ticket 02's "payload with no samples key" rule becomes load-bearing in production.

## What shipped

- `DirectoryEntry.refresh_due_at`, a second timestamp beside `retry_after` and
  never a widening of it. `NULL` is "never due", which covers both halves of the
  exemption: a dead verdict a timer cannot change, and a handle with no answer
  yet, which is pending rather than stale. `dequeue_handles` reads them as two
  legs of an `OR`, and the refresh leg consults `retry_after` not at all.
- `is_refreshable` is the exemption, and it derives "dead" rather than listing
  it: `status == "unavailable"` is private or deleted, `DEAD_KINDS` is what the
  page turned out to be. `channel` and `unknown` both refresh — an unclassified
  page costs one fetch a week to keep current, against a Channel frozen at
  whatever it looked like the first time.
- `directoryRefreshDays`, its own global settings key rather than a fourth field
  in `retention`. Retention deletes rows; this decides when to fetch one again,
  and filing the lever that controls outbound traffic in the blob an Operator
  opens to reclaim disk is how it gets moved by accident. `0` disables
  refreshing, the same convention every window here already uses.
- `record_sync_metadata` — the second writer. `_parse_channel_meta` has already
  reduced a sync page to exactly the Directory's fields, so a followed Channel's
  entry stays current at zero extra requests. It cannot reach `replace_samples`,
  writes only on the walk's first page, and does not commit.
- `refresh_entries` and `POST /data/discover/probe/refresh` — on-demand, and
  deliberately not a recheck. A recheck says the verdict is *wrong* and discards
  it; a refresh says it is *old*, so the entry goes on answering with what it
  holds until the fresh fetch lands.
- `a7b8c9d0e1f2_directory_refresh_due.py` — the column and a partial index.
  Existing rows are left `NULL`: a backfill would make the whole Directory due
  on the first sweep after the upgrade, which is exactly the load the window is
  the lever against.

## Caught along the way

- **A failed refresh was blanking a good entry.** `record_probe_result`'s
  inconclusive branch demoted the row to `unknown`, which cost nothing while a
  resolved handle was never fetched again — and this ticket re-fetches every live
  entry on a window. One proxy timeout would have taken a verdict out of every
  report that joins it, which is the "a wrong answer is permanent" failure the
  module's own verdict rule exists to prevent, arriving from the other side. The
  failure is still recorded; only the verdict survives it. It also opened a hot
  loop: a row that keeps its verdict is invisible to the pending leg, so the
  refresh leg is its only way back and had to carry the backoff.
- **`RECHECK_PRIORITY` was `0`, which ties rather than jumps.**
  `enqueue_handles` numbers a report's candidates from zero, so a recheck sorted
  level with the strongest candidate of the newest report and the tie fell to
  whichever handle was alphabetically first. `test_recheck_jumps_the_queue`
  passed on exactly that accident. Now `-1`, and the property holds by
  construction for both callers.
- **A conclusive probe has to reset `priority`.** A row keeps the rank of
  whatever first enqueued it, so a handle rechecked once would have gone to the
  front of the queue every week for ever. `REFRESH_PRIORITY` sorts behind
  `DEFAULT_PROBE_PRIORITY`: an answer we hold is worth less than one we have
  never had.
- **The account-isolation guard counts mounted operations**, so a new route is
  a failure there until it is classified. `POST /discover/probe/refresh` is
  `Reason.CORPUS` beside the two probe routes it sits with.

## Notes for the next ticket

- **The sweep does not yet skip followed handles.** Ticket 04 owns that
  checkbox. It is already most of the way there by arithmetic — sync pushes a
  followed Channel's `refresh_due_at` out on every run, so the queue rarely sees
  one — but a Channel synced less often than the window still surfaces.
- `refresh_due_count` is deliberately outside `queue_counts`. Those four drive a
  progress bar for one report's candidates, where a refresh is not pending work;
  folding it in makes a bar that never reaches the end. The sweep reports it as
  `refreshDue` beside `remaining`.
- No UI. `HandleProbeResponse` is unchanged, so `refresh_due_at` reaches no
  client and the two probe-key-set guards needed no edit; the browsing surface
  is still a separate feature.
