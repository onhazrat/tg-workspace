# SUMTAB-06: Coverage wall and Channel posts sheet

**What to build:** Below the prose, a Channel coverage section shows every Channel in the Summary's
Scope (and any cited Channel outside it, flagged) as an avatar with one small split badge growing
outward from the photo's bottom-right corner: Cited Posts on a blue half, Covered Posts on a grey
half. Channels are ordered by Cited Posts, then Covered Posts. A header line gives the totals ("18 of
51 channels cited · 679 posts used") and a legend explains the badge with an example sentence.
Tapping an avatar highlights that Channel's Citations and strip photos in the report (when it has
any) and opens a sheet (side on wide screens, bottom on phones) listing every Post the Channel gave
the Summary as full post cards: "Cited in the summary" first, each outlined in blue with a Find
button, then "Also covered", loading 20 at a time. See `.scratch/summary-tab/spec.md`, user stories
26-44, and "Coverage" under Implementation Decisions.

**Blocked by:** SUMTAB-04 (Cited Post resolution, finding a Citation, and the highlight).

**Status:** ready-for-agent

### Wall

- [ ] Coverage is derived in the browser from the Citations, the resolved Cited Posts, and the frozen Scope's Post references on the Summary detail; no backend change
- [ ] Order, from the prototype: `rows.sort((a, b) => b.citedPosts - a.citedPosts || b.coveredPosts - a.coveredPosts)`, where citedPosts counts distinct Cited Posts (not Citations)
- [ ] The badge is one pill, blue then grey, each half omitted when it has nothing to say; it starts a few pixels inside the photo's bottom-right corner and grows outward without covering the next avatar
- [ ] Never-cited Channels are greyed out but keep their Covered Posts count; a cited Channel outside the Scope is shown and flagged
- [ ] A Summary with no Covered Posts on record shows Citations only and says the input was not recorded
- [ ] Every avatar has a spoken label with its name, Covered Posts and Cited Posts

### Channel posts sheet

- [ ] Tapping an avatar highlights its Citations (only if it has any) and opens the sheet; tapping it again closes both; never-cited Channels open too
- [ ] The sheet shows "Cited in the summary (n)" first, then "Also covered (n)" newest first, 20 at a time as the reader scrolls, through the batch Post lookup
- [ ] Cited Posts carry a blue outline and a "Cited in the report · Find" strip; Find closes the sheet and finds the Citation
- [ ] Side sheet on wide screens, bottom sheet on phones

### Tests

- [ ] A rendered Summary test covers the order, badges, out-of-Scope and not-recorded states, and the sheet's grouping and Find
