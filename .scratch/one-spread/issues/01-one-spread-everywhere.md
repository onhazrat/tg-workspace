# SPR-01: One Spread everywhere

**What to build:** Every Spread in the app is one Spread, and an Account picks,
zooms, moves and goes full screen the same way in all eleven places: the four
Number bounds (Channel, Directory, Post, Requests), the five Time bounds
(Directory moments, Channel moments, Logs, History, Requested) and the Posts
tab's Analysis window chart.

- A drag across bars picks a range and a click picks one bar; the bars the
  bound keeps draw solid; the caption names the hovered bar, or the median
  (and a log scale) while nothing is hovered.
- A pick touching the first or last bar of the whole Spread leaves that end
  open, unless the zoom hides that edge; touching both keeps everything with a
  value. The Analysis window refuses open ends, so its pick always sets a
  Fixed window with both ends.
- Every Spread has zoom in and out, a scrollbar along a zoomed Spread, panning
  by wheel and by the arrow keys on the focused scrollbar (a quarter of what
  is shown, not reaching shortcuts outside the popover), and full screen
  above the popover that keeps the zoom and returns to the editor on leaving.
- Two zoom adapters behind one seam: a range inside the whole Spread for the
  ten bounds, on the existing zoom rules; and the Analysis window's extent,
  which triples per step around the window, pans in time up to now and back
  to the oldest stored Post of the selected Channels, sends whole minutes,
  and has a scrollbar over that span with a thumb that stays grabbable. A
  caption outside the current year names its year.
- A Spread the server draws keeps its bars while reading and commits a pan
  about 150 ms after the last wheel tick, key or thumb move; the thumb moves
  at once.
- The Requested Spread keeps its 7-day and 30-day lines as marks over the
  bars, and picks by the same rule as every other Spread.
- One binning function (linear for moments, logarithmic past a hundredfold,
  32 bars on the whole Spread's scale) replaces the two, and binning, the
  median and two-figure rounding move out of component files into one
  library module. The four Number bound editors keep their own forms in this
  ticket and only swap their chart; SPR-02 replaces the forms.
- The two old charts are deleted, with their duplicate helpers. Nothing is
  gated by a variant.

The pick and zoom shapes the prototype settled on (trimmed):

```ts
type Pick = { min?: number; max?: number; all: boolean; run: { from: number; to: number } }
type ZoomKit = {
  canIn: boolean; canOut: boolean; zoomIn(): void; zoomOut(): void
  pan?: (fraction: number) => void
  thumb?: { left: number; width: number } | null
  moveTo?: (left: number) => void
}
```

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (user stories 1 to 41 and 58 to 62,
Implementation Decisions, Testing Decisions), `docs/adr/ADR-037-one-spread.md`,
`docs/one-spread-plan.md` (decisions 2, 9 to 16), and the prototype at
`prototype/one-spread-snapshot` @ 951326bb: the Spread and its range adapter
are `OneSpread`, the extent adapter is `WindowChart1`, a run as a Time bound
is `time-pick`. Port the decisions, renamed, ungated and test-first; nothing
else is ported.

- [ ] One Spread module draws every Spread; the two old charts are gone.
- [ ] A click and a drag pick the right bars on all eleven Spreads.
- [ ] The open-end rule holds on every bound, including a zoom that hides an edge, and the Analysis window always sets a Fixed window.
- [ ] Zoom, scrollbar, wheel pan, arrow-key pan and full screen work on all eleven, and full screen keeps the zoom and returns to the open editor.
- [ ] The Analysis window chart pans between its oldest stored Post and now, in whole minutes, and names the year outside the current one.
- [ ] Server-drawn Spreads keep their bars while reading and read once a pan settles.
- [ ] Requested keeps its tier lines.
- [ ] One binning function serves numbers and moments, in a library module.
- [ ] Render tests pin the Spread through its interface, both zoom adapters included; each caller's test checks only how a pick becomes its bound.
- [ ] The Analysis window editor's snapshot is updated once, deliberately, and its other assertions pass unedited.
- [ ] The Playwright specs that name the old chart test ids use the new ones, and the frontend unit suite, typecheck and lint pass.
