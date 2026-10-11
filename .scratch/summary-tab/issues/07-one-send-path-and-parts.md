# SUMTAB-07: One send path, cut between paragraphs, formatting fixed

**What to build:** Every publish to Telegram, whether a person's, the scheduler's or the free-text
quick message, is cut into Parts between paragraphs instead of every 4,000 characters, and arrives
with its formatting intact: bullets as bullets with their bold labels, metadata labels bold, and
@handles keeping their underscores. Start with a prefactor commit: the free-text publish route stops
carrying its own copy of the send loop and calls the shared publish service, with Telegram output
unchanged. Then add the Part builder in that one path. No UI changes in this ticket. See
`.scratch/summary-tab/spec.md`, user stories 49-56, 73 and 76, and "Publications (backend)" under
Implementation Decisions.

**Blocked by:** None (can start immediately).

**Status:** done

### Prefactor

- [ ] The free-text publish route sends through the shared publish service; existing publish tests pass unchanged

### Part builder

- [ ] A pure-transform Part builder is the only place cutting and formatting happen, and the shared send path uses it for manual, scheduled and quick-message publishes
- [ ] Rewrites before cutting: a line-start `* ` or `- ` becomes `• `; a single-asterisk label after a leading emoji or word becomes bold; an @handle containing `_` becomes a link to the Channel with the handle as its text
- [ ] Cutting, from the prototype: paragraphs on blank lines; a heading-only paragraph glued to the next; anything too long split at lines, then sentence ends, then whitespace, then hard; pieces packed greedily, keeping their separators
- [ ] The limit is Telegram's, measured on the text after entity parsing in UTF-16 units
- [ ] The metadata, when sent, is its own Part(s)
- [ ] A Part whose cut had to fall inside a word or a formatting pair is flagged

### Tests

- [ ] Route-level tests with the Telegram call faked cover the cuts (heading never ending a Part, the line, sentence and word fallbacks), the three rewrites, and the limit after parsing
- [ ] The scheduler's existing seam asserts it sends the builder's Parts
