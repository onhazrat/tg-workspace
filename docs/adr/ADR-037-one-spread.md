# ADR-037: One Spread for every bound, and one Number bound editor

**Status:** Accepted (2026-10-25). Supersedes, for the chart only, ADR-033's
"the Posts tab's Analysis window editor keeps its look and behaviour"; its mode
switch and four fields stay as they are. Plan: `docs/one-spread-plan.md`.
Prototype: variant 1 on
[`prototype/one-spread-snapshot` @ 951326bb](https://github.com/onhazrat/tg-workspace/tree/951326bbbd56ded16625f576f78bdc2376ff9c92),
checked on staging data on 2026-10-25.

## Context

The app draws a Spread beside eleven choices: four Number bounds (Channel,
Directory, Post, Requests), five Time bounds (Directory and Channel moments,
Logs, History, the Requests tab's Requested range) and the Analysis window.
Two charts drew them. `BarHistogram` took a dragged run of bars; `Spread` took
one clicked bar. Only the Requested spread had full screen, a scrollbar and
panning, and each chart had its own rule for when a pick leaves an end open.

The four Number bound editors were one editor written four times: the same
operator and two-field draft seeded from the initial bound, the same bar-click
reset, the same form around it, and `median` and `nice` defined twice. They
differed only in rounding, a floor of zero, whether No value is offered, and
where the bars and the kept count come from.

ADR-033 made one editor for every time filter and rejected "the same look,
separate code", which is where the Number bounds and the charts still were.

## Decision

- **One Spread.** Every bound's Spread and the Analysis window chart are one
  module: drag a run of bars (a click is a one-bar run), the hover caption,
  zoom, panning by wheel, scrollbar and arrow keys, and full screen that keeps
  the zoom. The Requests tab's tier lines are an overlay only it passes.
- **One rule for open ends.** A run touching the first or last bar of the
  whole Spread leaves that end open, unless the zoom hides that edge; touching
  both keeps everything with a value. The Analysis window has no open ends
  (ADR-018), so its run always sets a Fixed window with both ends.
- **Two zoom adapters, because two things vary.** A range inside the whole
  Spread, for the ten bounds. An extent around the Analysis window, which
  triples per step as before and pans in time up to now; its scrollbar runs
  from the oldest stored Post of the selected Channels to now.
- **One Number bound editor.** Its numbers come from local values it bins,
  zooms and counts itself, or from a read its caller makes for the zoom it is
  given. The differences are switches: a floor, whole numbers, No value.
- **A Spread read from the server keeps its bars** while the next read loads,
  and waits a beat after the last wheel tick before asking.

## Alternatives considered

- **Keep `Spread` for the time editors** and merge only the number charts.
  Rejected: two charts drift the same way four editors did, and the click-only
  Spreads lacked range picking for no reason.
- **Keep the Directory's click.** Rejected: dragging over one bar is a click,
  so nothing is lost.
- **Leave the Analysis window chart alone**, as ADR-033 froze it. Rejected:
  it is the Spread people use most, and it lacked full screen and panning.
- **Force the Analysis window onto range zoom.** Rejected: it has no whole
  Spread to zoom inside; its extent is defined around the window.
- **Every caller passes ready bars and a count.** Rejected: binning and
  counting local values would be written twice again.

## Consequences

- A change to how a Spread picks, zooms or pans reaches every bound and the
  Analysis window at once.
- The Directory and the click-only time Spreads now take ranges, and their
  bar title tooltips give way to the caption.
- The Number bound editors share one back label ("conditions"), one no-value
  note, one Add wording and one set of test ids; the Playwright specs that
  name the old ids change with them.
- The Analysis window chart gains a zoom row, a scrollbar and full screen;
  its snapshot test changes, deliberately.
