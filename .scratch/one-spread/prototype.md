# One Spread prototype

Code: [`prototype/one-spread-snapshot` @ 951326bb](https://github.com/onhazrat/tg-workspace/tree/951326bbbd56ded16625f576f78bdc2376ff9c92).
The pieces are `frontend/src/components/spread-prototype/`. No prototype API:
every Spread's server read already takes a zoom range.

Status: resolved

Built 2026-10-25 to answer: can one Spread serve every bound and the Analysis
window, and one editor every Number bound, with the Requested spread's zoom,
panning, scrollbar and full screen everywhere? It could, and the user approved
it unchanged after review; the answer is ADR-037 and `docs/one-spread-plan.md`.

## Variants (`?variant=`, every tab)

| Key | Idea |
|---|---|
| 0 | `main`, unchanged |
| 1 | One Spread for the eleven choices that draw one, and one Number bound editor for Channel, Directory, Post and Requests |

The pink bar at the bottom switches variants (Alt+← / Alt+→). The variant is
read app-wide through a context that defaults to `0`, so anything outside the
provider, and every existing unit test, sees `main`.

## What was checked, on staging data

| Spread | Checked |
|---|---|
| Channel Subscribers | one bar sets between; the last bar leaves the top open; zoom, wheel pan, scrollbar, full screen |
| Channel Followed | one bar sets a Fixed bound over its minutes; the first bar leaves the start open |
| Directory Reach | the server's count on Add; a pan moves the thumb at once and keeps the bars until the read settles |
| Directory Last post | the last bar leaves the end open |
| Post Views | the first bar sets at most; zoom re-reads on the log scale |
| Analysis window | pans in time up to now; the scrollbar runs from the oldest stored Post of the selected Channels; older extents name their year |
| Logs, History | one bar sets a Fixed bound; full screen keeps the popover open |
| Requested | one bar sets a Fixed day; the tier lines draw over the bars |
| Requests measure | between, with no No value offered |

## Where each decision's answer lives (at 951326bb)

- One Spread, its two zoom adapters and the open-end rule:
  `spread-prototype/OneSpread.tsx` (`OneSpread`, `useRangeZoomKit`, `Bars`).
- The extent adapter and its scrollbar: `AnalysisWindowControl.tsx`,
  `WindowChart1`.
- One Number bound editor and its two sources:
  `spread-prototype/NumberBoundEditor.tsx`; each caller's adapter sits beside
  its old editor (`ChannelMetricEditor`, `DirectoryBoundEditor`,
  `PostNumberEditor`, `MeasureEditor`).
- A run as a Time bound: `spread-prototype/time-pick.ts`.

## Not carried forward

- Prototype code is never promoted: no tests, prototype names, a `?variant=`
  gate. Each ticket names what to port.
- Channel moments keep their own minute binning in the prototype; decision 13
  (one binning function) is the real code's.
- Multi-bar drags were not driven by hand: the browser pane's drag skips the
  bars between. The drag is `BarHistogram`'s, unchanged.
- After a one-bar pick on a server-drawn time Spread, the bar before it also
  draws solid, because the start is floored to the minute. `main` does the
  same.
