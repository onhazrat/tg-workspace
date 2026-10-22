# RQS-07: The zoomable trend

**What to build:** Under the daily bars, a zoomable trend gets finer as the Operator zooms, down to 5 minutes for the last week, with each bucket's exact count on hover. Spec: "Zoomable trend".

**Prototype:** variant A on [`prototype/request-stats` @ b793f374](https://github.com/onhazrat/tg-workspace/tree/b793f3743ee41f41a02ef43ac5c0427d0da36c4d), the working reference for this behaviour; its README says how to run it. Port the behaviour, not the code: the prototype's data layer is synthetic (spec, Further Notes).

**Blocked by:** RQS-06

**Status:** ready-for-agent

- [ ] Plotly (`plotly.js-dist-min` 3 through `react-plotly.js`'s factory), loaded only with the tab.
- [ ] Buckets re-summed to about 220 across the view, stepping through 5, 15 and 30 minutes, 1, 2, 4, 6 and 12 hours and a day, never finer than the tier keeps; sums, never averages.
- [ ] Hover gives a bucket's UTC span, grain and exact count.
- [ ] Buckets of 30 minutes or more are drawn as a spline (smoothing 0.6), finer ones as steps.
- [ ] Times go to Plotly as zoneless UTC strings, so the axis, hover and picked ranges agree in any browser time zone.
- [ ] Range slider, range buttons (6h, 1d, 7d, 30d, All), tier bands, full screen without a remount (Esc leaves, zoom kept), and "Use the visible range" sets the tab's range.
- [ ] Unit tests for the re-bucketing logic; tests at seam 2 of the spec: a Playwright journey over the mocked Requests API, plus render tests for each new branching component (CRAP ratchet).
- [ ] Every new test and guard is mutation-checked, named in the commit body as `Mutation-checked: ...`; no existing guard is loosened.
