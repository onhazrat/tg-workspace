# Spec: One Spread and one Number bound editor

Status: ready-for-agent

Decisions: `docs/adr/ADR-037-one-spread.md` and `docs/one-spread-plan.md` (16
settled decisions and what each rejected). Prototype: variant 1 on
[`prototype/one-spread-snapshot` @ 951326bb](https://github.com/onhazrat/tg-workspace/tree/951326bbbd56ded16625f576f78bdc2376ff9c92),
approved unchanged; what it checked is in `prototype.md` beside this file.
Vocabulary (Spread, Number bound, Time bound, Analysis window, Live window,
Fixed window, Condition, Channel filter, Directory filter, Post filter,
Directory entry, Request, Scope) is `CONTEXT.md`'s. Ticket ids carry the
prefix `SPR`.

## Tickets

Two tickets in `issues/` beside this file, one per PR. SPR-02 draws the
Spread SPR-01 builds, so SPR-01 merges first.

| Id | Ticket | Blocked by |
|---|---|---|
| SPR-01 | One Spread everywhere (`issues/01-one-spread-everywhere.md`) | None |
| SPR-02 | One Number bound editor (`issues/02-one-number-bound-editor.md`) | SPR-01 |

A ticket closes as `docs/agents/issue-tracker.md` says.

## Problem Statement

An Account picks a bound from a Spread in eleven places: four Number bounds
(the Channel filter, the Directory filter, the Post filter and the Requests
tab's channel table), five Time bounds (Directory moments, Channel moments,
the Logs tab, History and the Requests tab's Requested range) and the Posts
tab's Analysis window. Today those Spreads behave differently depending on
where the Account is:

- On the Directory and on every time filter but Requested, a Spread takes one
  clicked bar; elsewhere it takes a dragged run. The same gesture does
  different things on two tabs.
- Only the Requested Spread can go full screen, be scrolled along, or be
  panned with the wheel or the arrow keys. The Spread the Account uses most,
  the Analysis window chart, can do none of it.
- Whether a pick leaves an end open depends on the Spread: the number editors
  open an end at either edge, the Logs, History and Directory moments only at
  the last bar, Requested never.
- The four Number bound editors say different things: "Back to the criteria"
  in three and "conditions" in one, four wordings on Add ("12 of 40
  measured", "12 of 40 with this number", a server count, nothing), and two of
  them start from the median while two start empty with no rule the Account
  can see.

For whoever changes them, a fix to one Spread or one Number bound editor
reaches one place and leaves the other copies as they were, which is how they
drifted.

## Solution

Every Spread is one Spread, and every Number bound is edited with one editor.

- Everywhere a Spread is drawn, the Account drags across bars to pick a range
  (a click is a range of one bar), sees what the hovered bar holds, zooms in
  and out, moves along a zoomed Spread with the wheel, the scrollbar or the
  arrow keys, and opens it full screen without losing the zoom.
- A pick that touches the first or last bar of the whole Spread leaves that
  end open, in every filter that allows open ends; touching both keeps
  everything with a value. The Analysis window has no open ends, so a pick
  there always sets a Fixed window.
- The Analysis window chart keeps its own zoom, which triples per step around
  the window, and gains panning, full screen and a scrollbar running from the
  oldest stored Post of the selected Channels to now. A caption outside the
  current year names its year.
- Every Number bound editor reads the same: the same back label, the same
  no-value note, "Add · 12 of 40" (or "Add · 8 with no value") where the count
  is known locally, the server's count where it is read, and the median
  prefilled only when the bars are known as the editor opens.

## User Stories

### Picking from a Spread

1. As an Account, I want a drag across bars to pick a range in every Spread, so that one gesture works on every tab.
2. As an Account, I want a click on one bar to pick that bar, so that a quick pick still takes one click.
3. As an Account, I want the bars my bound keeps drawn solid, so that I can see what the bound leaves before adding it.
4. As an Account, I want the caption to name the hovered bar's count and range, so that I can read a bar without a tooltip that appears late.
5. As an Account, I want the caption's ends to show the range the bars span now, so that I know where a zoomed Spread is.
6. As an Account, I want the caption to show the median while nothing is hovered, so that I know where the middle of the Spread is.
7. As an Account, I want a log-scale Spread to say so in its caption, so that I read its bars correctly.
8. As an Account, I want a pick touching the first bar of the whole Spread to leave the low end open, so that "at most" is one drag.
9. As an Account, I want a pick touching the last bar of the whole Spread to leave the high end open, so that "at least" is one drag.
10. As an Account, I want a pick touching both ends to keep everything with a value, so that "has a value" is one drag.
11. As an Account, I want a zoomed Spread whose edge is hidden not to open that end, so that a pick inside the zoom means exactly the bars I picked.
12. As an Account, I want a pick on the Analysis window chart always to set a Fixed window with both ends, so that the window stays a window.
13. As an Account, I want a Directory Spread to take a dragged range, so that I can pick "between" without typing.
14. As an Account, I want a Directory moment's, a Channel moment's, the Logs tab's and History's Spread to take a dragged range, so that a time pick is not one bar wide.
15. As an Account, I want a Channel moment's pick to keep exactly the Channels its bars count, so that the count on Add matches the bars.

### Zooming and moving along a Spread

16. As an Account, I want zoom in and zoom out on every Spread, so that a crowded Spread can be read.
17. As an Account, I want zoom in to centre on my bound, or on the median without one, so that the zoom lands where I am looking.
18. As an Account, I want a zoomed Spread to show a scrollbar along the whole Spread, so that I know which part I am looking at.
19. As an Account, I want to drag the scrollbar to move along a zoomed Spread, so that I can reach any part quickly.
20. As an Account, I want the wheel or a trackpad swipe over the bars to move along a zoomed Spread, so that moving does not need the scrollbar.
21. As an Account, I want the arrow keys on a focused scrollbar to move a quarter of what is shown, so that I can move along a Spread from the keyboard.
22. As an Account, I want the arrow keys on a focused scrollbar not to reach a shortcut outside the popover, so that moving the Spread does nothing else.
23. As an Account, I want a scroll over the bars not to scroll the popover around them, so that moving the Spread keeps the editor still.
24. As an Account, I want the scrollbar's thumb grabbable however long the history is, so that a thin thumb is still usable.
25. As an Account, I want a Spread the server draws to keep its bars on screen while it reads the next part, so that moving along it does not flash empty.
26. As an Account, I want a Spread the server draws to wait until I stop moving before it reads again, so that a swipe does not send dozens of reads.
27. As an Account, I want the scrollbar's thumb to follow my drag at once even while the bars wait, so that I can see where I am going.

### Full screen

28. As an Account, I want every Spread to open full screen, so that a dense Spread can be read and picked from precisely.
29. As an Account, I want full screen to keep the zoom and the place I was at, so that opening it does not lose my place.
30. As an Account, I want picking, zooming and moving to work the same in full screen, so that nothing is lost by opening it.
31. As an Account, I want full screen to be titled with what the Spread counts, so that I know which Spread I am looking at.
32. As an Account, I want leaving full screen, with its button or Escape, to return me to the editor still open, so that I can carry on with the bound.

### The Analysis window chart

33. As an Account, I want the Analysis window chart to keep its own zoom, three times the window and three times again per step, so that it still shows the Posts around my window.
34. As an Account, I want to move the Analysis window chart back in time and forward again up to now, so that I can see the Posts before my window.
35. As an Account, I want the Analysis window chart's scrollbar to run from the oldest stored Post of my selected Channels to now, so that I can reach anything I have.
36. As an Account, I want the chart not to move past now or back before my oldest stored Post, so that it never shows an empty future or an empty past.
37. As an Account, I want a caption outside the current year to name its year, so that "Jul 9" two years ago is not mistaken for this July.
38. As an Account, I want the Filtered and All posts switch to stay beside the chart, so that the chart counts what I chose.
39. As an Account, I want the Analysis window chart to go full screen, so that I can pick a window from a long history precisely.

### The Requests tab's Requested range

40. As an Account, I want the Requested Spread to keep its 7-day and 30-day lines over the bars, so that I know where single Requests and hours stop being kept.
41. As an Account, I want the Requested Spread to pick ranges and open ends by the same rule as every other Spread, so that it is not a special case.

### One Number bound editor

42. As an Account, I want every Number bound editor to offer at least, at most and between, and No value where a number can be absent, so that bounds work the same in every filter.
43. As an Account, I want No value left out where a number always has one, so that I am not offered a bound that keeps nothing.
44. As an Account, I want a number that cannot be negative to refuse a negative field, so that I cannot type a bound the server rejects.
45. As an Account, I want a bound on a whole number rounded inward and refused when no whole number is left, so that a Channel posts bound means what it says.
46. As an Account, I want the same back label, "Back to the conditions", in every editor, so that the words match the glossary.
47. As an Account, I want one note on what No value means, with how many have no value where that is known, so that I understand why those entries fail a bound.
48. As an Account, I want Add to say how many of the measured entries the bound keeps, where that is counted in the browser, so that I can judge a bound before adding it.
49. As an Account, I want Add to say how many have no value when I choose No value, so that the count matches the choice.
50. As an Account, I want Add to show the server's count in the Directory, so that a bound over a million entries still shows what it keeps.
51. As an Account, I want Update in place of Add when I am changing a Condition, so that I know the editor changes rather than adds.
52. As an Account, I want the field prefilled with the median when the bars are known as the editor opens, so that a sensible start is one click from Add.
53. As an Account, I want the field left empty when the bars arrive later, so that the field does not change under me.
54. As an Account, I want the number's name, unit and description at the top of the editor, so that I know what I am bounding.
55. As an Account, I want "Loading the spread" while the bars are read, and a plain line when nothing has a value, so that an empty editor explains itself.
56. As an Account, I want Add disabled while the fields spell no bound, so that I cannot add an incomplete Condition.
57. As an Account, I want a pick on the Spread to fill the operator and the fields, so that I can adjust a picked bound by typing.

### Keeping main's behaviour where nothing was decided

58. As an Account, I want the Analysis window editor's mode switch, four fields and elapsed shortcuts to look and behave as before, so that only the chart changed.
59. As an Account, I want the Time bound editor's fields and modes to stay as they are, so that ADR-033's editor is untouched.
60. As an Account on a phone, I want dragging, zooming, the scrollbar and full screen to work by touch inside a bottom sheet, so that the phone layout is not left behind.
61. As an Account using a screen reader, I want the scrollbar announced as a scrollbar controlling the bars, so that I know what it moves.

### For whoever changes them next

62. As a maintainer, I want one Spread module, so that a fix to picking, zooming or moving reaches all eleven places at once.
63. As a maintainer, I want one Number bound editor whose differences are switches, so that a fifth Number bound is a few lines.
64. As a maintainer, I want the Spread tested through its own interface, so that its rules are pinned once and not per caller.
65. As a maintainer, I want each caller's tests to check only how a pick becomes its bound, so that the callers' tests stay small.

## Implementation Decisions

- **One Spread module** replaces the two charts. It draws bars it is given
  (each a low edge, a high edge and a count), the solid bars for a bound in
  the Spread's own values, the hover caption, an optional row of marks, the
  zoom row, the scrollbar and full screen. It knows nothing about Channels,
  Posts or bound types: a pick comes back in the Spread's values, with which
  ends are open and which bars the run covered, and the caller turns it into
  its own bound. The shape the prototype settled on:

  ```ts
  // From the prototype: what a run picked, in the Spread's values.
  type Pick = {
    min?: number // undefined: the low end is open
    max?: number // undefined: the high end is open
    all: boolean // the run touched both ends of the whole Spread
    run: { from: number; to: number } // the bars it covered
  }
  ```

- **The open-end rule lives in the Spread**, not in its callers. The Spread is
  told the whole Spread's ends (or that it has none) and whether open ends are
  allowed; an end opens only when the run touches that edge and the zoom shows
  it. With no whole, or open ends refused, both ends are always set.
- **Two zoom adapters at one seam.** The Spread takes a zoom kit: whether it
  can zoom in and out, the two zoom actions, an optional pan by a fraction of
  what is shown, and an optional thumb with a way to move it. One adapter is a
  range inside the whole Spread, built on the existing zoom rules (a third per
  step, centred on the bound or the median, six steps at most, log steps in
  log space); it pans and places the thumb in the same space as it zooms. The
  other is the Analysis window's extent: it triples per step around the
  window, pans in time, clamps to now and to the oldest stored Post of the
  selected Channels, and sends whole minutes, because the window histogram
  refuses a fractional extent. From the prototype:

  ```ts
  type ZoomKit = {
    canIn: boolean
    canOut: boolean
    zoomIn: () => void
    zoomOut: () => void
    pan?: (fraction: number) => void // a fraction of what is shown
    thumb?: { left: number; width: number } | null // percent of the whole
    moveTo?: (left: number) => void // the shown part's left edge, 0..1 of the whole
  }
  ```

- **Settling before a read.** An adapter over a server-drawn Spread holds the
  moving position for the thumb and commits it to the read about 150 ms after
  the last wheel tick, key or thumb move. Every server read the Spreads use
  already keeps the previous bars while loading; that stays.
- **Full screen** is a dialog above the popover, so picking in it keeps the
  popover open; it reuses the Spread with taller bars and the same zoom kit,
  titled by the caller.
- **One Number bound editor** with two sources:

  ```ts
  // From the prototype.
  type NumberSource =
    | { kind: "values"; values: number[]; total?: number } // sorted; the editor bins, zooms, counts
    | {
        kind: "read"
        read: ReadBars | null | undefined // undefined while loading, null when nothing has a value
        zoom: ZoomState // the caller reads for this zoom
        count?: (bound: MetricBound) => ReactNode
      }
  ```

  and three switches: a floor (Post and Requests numbers cannot go below
  zero), whole numbers (Channel posts measures), and whether No value is
  offered. It owns the operator and the two fields, the median prefill rule,
  a pick filling the fields, and the Add wording. It absorbs the existing
  operator-and-fields part, whose seven props were its caller's state passed
  through. A picked edge is rounded to two significant figures, except the
  "everything with a value" pick, which keeps the whole Spread's low end
  exactly.
- **The four Number bound callers become adapters**: the Channel filter and
  the Requests channel table pass local values; the Directory filter passes
  its server spread for the container's zoom and its count; the Post filter
  reads its value histogram for the editor's zoom, on the scale first drawn.
- **The time callers keep their editors** and swap only the chart: a pick on
  a server-drawn moment becomes a Fixed Time bound out to whole minutes, the
  last bar counting its high edge, open ends dropped; a Channel moment's pick
  covers the minutes its bars hold. Requested picks the bars' edges.
- **One binning function** replaces the two (numbers and Channel moments):
  linear for moments, logarithmic once a number spans more than a hundredfold,
  32 bars over the zoom's range on the whole Spread's scale. Binning, the
  median and the two-figure rounding move out of the component files into one
  library module, and their duplicate definitions go.
- **Copy and test ids are unified**: one back label, one no-value note, one
  Add wording, one set of test ids for the Number bound editor and one for the
  Spread (prefixed by the caller where two Spreads share a screen).
- **The variant gate does not ship**: the real code replaces the old editors
  and charts outright. The prototype's code is not promoted.

## Testing Decisions

- A good test drives a module through its interface and checks what the
  Account would see or get: the bound that comes back, the bars drawn solid,
  the caption's words, the count on Add. It does not reach into state, hooks
  or class names.
- **Seam one: the Spread.** Render tests with bars given directly and pointer
  and key events on the bars and the scrollbar: a click and a drag pick the
  right range; touching each edge opens that end only when the zoom shows it;
  both edges give everything with a value; refused open ends set both; solid
  bars follow the bound; the caption names a hovered bar and the median; zoom
  in centres on the bound; wheel, arrow keys and a thumb drag pan by the right
  amount and clamp at the ends; a server-drawn Spread commits a pan only after
  it settles; full screen keeps the zoom and Escape returns to the popover;
  marks draw inside the shown range only. Both zoom adapters are tested here,
  the extent one with a clock and an oldest Post given.
- **Seam two: the Number bound editor.** Render tests per source and switch:
  local values prefill the median and count "Add · N of M"; No value counts
  those with none; a read source starts empty, shows loading and the empty
  line, and shows the caller's count; a floor refuses a negative field; whole
  rounds inward and refuses an empty whole range; No value is hidden when the
  switch is off; a pick fills the operator and fields; Update replaces Add for
  an existing Condition. The Channel and Directory editors' existing tests
  fold into these.
- **Callers keep their own test files** and check only their mapping: a pick
  on a Directory or Channel moment, Logs, History or Requested becomes the
  right Time bound; a pick on the Analysis window sets a Fixed window; each
  Number bound caller passes the right source and switches.
- **The Analysis window editor's snapshot changes once, deliberately**, in the
  ticket that replaces the chart; every assertion about the mode switch, the
  fields and the shortcuts stays unedited.
- **Playwright**: the Directory, Channels, History and Requests specs that
  name the old test ids change to the new ones; the e2e suite's assertions on
  what a pick does stay.
- Prior art: the existing render tests of the Channel and Directory number
  editors, of the Requested and Logged Spreads, and of the Analysis window
  control; the Channel number editor's and the Post filter's tests already
  drive bars with pointer events.

## Out of Scope

- The Requests tab's Trend chart: it is a Plotly line chart, not a Spread.
- A count read for the Post Number bound; the Post editor stays without a
  count on Add.
- The Time bound editor's fields and modes (ADR-033), and the Analysis window
  editor's mode switch, four fields and elapsed shortcuts.
- Any server change: every Spread read already takes a zoom range, and the
  window histogram already takes any extent.
- After a one-bar pick on a server-drawn time Spread, the bar before it also
  draws solid, because the start is floored to the minute. `main` does the
  same; it is not this effort's.

## Further Notes

- The prototype checked all eleven Spreads on staging data; `prototype.md`
  lists what each check saw and where each decision's answer lives in the
  snapshot.
- A long history makes the Analysis window's scrollbar coarse (nine years in
  the prototype's data, so a 3-day extent was under 0.1% of the track); the
  thumb keeps a grabbable minimum width, and zooming out widens it. The user
  approved this as it is.
