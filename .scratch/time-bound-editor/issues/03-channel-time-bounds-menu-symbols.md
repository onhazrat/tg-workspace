# TB-03: Channel Time bounds and Filters menu symbols

**What to build:** An Account on the Channels tab can bound seven moments of
its followed Channels with the shared editor: Followed, Last update, Sync
start, Oldest stored post, Next regular sync, Next dynamic sync and
Discovered, each with open ends, ahead and No value. Each moment's editor
shows a spread of that moment across the Account's Channels; clicking a bar
keeps exactly the Channels the bar counts. A Live bound keeps moving while the
tab stays open. The "Days followed" and "Days since last update" numbers are
gone. Every row of the Posts and Channels Filters menus carries a symbol, as
the Directory's condition menu does, and Channels number chips carry `#`.

**Blocked by:** TB-01.

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions: Channel
moments, the minute tick, the day counts removed, clicked time bar, menus).
Prototype rows "TB-03" in `../prototype.md`, pinned to 10b8c6af. The
prototype's moment keys and its `Date.now()` evaluation are corrected here.

- [ ] A Channel filter Time bound Condition carries the moment, mode, start, end and No value; it prints and parses with the shared text form under the keys `followed_at`, `updated_at`, `sync_start_at`, `oldest_post_at`, `next_regular_sync_at`, `next_dynamic_sync_at`, `discovered_at`, and reads as a chip in the shared words ("Followed from 30 days ago to now").
- [ ] Evaluation is `[start, end)` against the Channel's own field, a Channel with no value failing every bound and matching No value; a Live bound re-filters on the Scope's server minute tick.
- [ ] Both Channels condition menus (the Filters dropdown and the filter row's picker) list the seven moments under a Times heading; each opens the embedded editor with its spread (drawn in the browser from the Channels already loaded) and Add or Update with the count kept.
- [ ] A clicked bar sets a Fixed bound rounded out to whole minutes, its End one minute past the bar's newest value, so Add's count equals the bar's.
- [ ] `days_since_update` and `days_followed` are removed from the Channels numbers; a link that bounds them no longer parses and the tab opens unfiltered.
- [ ] Every row of the Posts and Channels Filters menus carries its symbol (views an eye, counts `#`, times a clock); Channels number chips carry `#`.
- [ ] Filter tests: every moment key round-trips, No value, `[start, end)`, `days_followed` not parsing, a Live bound changing its answer when the minute moves. Render tests: the moment editor emits the bound, and a clicked bar's count equals Add's. Each new guard is mutation-tested.
