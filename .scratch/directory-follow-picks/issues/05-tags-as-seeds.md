# DFP-05: A Tag as Seeds, and the code says Seed

**What to build:** A Tag becomes a live source of Seeds for Shared parents, Shared children, Cited
by and Cites, resolved by the server so a Tag of any size works and the link stays short. Cited by
and Cites take up to 500 fixed handles and can fill them from the Ticks, the Channels tab
selection, every Follow or a Tag. The code's `picks` becomes Seeds, matching the glossary. See
`.scratch/directory-follow-picks/spec.md`: user stories 9, 10 and 28 to 31, and the Directory
filter decisions, including the Seed source shape the prototype settled on.

**Blocked by:** DFP-04

**Status:** ready-for-agent

- [ ] The Shared Condition takes either browser-resolved handles (Ticks, selection, Follows, typed) or a Tag name the server resolves; Cited by and Cites do the same
- [ ] A Tag-sourced Condition follows the Tag as Channels are tagged and untagged
- [ ] Cited by and Cites accept up to 500 fixed handles (from 50); the Shared cap stays 10,000; the editor says when a list passes 500 and points to a Tag
- [ ] Cited by and Cites fill their handles from the Ticks, the Channels tab selection, every Follow or a Tag
- [ ] `picks` is renamed to Seeds across the wire, the text form and the frontend types; the text form's source words read `ticked`, `selection`, `follows`, `tag:<name>`; a link written with the old words still parses
- [ ] "Why it's here" names the Shared Channels against the Seeds, whatever their source
- [ ] Backend tests through the Directory reads: a Tag as Shared Seeds and as Cited Seeds, for two Accounts with the same Tag name; 500 handles accepted and 501 refused
- [ ] Text-form tests round-trip the new and old Seed words, mutation-tested
