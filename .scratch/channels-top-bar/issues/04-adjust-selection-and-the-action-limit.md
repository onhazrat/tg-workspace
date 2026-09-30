# CTB-04: Adjust selection, and the action limit

**What to build:** An Account can change the selection relative to what the filters show, and the
Channels tab stops changing Channels the Account cannot see. **Adjust selection** in the bulk
toolbar opens a Venn of Selected and Shown with a count in each region; clicking a region keeps or
drops it, five presets name the common edits, and a line says "52 → 30 selected, −40 dropped,
+18 added" before Apply. When the filters hide part of the selection, row 2 says so, and every row
2 action, Trim and the sort rank reach only the Shown Channels unless the Account chooses all of
the selection. The limit stays on this tab: the Scope, the Posts tab and every Artifact still see
the whole selection. See `.scratch/channels-top-bar/spec.md`, "Selection" and "Persistence and
commands", and user stories 57 to 78 and 101.

**Blocked by:** CTB-01

**Status:** done

### Selection edits

- [x] A pure module computes the three regions (the Hidden selection, selected and shown, shown
      and not selected) and applies a choice of regions to kept or dropped. The five named edits
      are the rows of the spec's table: Add shown, Remove shown, Keep only shown, Invert shown,
      Select only shown
- [x] Adjust selection sits in the bulk toolbar and replaces today's All and Invert there. Today's
      meanings stay reachable as Select only shown and Invert shown, in the popover and the palette
- [x] The popover: a two-circle Venn labelled Selected and Shown, each region clickable and a
      keyboard checkbox (Tab to reach, Space or Enter to switch), filled in its own colour when
      kept, hatched with a faded count when dropped
- [x] Five presets with small Venn icons in a grid; the one matching the picture lights up, and
      any other picture reads "custom"
- [x] The line under it: "before → after selected", "−N dropped", "+N added", or "no change";
      Apply reads "Apply · N selected" and is disabled when nothing would change; applying closes
      the popover
- [x] Changing a filter never changes the selection; only these edits and the existing selection
      controls do. Shift-click range selection keeps working

### The action limit

- [x] "Actions apply to: Shown / All" is an Account preference in the settings schema, default
      Shown, remembered per Account
- [x] With it on Shown: Sync, Freeze, Unfreeze, Move to group, Add tag, Remove tag and Delete
      receive only the selected Shown Channels; Trim ranks only those and writes back the Hidden
      selection plus what it kept; the card sort rank counts the same set, so "#N" is its place in
      what Trim keeps. The rank tooltip says so
- [x] With it on All, every one of them behaves as today
- [x] Row 2 shows an indicator only while the Hidden selection is non-empty: amber "N hidden by
      filters" on All, blue "acting on N shown" on Shown; clicking it switches the limit. Trim's
      label reads "Keep first N shown" while the limit narrows it
- [x] The popover repeats the choice as a two-way control naming what it covers: actions, trim and
      sort rank
- [x] The freeze, unfreeze and delete confirmations name both numbers when the Hidden selection is
      non-empty: "Delete 12 Channels. 40 selected Channels hidden by filters are not affected."
- [x] The Scope, the Posts tab and every Artifact use the whole selection, the Hidden selection
      included, whatever the limit says

### Palette

- [x] The five edits and "Actions apply to: Shown / All" are palette commands, each disabled with a
      reason when it would change nothing

### Tests

- [x] Selection regions: the five edits on a selection with all three regions non-empty, no-op
      detection, and the set the limit yields. Trim under the limit keeps the Hidden selection, and
      the Channel ranked 1 is the one Keep first 1 keeps. Prior art: the trim and sort rank tests
- [x] Component tests for the Venn: a region click drops or keeps those Channels in the result,
      keyboard toggling, the matching preset, and the before/after line
- [x] A test that the Scope sent with an Action carries the Hidden selection while the limit is on
      Shown. Prior art: the Scope and Action submission tests
- [x] The Channels end-to-end spec gains: select everything, narrow the filter, see the
      indicator, run Add tag and see the request carry only the Shown Channels, switch to All and
      see it carry all of them
- [x] Every new test is watched failing before it is trusted
