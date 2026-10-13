# PTI-03: Analysis window histogram

**What to build:** The Analysis window editor shows how many Posts fall in each part of the time
around the window: 60 buckets spanning three times the window, centred on it and never past now,
the window's buckets solid. Dragging across buckets (or clicking one) sets a Fixed window from the
first bucket's start to the last bucket's end. Zoom out triples the span; zoom in returns toward the
default. A "Filtered | All posts" toggle switches between the Posts the Post filter, keyword and
Channel spotlight keep (without the per-Channel cap) and every Post of the selected Channels.
Hovering a bucket shows its start and count. The chart is part of the editor, so the desktop
popover and the phone sheet both carry it. See `.scratch/posts-tab-improvements/spec.md`, user
stories 20-32, and "New reads" and "The Analysis window chart" under Implementation Decisions.

**Blocked by:** PTI-01 (the shared bar component).

**Status:** resolved

### The window histogram read

- [x] A POST read takes the filtered-request body plus `extentStart`, `extentEnd`, `buckets` (1 to 500) and `unfiltered`, and answers `{ counts }`, one count per equal slice of the extent
- [x] Filtered applies the Post filter, keyword and spotlight without the cap; unfiltered only the selected Channels; a Channel posts Condition inside the filter still counts within the Analysis window, not the extent
- [x] Reads through the tenancy seam; docstring without ticket id; client regenerated; account isolation probes it; the route guards pass

### The chart

- [x] Drawn by the shared bar component with its own solid rule (the window's buckets) and caption (the extent's dates, the hovered bucket's start and count)
- [x] Extent: `span = max(end - start, 1 minute)`, the chart spans `span × 3 × 3^zoom`, centred on the window, never past now
- [x] A drag sets a Fixed window through the existing scope setter; a Live window keeps following as it advances
- [x] Toggle and zoom start at Filtered and the default each time the editor opens; neither is stored

### Tests

- [x] Backend, through the HTTP API: filtered against unfiltered, cap ignored, the extent's edges (a Post on the boundary lands in exactly one bucket), spotlight respected, another account's Posts never counted
- [x] Frontend, through the Analysis window control's test with a fake read: the chart renders, a drag sets a Fixed window, the toggle changes what is requested, zoom widens the extent
- [x] Each new test watched failing against a mutation first
