# PTR-05: Post selection: Picks, rules, and Actions that cover it

**What to build:** An Account decides what an operation covers, separately from what they read.
Every Post in the window is selected by default, so doing nothing behaves as before. Unticking one
card records a **Pick** that deselects that exact Post wherever it appears; "Deselect all" over
what the filter shows records a **Selection rule** that also reaches the matching Posts of the
next window. The steps show as removable chips, the last one to reach a Post decides it, and
Summarize, Chat, Tag run and Discovery cover exactly the selection. Every Artifact freezes the
steps and a reference to every Post they reached. See `.scratch/posts-tab-redesign/spec.md`, "The
Post selection" and "Storage", user stories 51 to 55, 58 to 64, 67 to 68 and 70 to 80, and
`docs/migration/ADR-026-post-filters-leave-the-scope.md`.

**Blocked by:** PTR-02, PTR-03

**Status:** done

The prototype's selection is an explicit set, empty by default, evaluated in the browser; none of
that model carries over. The wire shape is new:

```ts
type SelectionStep =
  | { kind: "rule"; select: boolean; filter: PostFilterSnapshot }
  | { kind: "pick"; select: boolean; channelName: string; postId: number }
// The default, and the result of a select-all over an empty filter.
const DEFAULT: SelectionStep[] = [{ kind: "rule", select: true, filter: EMPTY }]
```

`PostFilterSnapshot` is the Post filter's tree, keyword and cap (with its mode, its seed, and the
order an ordered cap follows), as it was when the rule was made.

### The server

- [x] The posts reads take the Post selection beside the Post filter and return every Post with a
      `selected` flag; the meaning search's lookup does too. Counts report the selected count
      beside the shown count. As built, the lookup also takes the Channels and the window, which
      a rule needs to reach anything; `selected` on the counts is per Channel, filters aside, and
      the flagged rows are their own response model (`SelectablePostResponse`) so the RAG reads
      that return `PostResponse` never carry a `selected` nobody computed
- [x] Evaluation: a Post is selected if the last step that reaches it selects it, unselected if no
      step does. A rule reaches the Posts its snapshot matches in the current window and Channels;
      a Pick reaches its one Post. A rule under a random cap uses its stored seed, so one window
      gives the same Posts every time. As built, `services/post_selection.py` turns the steps
      into one predicate, a `CASE` from the last step to the first; Picks go in as `VALUES`
      lists, an earlier Pick of the same Post dropped, and a capped rule ranks inside its own
      filter over the window with the feed's cap order
- [x] Bounds: at most 5,000 Picks (422 past it), and the number of rules and each rule's tree
      bounded like the Post filter. As built, 50 rules, each tree depth 6 and 100 nodes
- [x] Tenancy: evaluation runs inside the follow-scoped seam, and a Pick or rule naming a Channel
      the Account does not follow reaches nothing and is not an error
- [x] The Scope submission of every Action carries the Post selection instead of the explicit
      `posts` list; a legacy submission naming posts is read as deselect-all followed by those
      Picks, for one release. The order and grouping stay in the Scope, and each Action resolves
      the selection on the server. As built, the keyword and the cap left the Scope too (they are
      a rule's); a legacy submission naming them is read as the one select rule that covers what
      the old Scope covered, the same mapping for `ScopeSubmission`, the prompt scope and a
      Discovery request (whose `postIds` are the legacy ranked Posts). A regeneration derives its
      Scope and records no selection: it covers every Post of its window, as before
- [x] An Artifact stores its steps with its Scope and the `(channelName, postId)` reference of
      every Post they reached in the companion payload table, as `scope_posts` is today, with no
      5,000 bound and no Post text. Inspecting it returns exactly those Posts even after the corpus
      changed. As built, `post_selection.freeze_selection` is the one door the four families
      submit through; `analysis_window.freeze_scope` stays the pure window freeze. The references
      are in the feed's order. "Use this Scope" restores the frozen steps; an Artifact from before
      restores as the rule its keyword and cap meant
- [x] The Channels tab's "Posts in scope" reads the selected count, and so do the palette's trim
      and every Action's size check

### The tab

- [x] Each card has a checkbox, ticked when the Post is selected. A click appends a Pick;
      shift-click appends a Pick for every loaded Post between the last click and this one; x does
      it from the keyboard. Past the Pick cap the UI refuses and suggests a rule. As built, a Pick
      patches the loaded rows in place and any other edit refetches them, because the feed's
      query key never carries the selection (a new key would scroll the Account to the top on
      every click; `architecture-invariants.test.ts` guards it)
- [x] A deselected Post stays in the feed, dimmed
- [x] A selection bar says "N selected of M in window", with Select all and Deselect all over what
      the filter shows, each recorded as a rule. While a meaning search is on, select all records
      one Pick per result instead, and so does deselect all. In a spotlight the rule is the
      spotlight's filter, so it means that Channel
- [x] The steps show in order as chips ("Select all · Deselect Arabic · −3 posts"); removing a chip
      removes its step and nothing else. A select-all or deselect-all over an empty filter replaces
      the list. As built, a run of Picks in one direction is one chip and removing it removes the
      run; a second Pick of one Post replaces the first, which it decides anyway
- [x] The selection lasts the browser session, namespaced per Account through the session storage
      counterpart from PTR-02. A View-as session reads and writes the target's namespace
- [x] Summarize and Chat run on the whole selection, never only what the filter shows; Tag run and
      Discovery too. As built, the prompt input is always a scope: the client-built `posts` path a
      meaning search used is gone

### Tests

- [x] Route tests (pytest, real Postgres): the default selects everything; last step wins between
      a rule and a Pick in both orders; a rule re-applied in another window reaches new Posts while
      a Pick stays on its Post; the random-cap seed; the Pick cap; compaction as sent; isolation
      for a foreign Channel; `selected` and the counts; an Action covering exactly the selection;
      the frozen steps and references surviving a corpus change; a legacy `posts` submission.
      Mutation-test last-step-wins and the tenancy check. As built, `test_post_selection.py`,
      and the four-family cases in `test_frozen_scope_all_families.py`. Reversing the `CASE`
      fails 9 cases; dropping the follow scope from the frozen references fails the freeze case
- [x] The account-isolation guard probes every changed route, and the projection tests cover the
      new `selected` field. As built, the posts and Discover routes were already excused as
      covered elsewhere; their reasons now name the two-account selection tests
- [x] Pure tests for the step list: append, compaction, chip removal, the Pick cap, the request
      body, and session persistence per Account
- [x] Component tests for the card checkbox (click, shift range, x) and the rule chips. The
      shift range is the pure `runPicks`
