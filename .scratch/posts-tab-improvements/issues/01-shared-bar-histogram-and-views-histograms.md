# PTI-01: Shared bar histogram, and histograms on Views and Estimated views

**What to build:** The Posts tab's Views and Estimated views filters open on the same histogram the
Channels tab's number filters use. Opening either editor from the Filters menu (or the filter row's
condition picker) shows 32 bars of the Posts in the Analysis window and the selected Channels,
other filters aside, logarithmic when the values span more than two orders of magnitude; a drag
across bars fills the bound's fields, touching the first bar leaves the low end open and the last
the high end; typed fields redraw the solid bars; the caption names the median, or a hovered bar's
count and range. The Channels tab's number filters look and behave exactly as today, because they
now draw the same component. See `.scratch/posts-tab-improvements/spec.md`, user stories 33-41
and 43, and "New reads", "One bar component" and "The Filters menu and its editors" under
Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** resolved

### The shared component

- [x] The Channels number editor's bars, drag, hover and caption move into one presentational component, behaviour unchanged. Its interface (from the prototype):
  ```ts
  BarHistogram({
    bins: number[]
    solid: (i: number) => boolean        // inside the selection while nobody drags
    onSelect: (run: { from: number; to: number }) => void
    caption: (shown: number | null) => [left, middle, right]
  })
  ```
- [x] A bound histogram on top of it takes a distribution (`bins`, `edge(i)`, `lo`, `hi`, `median`, `log`), draws the bars a bound keeps solid, turns a run into a bound and captions it; the Channels editor builds its distribution in the browser exactly as today
- [x] The Channels number editor's existing tests pass **unchanged**

### The value histogram read

- [x] A POST read takes the filtered-request body plus `measure` (`views` or `estimated` in this ticket) and answers `{ bins: int[32], edges: float[33], log, median, measured, total }`, the Channels tab's binning rule (logarithmic, or log(1 + x) from zero, when the highest is over 100 times the lowest) (changed: a window with nothing measured answers empty `bins` and `edges` and `median: null`; the editor reads `measured`)
- [x] It reads through the tenancy seam like the feed, over the Analysis window and the selected Channels (spotlight included), ignoring the Post filter and keyword
- [x] Its docstring carries no ticket id (a comment above the decorator does); the client is regenerated
- [x] Account isolation probes it with two live accounts; route inventory, approval gate, route-module hygiene and the View-as read-only check pass (changed: the probe finds rows by id and this read answers bar counts, so `test_account_isolation.py` excuses it as covered elsewhere and `test_post_value_histogram.py` runs the two-account checks)

### The editors

- [x] Views and Estimated views open on the histogram; a drag fills the fields; typing redraws the solid bars; an empty window says nothing has a value instead of drawing nothing
- [x] The histogram's read reaches the editor through context, so the filter bar still renders (and tests) without providers

### Tests

- [x] Backend, through the HTTP API: linear against logarithmic bins, `measured` against `total` for Estimated views (Posts under the floor have no value), an empty window, another account's Posts never counted
- [x] Frontend, through the filter bar's props-only test with a fake read: a drag over bars produces the expected `views <= …` text
- [x] Each new test watched failing against a mutation first
