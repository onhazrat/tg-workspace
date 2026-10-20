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

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions: Channel
moments, the minute tick, the day counts removed, clicked time bar, menus),
`../prototype.md`. Prototype at 10b8c6af; its moment keys and its
`Date.now()` evaluation are corrected here:

- [channel-moments.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/channels/channel-moments.ts): the seven moments, their labels, descriptions and fields (rename the keys to the spec's `_at` keys).
- [channel-filter.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/lib/channels/channel-filter.ts): `TimeCond`, evaluation, chip label, text form through the shared module.
- [ChannelTimeEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelTimeEditor.tsx): the editor, the browser-drawn spread (`spreadOf` over the Directory's `Spread`), the minute rounding of a clicked bar.
- [ChannelMetricMenu.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelMetricMenu.tsx) and [ChannelConditionPicker.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelConditionPicker.tsx): the Times section and its rows; [ChannelFilterRow.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelFilterRow.tsx): `#` chips and the chip id.
- [MenuRowLabel.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/time-bound-prototype/MenuRowLabel.tsx) and the `PostFiltersMenu` rows in [PostFilterControls.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/PostFilterControls.tsx): the menu symbols.
- [ChannelGrid.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/ChannelGrid.tsx): the Channels handed to the editor; re-filter on the Scope's minute instead of the page-load time.
- Today's code it changes: the Channels metrics (remove the two day counts).
- Prior-art tests: `channel-filter.test.ts`, `ChannelMetricEditor.test.tsx`, `ChannelMetricMenu.test.tsx`, `ChannelFilterRow.test.tsx`; Playwright `summarizer-channels.spec.ts`.

- [x] A Channel filter Time bound Condition carries the moment, mode, start, end and No value; it prints and parses with the shared text form under the keys `followed_at`, `updated_at`, `sync_start_at`, `oldest_post_at`, `next_regular_sync_at`, `next_dynamic_sync_at`, `discovered_at`, and reads as a chip in the shared words ("Followed from 30 days ago to now").
- [x] Evaluation is `[start, end)` against the Channel's own field, a Channel with no value failing every bound and matching No value; a Live bound re-filters on the Scope's server minute tick.
- [x] Both Channels condition menus (the Filters dropdown and the filter row's picker) list the seven moments under a Times heading; each opens the embedded editor with its spread (drawn in the browser from the Channels already loaded) and Add or Update with the count kept.
- [x] A clicked bar sets a Fixed bound rounded out to whole minutes, its End one minute past the bar's newest value, so Add's count equals the bar's.
- [x] `days_since_update` and `days_followed` are removed from the Channels numbers; a link that bounds them no longer parses and the tab opens unfiltered.
- [x] Every row of the Posts and Channels Filters menus carries its symbol (views an eye, counts `#`, times a clock); Channels number chips carry `#`.
- [x] Filter tests: every moment key round-trips, No value, `[start, end)`, `days_followed` not parsing, a Live bound changing its answer when the minute moves. Render tests: the moment editor emits the bound, and a clicked bar's count equals Add's. Each new guard is mutation-tested.

## Comments

- 2026-10-20: implemented on `claude/tb-03-channel-time-bounds` and merged into the integration branch in 42a3f810.
