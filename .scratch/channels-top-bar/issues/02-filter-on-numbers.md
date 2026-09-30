# CTB-02: Filter on numbers

**What to build:** An Account can filter Channels on how big and how active they are. A
**Filters** dropdown on row 1 lists eleven criteria. Picking one opens an editor that shows a
histogram of the Account's own Channels on that number, lets them drag across it to choose a
range, and says how many Channels the bound keeps before adding it. Each bound is a Condition in
the Channel filter, so it shows as a chip, travels in the URL and combines with everything else.
See `.scratch/channels-top-bar/spec.md`, "The Channel filter" and "The URL form", and user
stories 19 to 32.

**Blocked by:** CTB-01

**Status:** ready-for-agent

### The criteria

- [ ] Subscribers, Reach, activity rate (Posts per hour), total Posts, Posts in the Scope, days
      since the last update, days followed, and the photo, video, file and link counters. Each
      value comes from the channel list, the channel stats or the in-Scope counts the tab already
      loads; nothing new is fetched
- [ ] A Channel with no value for a number fails any bound on it; days are measured from when the
      page loaded

### The Filters dropdown and editor

- [ ] Filters sits on row 1 after Languages, looks like the other dropdowns (sliders icon, a count
      badge of number Conditions, the chevron), and fills in when one is set
- [ ] It has a search box and lists every criterion with its current bound, or several bounds when
      the criterion is used more than once
- [ ] Picking a criterion opens its editor: at least, at most, between, and **no value**; one or
      two number fields; and an Add button that reads "Add · N of M measured"
- [ ] The editor explains that a Channel with no value does not match a bound, and "no value"
      finds exactly those Channels; NOT on it (from CTB-03) means "has a value"
- [ ] Adding always creates a new Condition at the root, so the same criterion can appear several
      times. Clicking a number chip in the filter row reopens its editor on that Condition and
      Update replaces it

### The histogram

- [ ] 32 bars over the known range of the Account's Channels, the bars inside the current bound
      drawn solid, a caption with the low, median and high values
- [ ] The axis is logarithmic when the range spans more than two orders of magnitude, and says so
- [ ] Dragging across bars, or clicking one, sets the bound: a run touching the first bar becomes
      "at most", one touching the last bar "at least", anything else "between". Edges round to two
      significant figures
- [ ] Hovering a bar says how many Channels it holds and its range

### The URL and the row

- [ ] Number Conditions print and parse in the text form (`reach >= 200`, `subscribers <= 100`,
      `reach 200..1000`, and a form for "no value"), and survive a round trip
- [ ] Number chips read like "Reach ≥ 1.2k" or "Subscribers 500–20k"

### Tests

- [ ] Evaluation of every criterion, bounds at both edges inclusive, a missing value failing a
      bound, "no value" passing only a missing value; the URL round trip for number Conditions.
      Prior art: CTB-01's Channel filter tests
- [ ] Component tests for the editor: the operator a drag gives at the first bar, the last bar and
      in between, the rounding, the log axis switching on, and the "N of M" count
- [ ] The Channels end-to-end spec gains adding a Reach bound and seeing the count drop
- [ ] Every new test is watched failing before it is trusted
