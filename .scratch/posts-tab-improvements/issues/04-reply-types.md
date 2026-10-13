# PTI-04: Is a reply and Has a reply

**What to build:** Two new Types in the Type dropdown, the filter text form and the Type counts.
**Is a reply** keeps a Post that answers any Post, in any Channel, stored or not. **Has a reply**
keeps a Post that a Post **of its own Channel** answers, which includes a forward the forwarding
Channel answered there; an answer from another Channel leaves its parent without one. They combine
like every Type: OR inside the dropdown, AND across dropdowns. See
`.scratch/posts-tab-improvements/spec.md`, user stories 61-70, and "The Post filter's vocabulary"
and "Evaluating the new Conditions" under Implementation Decisions; the **Reply** term in
`CONTEXT.md`.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] Type values `is_reply` and `has_reply`, after the existing three, labelled "Is a reply" and "Has a reply", in both vocabularies (the conformance check passes); text forms `type:is_reply`, `type:has_reply`
- [x] Is a reply: the Post names a parent post id
- [x] Has a reply: some stored Post names this Post as its parent **and** names this Post's Channel as the parent's Channel, case-insensitively. An id-only match is wrong, because a reply stores its parent's id even across Channels
- [x] Evaluated as a semi-join against the replies made since the window opened (a reply comes after its parent), computed once per read; not a correlated per-row `EXISTS` and not an unbounded reply set (both measured far too slow for the Type counts)
- [x] The Type counts gain both Types as filtered aggregates in their existing single scan and are not measurably slower: measured on staging 2026-10-13, one week of the account with 348 Follows (38,502 Posts), median 5.12 s with three Types and 4.95 s with five, over three alternating runs each
- [x] The dropdown shows both rows with their counts and ticks like the others

### Tests

- [x] Backend, through the HTTP API: Is a reply for a same-Channel, a cross-Channel and a private-parent reply; Has a reply for a same-Channel answer, a forward answered by the forwarding Channel, an answer from another Channel marking nothing, and a Post whose id happens to equal a cross-Channel reply's parent id in the answering Channel marked by nothing; the Type counts for both
- [x] Frontend, through the filter bar's test: both rows appear with counts and produce `type:…` text
- [x] Each new test watched failing against a mutation first (the id-only match must turn the cross-Channel case red)
