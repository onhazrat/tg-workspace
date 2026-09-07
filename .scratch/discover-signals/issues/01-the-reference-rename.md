# 01: The Reference Rename

**What to build:** The Post in a followed Channel that surfaced a Candidate is called a
**Reference**, everywhere, so that "sample" means exactly one thing on a screen that is about to
show both it and the Directory's snapshot of a Channel's own Posts.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The report Candidate response names the field for a Reference, not a sample Post
- [ ] **A report saved before this change still opens.** Candidates are persisted as JSON at
      generate time and the field is required with no default, so a renamed model would fail
      validation on every existing report
- [ ] The stored key is normalised to the new name at the read seam that already overlays live
      state onto stored candidates, so an old report and a new one read identically
- [ ] An old export imported *after* this change reads correctly too, which is why the fix is a
      tolerant read and not a one-time migration over the stored JSON
- [ ] A regression test opens a report fixture holding the pre-rename key and asserts the
      response carries the Reference
- [ ] The hand-written client type, the component props and the query key follow the wire
- [ ] The panel's UI copy calls it a Reference; no user-facing string says "sample post"
- [ ] The projection test's expected key set is updated
- [ ] `CONTEXT.md` gains **Reference** with `_Avoid_: sample post`, and **Directory entry** keeps
      its existing wording in this change
- [ ] The generated client is regenerated and committed, because the wire changed
- [ ] The route inventory guard stays green; no route function was renamed, only a field

## The rename is not only a rename

A Discovery report is a saved Artifact. Its Candidates are persisted as JSON at generate time and
the read path spreads those stored dicts, overlaying only follow state, dismissal state and the
probe verdict on top. The response field is **required with no default**, so renaming the model
field without touching stored data makes every report saved before this change fail validation on
read. That is a data-shaped problem hiding inside a mechanical rename, and it is the reason this
ticket exists separately rather than being a find-and-replace.

The fix is a tolerant read at the seam that already normalises stored candidates, not a migration
over the JSON. A migration fixes the rows in this database and does nothing for an old export
imported next month; the tolerant read covers both and is smaller.

## Why it is first

A rename is safe when the exact-key-set projection tests are the only thing standing between a
missed call site and a runtime failure, and they only give that guarantee when the key set is
otherwise unchanged. Bundle this with the change that adds statistics and both edits land in the
same expected-keys literal, where a missed rename and a deliberate addition look identical in
review.

The collision is real and already in the code: `CONTEXT.md` defines a Directory entry as carrying
"a sample of its recent Posts", meaning the Channel's own Posts, while the candidate panel calls
the Post that *referenced* the Candidate a `samplePost`. The arrow points the opposite way. Ticket
03 puts both on the same sheet.

## Notes

The word appears in the response schema, the hand-written client type, the panel component and
its query key, and the report view helper. Grep for the term rather than working from that list;
the list is a starting point and not an inventory.
