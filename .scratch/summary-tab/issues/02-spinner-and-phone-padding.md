# SUMTAB-02: Two small fixes: the generating spinner and phone padding

**What to build:** While a Summary is being generated, the "Generating Summary… AI is analyzing
content" overlay covers only that Summary's tab (or the empty new-Summary tab while it is being
created), never whichever other tab happens to be active. On phones, the workspace shell's side
padding shrinks so every tab gets its width back. See `.scratch/summary-tab/spec.md`, user stories
89-90, and "The two fixes" under Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] Starting a Summary and switching to Posts, Channels, Settings or another Summary's tab shows that tab's own content, not the overlay
- [ ] The overlay and the streamed text appear on the tab of the Summary being generated, and on the new-Summary tab while no id exists yet
- [ ] On narrow screens the shell's horizontal padding is reduced for every tab; wide screens are unchanged
- [ ] A component test covers the overlay staying off a different tab while a Summary generates
