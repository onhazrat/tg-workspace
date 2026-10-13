# DFP-02: The Directory on a phone

**What to build:** Below the `md` breakpoint the Directory shows rows on its first screen: the
filter controls fold into one sheet behind a button beside a full-width search box, rows become
two-line cards with a large tick, the detail panel opens as a bottom sheet over the list, and the
bulk bar stays on one line. A wide screen is unchanged. See
`.scratch/directory-follow-picks/spec.md`: user stories 46 to 53, and the phone layout decision.
Variant F is the reference; its README notes what was measured at iPhone 12 Pro size.

**Blocked by:** DFP-01

**Status:** resolved

- [x] Beside the search box, a button showing how many Conditions are on opens a full-screen "Filters and sort" sheet with every control, the Name / Bio / Posts switches included, and a Done button; the controls' popovers open above the sheet
- [x] The search box keeps the full width on a phone
- [x] Rows render as cards: a large tick, avatar, name, handle, the sorted measure and Subscribers, Reach, Posts per week and Language, and Shared counts when a Shared Condition is on; tapping a card opens the panel, tapping its tick or Follow does not
- [x] The panel is a bottom sheet of about 55% of the screen with a handle; the list stays scrollable above it and tapping another card switches it
- [x] The bulk bar is one line that scrolls sideways
- [x] The Keyboard switch is hidden on a phone
- [x] At `md` and up, the table, bar, bulk bar and side panel are exactly as before
- [x] Playwright at a phone viewport: the filter button opens the sheet, cards render, a card opens the bottom sheet
- [x] The new branching components have render tests (the CRAP ratchet)
