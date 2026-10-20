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

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (Implementation Decisions: zoom
contract, zoom rule, captions). Prototype row "TB-04" in `../prototype.md`,
pinned to 10b8c6af. The prototype let the Posts value histogram re-pick its
scale per zoom; this ticket keeps the whole spread's scale.

- [ ] `/data/directory/distribution` and `/data/posts/value-histogram` take an optional `lo` and `hi`, bin only that range, and keep the whole spread's scale; whole-spread fields (minimum, maximum, median, No value count) stay whole-spread. The value histogram request carries the scale it was first drawn on.
- [ ] The generated client is regenerated; Playwright mocks of both routes are updated; both typechecks pass.
- [ ] One zoom rule serves every spread: thirds per step, centred on the bound (its middle or its one end) or the median, clamped inside the whole spread, log(1 + x) on a log scale, six steps at most, Zoom out disabled at whole, reset on reopening the editor.
- [ ] The zoom buttons are the Posts time chart's shared piece, placed the same way above each spread.
- [ ] Channels numbers and moments re-bin in the browser; Directory spreads and Posts number histograms ask the server for the zoomed range, keeping the previous bars visible while the new ones load.
- [ ] A time spread's captions show the time of day once the shown span is under three days.
- [ ] API tests for `lo`, `hi` and the kept scale on both routes, in the existing value-histogram and Directory browse tests' style. Render tests: Zoom in and out change the range asked for (server spreads) or the bars drawn (browser spreads), centring, the six-step stop, the disabled Zoom out. Each new guard is mutation-tested.
