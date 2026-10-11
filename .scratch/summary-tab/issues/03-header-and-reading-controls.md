# SUMTAB-03: Header and reading controls

**What to build:** A Summary's header becomes two lines. The title sits beside icon-only actions
(note, re-analyze, copy text, export Markdown), each with a spoken name and a tooltip. Under it, one
line reads the Analysis window's duration, its range in the reader's zone with the shared date
written once, the zone's city, then the number of Channels and Covered Posts ("3h · Oct 7, 2026,
9:27 AM – 12:27 PM (Tehran) · 51 channels · 447 posts"); a muted line gives the AI model, Output
language and how long ago it was generated. Below the header, reading controls let the reader pick
text size S, M or L, remembered per Account, and every section of the prose gets a fold chevron. The
existing publish controls stay reachable until SUMTAB-09 replaces them. See
`.scratch/summary-tab/spec.md`, user stories 1-7 and 15-17, and "Header, strip and reading controls"
under Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** done

### Header

- [x] Line one: duration, the window range through the locale's range formatter, the reader's zone city, Channel count, Covered Post count. A Scope with no recorded window says so; a Summary with no Covered Posts on record omits the post count rather than showing zero
- [x] Line two: AI model, Output language, relative age
- [x] Note, re-analyze, copy and export are icon buttons with accessible names and tooltips, and keep their current behaviour (the note button marks an existing note)
- [x] The old chip row and boxed toolbar are gone; the header is roughly half its previous height on desktop and fits a 390px phone without overflow

### Reading controls

- [x] Text size S/M/L changes the prose size and is a per-Account setting in the frontend settings schema
- [x] Sections are found from Markdown headings and from lines that are a single bold phrase; each folds and unfolds, and fold state is not stored

### Tests

- [x] A rendered Summary test asserts both header lines, the not-recorded states, and that the text size choice persists through the settings store
