# PTR-01: Shared filter components, Channels moved onto them

**What to build:** The Channels tab's filter machinery becomes something the Posts tab can use
without copying it: one tree module (nodes, AND/OR, NOT, parentheses, every editing operation,
funnels, evaluation through a test the tab supplies) and three components (the facet dropdown, the
filter row, the condition picker), each told what a tab's Conditions are through a vocabulary. The
Channels tab moves onto them and behaves exactly as before. Nothing changes for an Account; this
is the prefactor that makes PTR-03 easy. See `.scratch/posts-tab-redesign/spec.md`, "The shared
filter components".

**Blocked by:** None (can start immediately)

**Status:** done

The prototype branch `claude/mattpocock-skills-post-card-4f5186` already made this move and its
shape is the one to rebuild; rewrite it with tests rather than copying. The vocabulary, from the
prototype:

```ts
type PickerVocabulary<C> = {
  sections: { heading?: string; entries: PickerEntry<C>[] }[]
  entryOf: (cond: C) => string
}
type PickerEntry<C> =
  | { kind: "list"; id: string; label: string; icon: Icon;
      options: { id: string; label: string; hint?: string }[];
      make: (value: string) => C; current: (cond: C) => string | undefined }
  | { kind: "editor"; id: string; label: string; icon: Icon;
      render: (p: { start?: C; onSubmit: (c: C) => void; onBack: () => void }) => ReactNode }
type FilterVocabulary<C> = PickerVocabulary<C> & {
  label: (cond: C) => string
  icon: (cond: C) => Icon
  chipId: (cond: C) => string
}
```

### The tree module

- [x] Generic over the Condition type: a Condition names its kind, and a funnelled one also holds
      a value. Evaluation takes the test as an argument; an empty group passes, negated or not
- [x] Every operation the Channel filter has today moves unchanged: append, remove with pruning
      (no "()" or "(a)" left behind, NOT kept when unwrapping), replace, set the joiner, toggle
      NOT (the root too), move (never a group into itself), wrap, group-by-drop, unwrap, funnel
      add, remove and clear
- [x] The Channel filter keeps its own Conditions, its evaluation of them, its labels and its URL
      text form, and builds on the shared module; its public names stay importable from where
      they are today, so nothing else in the codebase changes

### The components

- [x] The facet dropdown takes rows that carry their own selected count, total, tick state
      (all, some, none) and a busy flag, plus a tick hint line, so each tab computes them its own
      way. The Channels wrapper computes them exactly as today
- [x] The filter row and the condition picker take a vocabulary and a test-id prefix; the
      Channels row and picker are thin wrappers that pass the Channels vocabulary
- [x] The filter row can show its count as approximate with a tooltip saying why (unused by
      Channels; Posts may need it while a count is partial)

### Tests

- [x] Every existing Channels test passes unchanged: the Channel filter, the filter row, the
      facet menu, the metric editor, the bar and the grid. A change to any of them is a sign the
      move changed behaviour
- [x] The shared tree module has its own tests over a toy Condition type, covering evaluation,
      pruning, NOT through unwrap, the move guard and funnels, so it is not tested only through
      Channels
- [x] A component test for the shared filter row and the shared picker over a toy vocabulary
      (the frontend CRAP ratchet fails a new branching component without one)
