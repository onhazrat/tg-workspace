# CARD-03: Token-field tags

**What to build:** Tagging a Channel from its card needs no extra click and offers the Account's
existing tags as it types. See `.scratch/channel-cards/spec.md`: user stories 31 to 42, and the
implementation decisions on the tag field, tag saves and clicking a tag.

**Blocked by:** CARD-01

**Status:** ready-for-agent

The prototype (`prototype/channel-cards`, `?variant=E`) shows the field. Its saves send the whole
tag list from an optimistic copy and can arrive out of order; the spec serialises them instead.

- [ ] On cards and detailed cards, a field is always present after the Channel's tag chips, with no "+ Add Tag" button in front of it
- [ ] Focusing the field lists suggestions in a popover anchored to the field, so a card's clipped edges never hide it; suggestions are computed only while the field has focus
- [ ] Suggestions are the Account's tags this Channel lacks, excluding Setting groups' virtual tags, ranked by how many of the Channels sharing a tag with this one carry the tag, then by how many Channels carry it, then alphabetically; prefix matches come before substring matches
- [ ] Tab takes the highlighted suggestion, or the top one; the arrow keys move the highlight
- [ ] Enter adds the suggestion chosen with the arrow keys, else exactly what was typed, matched case-insensitively to an existing tag's spelling; a new tag that starts like an old one can still be created
- [ ] A trailing comma adds the tag and leaves the field empty for the next one; Backspace in an empty field removes the Channel's last tag; Escape leaves the field without adding anything
- [ ] A tag starting with "group:" is refused with the existing message
- [ ] Two tags added in quick succession are both kept: saves for one Channel are sent one after another, each with the list as it stands, and a test proves the second save carries both tags
- [ ] Clicking a tag's name adds a tag funnel to the Channel filter, the same edit the facet menu makes; removing a tag keeps its hover remove button; AI-assigned tags stay marked
- [ ] The bulk bar's tag fields are unchanged
- [ ] The frontend CRAP ratchet passes, and every new or changed test is mutation-checked
