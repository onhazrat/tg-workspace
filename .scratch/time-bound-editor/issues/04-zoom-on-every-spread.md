# TB-04: Zoom on every spread

**What to build:** Every spread a bound is drawn over carries the Posts time
chart's Zoom in and Zoom out buttons: the Directory's measure and moment
spreads, the Channels numbers and moments, and the Posts tab's number filters
(Views, Estimated views, Channel posts). A spread starts whole; Zoom in shows a
third of what is shown, centred on the bound or else the median; Zoom out
returns step by step to the whole spread and then disables. The bars are
recounted over the zoomed range, the chart keeps the scale it was first drawn
on, and a time spread shows the time of day once it shows under three days.
The Posts time chart keeps its own zoom unchanged.

**Blocked by:** TB-03.

**Status:** done

**Context pointers:** spec `../spec.md` (Implementation Decisions: zoom
contract, zoom rule, captions), `../prototype.md`. Prototype at 10b8c6af,
which let the Posts value histogram re-pick its scale per zoom; this ticket
keeps the whole spread's scale:

- [zoom.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/time-bound-prototype/zoom.tsx): `spreadZoom`, `boundFocus`, `SpreadZoomBar`, `momentText`.
- [DirectoryBoundEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/directory/DirectoryBoundEditor.tsx) (`Spread` with `zoom` and zoomed captions), [DirectoryView.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/DirectoryView.tsx) (`lo`/`hi` in the distribution query, previous bars kept while loading), [DirectoryTimeEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/directory/DirectoryTimeEditor.tsx) (zoomed time captions).
- [ChannelMetricEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelMetricEditor.tsx) and [ChannelTimeEditor.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/channel-grid/ChannelTimeEditor.tsx): browser re-binning.
- [PostFilterControls.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/PostFilterControls.tsx) (`PostValueHistogram`), [usePostsView.ts](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/hooks/usePostsView.ts) (`usePostValueHistogram` range), [PostFilter.tsx](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/frontend/src/components/PostFilter.tsx).
- Backend: [directory_reads.py](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/backend/app/services/directory_reads.py) (`distribution` zoom), [posts.py](https://github.com/onhazrat/tg-workspace/blob/10b8c6afa1e941b10a2e9036a4e9c91e3b5c9a19/backend/app/services/posts.py) (`value_histogram` zoom; add the kept scale), their schemas and routes.
- Prior-art tests: `test_post_value_histogram.py`, `test_directory_browse.py`, `ChannelMetricEditor.test.tsx`, `DirectoryBoundEditor.test.tsx`, `PostFilter.test.tsx`.
- Regenerate the generated client after the schema change.

- [x] `/data/directory/distribution` and `/data/posts/value-histogram` take an optional `lo` and `hi`, bin only that range, and keep the whole spread's scale; whole-spread fields (minimum, maximum, median, No value count) stay whole-spread. The value histogram request carries the scale it was first drawn on.
- [x] The generated client is regenerated; Playwright mocks of both routes are updated; both typechecks pass.
- [x] One zoom rule serves every spread: thirds per step, centred on the bound (its middle or its one end) or the median, clamped inside the whole spread, log(1 + x) on a log scale, six steps at most, Zoom out disabled at whole, reset on reopening the editor.
- [x] The zoom buttons are the Posts time chart's shared piece, placed the same way above each spread.
- [x] Channels numbers and moments re-bin in the browser; Directory spreads and Posts number histograms ask the server for the zoomed range, keeping the previous bars visible while the new ones load.
- [x] A time spread's captions show the time of day once the shown span is under three days.
- [x] API tests for `lo`, `hi` and the kept scale on both routes, in the existing value-histogram and Directory browse tests' style. Render tests: Zoom in and out change the range asked for (server spreads) or the bars drawn (browser spreads), centring, the six-step stop, the disabled Zoom out. Each new guard is mutation-tested.

## Comments

- 2026-10-20: implemented on `claude/tb-04-zoom` and merged into the integration branch in bfb5f36d.
