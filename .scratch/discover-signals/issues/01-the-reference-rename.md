# 01: The Reference Rename

**What to build:** The Post in a followed Channel that surfaced a Candidate is called a
**Reference**, everywhere, so that "sample" means exactly one thing on a screen that is about to
show both it and the Directory's snapshot of a Channel's own Posts.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] The report Candidate response names the field for a Reference, not a sample Post
- [ ] The hand-written client type, the component props and the query key follow the wire
- [ ] The panel's UI copy calls it a Reference; no user-facing string says "sample post"
- [ ] The projection test's expected key set is updated, and it is the only test that needed to
      change, which is the evidence the rename was complete
- [ ] `CONTEXT.md` gains **Reference** with `_Avoid_: sample post`, and **Directory entry** keeps
      its existing wording in this change
- [ ] The generated client is regenerated and committed, because the wire changed
- [ ] The route inventory guard stays green; no route function was renamed, only a field

## Why this is first and alone

A rename is safe exactly when the exact-key-set projection tests are the only thing standing
between a missed call site and a runtime failure, and they only give that guarantee when the key
set is otherwise unchanged. Bundle this with the change that adds nine statistics and both edits
land in the same expected-keys literal, where a missed rename and a deliberate addition look
identical in review.

The collision is real and already in the code: `CONTEXT.md` defines a Directory entry as carrying
"a sample of its recent Posts", meaning the Channel's own Posts, while the candidate panel calls
the Post that *referenced* the Candidate a `samplePost`. The arrow points the opposite way. Ticket
03 puts both on the same sheet.

## Notes

The word appears in the response schema, the hand-written client type, the panel component and
its query key, and the report view helper. Grep for the term rather than working from that list;
the list is a starting point and not an inventory.
