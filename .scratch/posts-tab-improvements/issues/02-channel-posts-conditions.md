# PTI-02: Channel posts in window and Channel posts in filtered window

**What to build:** Two new Post filter Conditions bound how busy a Post's Channel is. **Channel
posts in window** keeps a Post when its Channel's count of every Post in the Analysis window lies in
the bound ("at most 5" surfaces quiet Channels). **Channel posts in filtered window** counts only the
Posts the rest of the Post filter keeps: the whole tree with every Channel posts Condition set
aside, the keyword included, before the per-Channel cap (under "Type: Original", a Channel with 200
Posts of which 20 are original counts 20). Both appear in the Filters menu after Views and
Estimated views, each opening on the shared histogram, and both are whole numbers. See
`.scratch/posts-tab-improvements/spec.md`, user stories 42 and 44-60, and "The Post filter's
vocabulary" and "Evaluating the new Conditions" under Implementation Decisions; terms in
`CONTEXT.md`.

**Blocked by:** PTI-01 (the value histogram read and the editor histogram).

**Status:** ready-for-agent

### Vocabulary

- [ ] Conditions `channel_posts` and `channel_posts_filtered`, each an optional `min`/`max` bound with no "no value" form, in the server's and the browser's vocabularies alike (the conformance check passes)
- [ ] Text forms `channel_posts <= 5`, `channel_posts >= 50`, `channel_posts 10..30` and the same for `channel_posts_filtered`; chips "Channel posts in window ≤ 5" and "Channel posts in filtered window ≤ 5"
- [ ] Whole bounds: the browser rounds inward before sending and refuses a bound with no whole number left; the server accepts a fraction and rounds the same way, so a stored one keeps working. The rule (from the prototype):
  ```ts
  const min = bound.min === undefined ? undefined : Math.ceil(bound.min)
  const max = bound.max === undefined ? undefined : Math.floor(bound.max)
  if (min !== undefined && max !== undefined && min > max) return null
  ```

### Evaluation

- [ ] Both count within the Analysis window the read resolves: feed, counts, Type/Media/Language counts, and inside a Selection rule the window it is applied in, over the rule's own tree and keyword
- [ ] Each is one grouped count per Channel, computed once per read and joined as a set of Channels, never a per-row count
- [ ] The filtered count prunes every Channel posts Condition from the tree (same answer under AND, OR and NOT), applies the keyword, ignores the cap

### Filters menu and histograms

- [ ] The menu lists Views, Estimated views, Channel posts in window, Channel posts in filtered window, in that order, each with its current bounds; the pill counts all four kinds; the condition picker offers the same
- [ ] The Filters menu and the condition picker read their number entries from **one list**. Today the menu hard-codes Views and Estimated views beside the vocabulary's own list, and the prototype's Channel posts entry reached the picker but not the menu. A test fails when an entry is in one and not the other
- [ ] The value histogram read gains `channel_posts` (Channels by unfiltered count) and `channel_posts_filtered` (Channels by filtered count, applying the request's filter and keyword); both count Channels and the caption says "channels"

### Tests

- [ ] Backend, through the HTTP API: both ends and between; a fraction rounded inward; a different window changing the answer; inside a Selection rule; the Original example; the Condition set aside under OR and NOT; keyword counted; cap ignored; both histogram measures
- [ ] Frontend, through the filter bar's test: the four entries in order, a histogram drag producing whole `channel_posts …` text, an empty whole range refused
- [ ] Each new test watched failing against a mutation first
