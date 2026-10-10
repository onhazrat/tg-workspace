# SUMTAB-04: Citation hover with the Cited Post

**What to build:** Hovering a Citation in a Summary shows the Cited Post as a full post card, photo
included, in a hover card capped to the space available that scrolls inside when the Post is long.
On a phone, or any device without hover, tapping the Citation opens the same card in a bottom sheet.
The card shows the Post as it is now (current views and edits), falling back to the snapshot the
Summary stored when the Post is deleted or aged out. When the Summary has Covered Posts on record and
the Cited Post is not among them, the card says it is outside this Summary's Scope. This ticket also
introduces the shared way to find a Citation in the report: scroll it into view (instantly on narrow
screens) and briefly highlight it, working even straight after a dialog closes. The Chat tab's
citations are unchanged. See `.scratch/summary-tab/spec.md`, user stories 18-25, and "Citations and
the hover" under Implementation Decisions.

**Blocked by:** SUMTAB-03 (both change how the report renders; sequenced to avoid conflicts).

**Status:** ready-for-agent

- [ ] Cited Posts resolve live through the existing batch Post lookup, with the stored snapshot as the fallback; a Post in neither shows a clear "not found" state
- [ ] On hover-capable wide screens the card opens on hover, its height capped to the available space, scrolling inside, with the Post's text expanded rather than clipped behind "Show more"
- [ ] With no hover or a narrow screen, a tap opens the card in a bottom sheet that scrolls a long Post
- [ ] The out-of-Scope notice appears only when Covered Posts are on record and the Cited Post is not one of them
- [ ] Finding a Citation scrolls it into view and highlights it briefly; when called as a dialog closes, it waits for the dialog to be gone so the scroll lock does not swallow it
- [ ] The Chat tab's citation hovers behave exactly as before
- [ ] A rendered Summary test covers the hover card (live and snapshot), the phone sheet, and the out-of-Scope notice
