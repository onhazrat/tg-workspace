# PTR-03: Post filter end to end

**What to build:** An Account can filter the Posts tab the way they filter Channels: Type, Media
and Language dropdowns whose funnels add Conditions, a Filters menu for bounds on Views and
Estimated views, and a filter row where Conditions join with AND or OR, any block is negated, and
blocks nest in parentheses. The server evaluates it, so the feed, its counts and its facets are
exact over the whole window. The filter lives in the URL. It decides only what the tab shows:
the flat filters leave the Scope, as ADR-026 decides, and until PTR-05 lands a Summary covers
every Post in the window. See `.scratch/posts-tab-redesign/spec.md`, "The Post filter", user
stories 33 to 46 and 49 to 50, and `docs/migration/ADR-026-post-filters-leave-the-scope.md`.

**Blocked by:** PTR-01

**Status:** ready-for-agent

The prototype branch carries a backend tree (request schema, SQL clause, wiring) with no tests;
start from it. The Condition shape, from the prototype with Channel added:

```ts
type PostCond =
  | { type: "type"; value: "forwarded" | "original" | "unfollowed_forwarded" }
  | { type: "media"; value: MediaKind }
  | { type: "language"; value: string }
  | { type: "channel"; value: string }
  | { type: "views"; measure: "views" | "estimated";
      min?: number; max?: number; none?: boolean }
```

### The server

- [ ] The posts reads (feed, counts, facets, lookup) take the Post filter: the tree, the keyword
      and the per-Channel cap. The tree request is bounded (depth 6, 100 nodes) and answers 422
      past it or for an unknown Condition
- [ ] Every atom is two-valued: a Post with no Language or no View count fails a Condition on it
      and passes its negation. An empty group keeps every Post, negated or not
- [ ] A Channel Condition names a Channel; one the Account does not follow matches nothing. A
      views bound reads the measure it names, and the curve is read only when a bound needs it
- [ ] The flat `forwarded`, `media`, `languages` and `views` fields are removed from the reads and
      from the Scope submission; a Discovery report's Scope input changes the same way. Artifacts
      made before keep their frozen flat fields, read-only, and still show them
- [ ] Facet rows report, per value, how many Posts in the window have it, filters aside (PTR-06
      adds how many are selected)
- [ ] The regenerated client is committed; the route inventory, projection and account-isolation
      guards are updated for the changed bodies, and every changed route is probed

### The filter bar

- [ ] Type, Media and Language are the shared facet dropdown with a search and a funnel per row.
      Two funnels in one dropdown join with OR; different dropdowns join with AND. No tick column
      yet (PTR-06)
- [ ] A Filters menu, the shared condition picker limited to Views and Estimated views, opens an
      editor: at least, at most, between and no value, one or two fields, Add or Update. No
      histogram (out of scope)
- [ ] The filter row is the shared row over Post Conditions: NOT on any block, the joiner switch,
      parentheses, drag a chip onto another to group, a "+" in the row and in every pair of
      parentheses, a chip's label reopening its picker, the keyword as a chip, and "Clear all".
      It says how many Posts in the window the filter shows, exactly, from the server
- [ ] The tree is in the URL as `?postFilter=`, with the Channel filter's printer and parser shape;
      a malformed string is ignored. A reload keeps the filter and a link shares it
- [ ] The settings keys for the retired flat filters are removed from the settings schema and the
      settings registry, and the palette commands that set a Type, media kind or Language add the
      same Condition to the Post filter instead
- [ ] The filter bar's footer chips, which the filter row replaces, are removed

### Tests

- [ ] Route tests (pytest, real Postgres): AND, OR, NOT, nesting, empty groups; NOT on a Post with
      no Language and with no View count; a bound on each measure and "no value"; a Channel
      Condition on a followed and an unfollowed Channel; the size bounds; facets and counts under
      a tree; an old Artifact still showing its flat fields. Mutation-test the two-valued NOT
- [ ] Pure tests for the Posts vocabulary's labels and the URL form: print then parse gives the
      same tree, including a NOT inside parentheses, and a malformed string is ignored
- [ ] Component tests for the Posts facet dropdown's funnels and the filter row over Post
      Conditions
- [ ] Existing Playwright specs that drive the old Type, Media, Language and Views pills are
      updated to the new controls in this change
