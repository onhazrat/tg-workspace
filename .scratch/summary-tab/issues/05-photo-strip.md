# SUMTAB-05: Photo strip

**What to build:** Near the top of a Summary, a strip shows the photos of the Cited Posts that have
one, in the order the prose first cites them, running in the Summary's reading direction (right to
left in a right-to-left Summary). Tapping a tile opens the full-size viewer over the strip's photos,
where "Find in report" jumps to that photo's Citation; a small Locate button in each tile's corner
jumps without opening it. The text-size controls sit below the strip. See
`.scratch/summary-tab/spec.md`, user stories 8-14, and "Header, strip and reading controls" under
Implementation Decisions.

**Blocked by:** SUMTAB-01 (the viewer it opens), SUMTAB-04 (Cited Post resolution and finding a
Citation).

**Status:** done

- [x] The strip lists only Cited Posts with a photo, in first-Citation order, and skips the rest; with none it says so (or that Posts are loading)
- [x] In a right-to-left Summary the strip runs right to left, and the viewer's next/previous follow it
- [x] The viewer accepts an optional action over the photo on screen; the strip uses it for "Find in report", which closes the viewer and then finds the Citation
- [x] Each tile has a corner Locate button, translucent and tucked into the corner, that finds the Citation without opening the viewer
- [x] Stepping through the viewer covers every strip photo
- [x] A rendered Summary test covers the order, the right-to-left direction, and both ways to find a Citation
