# One Spread and one Number bound editor: plan

Origin: candidate 4 of the 2026-10-25 architecture review, grilled the same
day. Terms: **Number bound** and **Spread** in `CONTEXT.md`. Decision record:
ADR-037 (`docs/adr/ADR-037-one-spread.md`). Prototype: variant 1 on
[`prototype/one-spread-snapshot` @ 951326bb](https://github.com/onhazrat/tg-workspace/tree/951326bbbd56ded16625f576f78bdc2376ff9c92),
approved unchanged on 2026-10-25; what it checked is in
`.scratch/one-spread/prototype.md`.

## Why

Four Number bound editors repeat one editor: the op/a/b draft seeded from the
initial bound, the bar-click reset, the back-arrow form with Add or Update,
and `median` and `nice` defined twice. Two charts do one job: `BarHistogram`
(drag a run) and `Spread` (click a bar), and only the Requests tab's
Requested spread has full screen, panning and range zoom.

## Decisions

| # | Decision | Rejected |
|---|---|---|
| 1 | One Number bound editor for all four: Channel (`ChannelMetricEditor`), Directory (`DirectoryBoundEditor`), Post (`PostNumberEditor`), Requests (`MeasureEditor`) | Leaving Requests out |
| 2 | One Spread for every bound (four number editors, Directory time, Channel time, Logs, History, Requested) and the Analysis window chart; `Spread` and `BarHistogram`/`BoundHistogram` merge | Keeping Spread for time editors; keeping the Directory's click |
| 3 | The editor's numbers come from a source of two kinds: local values (the editor bins, zooms and counts) or a read (zoom to bars, with an optional count) | Every caller passing ready bars |
| 4 | One Add wording, "Add · 12 of 40", and "with no value" for No value; Post stays countless (it has no count read) | A new count read for Post |
| 5 | Prefill the median when the bars are known at mount, otherwise start empty | One rule ignoring when the bars arrive |
| 6 | Tidying is allowed: the back label says "conditions", one no-value note, one set of test ids; the Playwright specs that name the old ids are updated | Byte-identical copy and ids |
| 7 | The editor lives at `components/filter-tree/NumberBoundEditor.tsx` and absorbs `BoundFields`; binning, `median` and `nice` move to one `lib/` module | BoundFields as a shared part |
| 8 | Glossary: **Number bound**, **Spread** | |
| 9 | Every Spread brings the whole Requested kit: zoom buttons, panning by wheel, scrollbar and arrow keys, and full screen that keeps the zoom. The 7-day and 30-day tier lines are an optional overlay only Requests passes | Full screen alone |
| 10 | One gesture: drag a run; a click is a one-bar run; the hover caption replaces the title tooltip | Click on some Spreads |
| 11 | A run touching the whole Spread's first or last bar leaves that end open (both: everything measured), unless the zoom hides that edge | Per-editor rules |
| 12 | The Analysis window's run always sets a Fixed window with both ends (ADR-018) | |
| 13 | One binning function: linear for moments, log once a number spans more than 100x | Separate number and moment binning |
| 14 | Two zoom adapters: a range inside the whole Spread (scrollbar between known ends), and an extent around the Analysis window (triples per step, pans in time, stops at now). The Analysis window's scrollbar runs from the oldest stored Post of the selected Channels to now, as the Requested spread's runs over everything kept, and an extent outside the current year names its year | Forcing the Analysis window onto range zoom; no scrollbar on the Analysis window |
| 15 | ADR-037 supersedes ADR-033's "the Analysis window editor keeps its look and behaviour" for the chart only; the mode switch and four fields stay frozen | |
| 16 | A Spread read from the server keeps its old bars while the next read loads, and waits ~150 ms after the last wheel tick | A read per wheel tick |

## Out of scope

- The Trend chart on the Requests tab (`ZoomTrend.tsx`, Plotly): not a Spread.
- A count read for the Post Number bound.
- The Time bound editor's fields and modes (ADR-033).

## Steps

- [x] Prototype, checked on staging data and approved
- [x] Snapshot built locally (951326bb); push it before the docs PR
- [ ] Docs PR: glossary, ADR-037, this plan, prototype note, spec and tickets (SPR-01, SPR-02)
- [ ] Implementation
