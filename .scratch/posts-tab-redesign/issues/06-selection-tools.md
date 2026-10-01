# PTR-06: Selection tools

**What to build:** The Post selection gets the tools the Channels selection has. A tick on a
dropdown row (Arabic, Video, Forwarded) selects or deselects every Post with that value in the
window, whatever the filter shows, recorded as a Selection rule, and each row says how many of its
Posts are selected. The Channels tab's Adjust selection Venn works here, its presets recorded as
rules. "Selected first" lists the selected Posts the filter shows before the rest, in the feed's
own order. "Copy links" and "Export Markdown" take the selected Posts the filter shows elsewhere.
This ticket also lands the spec's end-to-end journey, once every piece it drives exists. See
`.scratch/posts-tab-redesign/spec.md`, "The Post selection", and user stories 56 to 57, 65 to 66
and 69.

**Blocked by:** PTR-05

**Status:** done

### Facet ticks

- [x] Each row of the Type, Media and Language dropdowns gets the tick column: all, some or none
      selected, and "selected/total" over the window, filters aside, from the facets read.
      As built, `/data/posts/facets` takes the Post selection and each value carries `selected`;
      the rows have no tick while the counts are unknown (a meaning search)
- [x] A tick on a row that is not fully selected appends "select every Post with this value"; on a
      fully or partly selected row it appends "deselect every Post with this value". The rule's
      snapshot is that one Condition and nothing of the current filter. As built, a partly
      selected row selects, as on Channels; only a fully selected row deselects. In a Channel
      spotlight the rows count that Channel, so the rule names it beside the value
- [x] The line over the rows says what a tick does here, which differs from Channels on purpose

### The Venn

- [x] The Channels Adjust selection component, without the action limit, which the Posts tab does
      not have. Its three regions (selected and hidden by the filter, selected and shown, shown and
      not selected) come from the server's counts. As built, `SelectionAdjust` is the shared
      component and both tabs hand it region sizes; the counts read gained `selectedShown`, the
      selected Posts the filter shows, cap included, and takes the cap's mode, seed and order
- [x] Presets append rules over the current filter F: add shown = select F; remove shown =
      deselect F; keep only shown = deselect NOT F; select only shown = deselect all, then select F.
      As built, a rule carries `not`, because a keyword or a cap has no inverse inside the tree;
      it is left out of the wire when false, so every rule stored before reads back as sent. The
      Venn cannot open over a meaning search, whose ranking no rule repeats
- [x] "Invert shown" is not offered, and the region picture that would need it is not clickable,
      because a rule cannot flip each Post's current state

### Selected first, copy and export

- [x] A "Selected first" switch in the selection bar, the Channels tab's own toggle component. On,
      the feed request asks the server to order the selected Posts the filter shows before the rest,
      each part in the feed's own order. Paging keeps working. As built, a session switch like
      Compact grid; over a meaning search it sorts the ranked results by their flag
- [x] "Copy links" copies the Telegram links of the selected Posts the filter shows, and "Export
      Markdown" downloads them as a Markdown file; both fetch them from the feed with
      `onlySelected`, up to 5,000, and say so when they hit the limit. As built, `onlySelected`
      applies after the cap, so it is exactly the selected Posts the feed would show

### Tests

- [x] Route tests: facet selected/total; `selectedFirst` ordering under each sort and with paging;
      `onlySelected` with a filter and the 5,000 limit. As built, in `test_post_selection.py`,
      with the negated rule and `selectedShown`; each new predicate watched to fail
- [x] Component tests for the Posts facet dropdown's tick states and the rules a tick appends, the
      Venn presets on Posts and the refused picture
- [x] The end-to-end journey (Playwright, a mocked API, a new Posts spec beside the other
      `summarizer-*` specs, run serially): build a filter with a NOT and parentheses and see the
      request carry it; tick Arabic in the Language dropdown and see a Deselect rule chip; untick
      one Post and see a Pick chip; change the window and see the rule re-applied in the request
      while the Pick stays; switch Selected first; run Summarize and see the request carry the
      whole selection; reload and find the filter in the URL and the selection still there. As
      built, `summarizer-posts-selection.spec.ts`; Summarize is the copied prompt, whose request
      is the one that carries the Scope. Watched to fail with the tick and Selected first unwired
