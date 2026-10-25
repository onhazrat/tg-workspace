# SPR-02: One Number bound editor

**What to build:** The Channel filter, the Directory filter, the Post filter and
the Requests tab's channel table edit a Number bound with one editor, so an
Account reads and does the same thing in all four.

- At least, at most and between everywhere, and No value wherever a number
  can be absent; a number that cannot be negative refuses a negative field; a
  bound on a whole number is rounded inward and refused when no whole number
  is left.
- One back label, "Back to the conditions"; the number's name, unit and
  description at the top; one note on what No value means, with how many have
  no value where that is known.
- Add says "Add · 12 of 40" where the count is made in the browser, "Add · 8
  with no value" for No value, the server's count in the Directory, and
  nothing for the Post filter; Update replaces Add for an existing Condition;
  Add is disabled while the fields spell no bound.
- The field starts at the median for local values, and empty for a read,
  cached or not; "Loading the spread" while reading, a plain line when
  nothing has a value.
- A pick on the Spread fills the operator and the fields, a picked edge
  rounded to two significant figures, except "everything with a value", which
  keeps the whole Spread's low end exactly.
- The editor takes its numbers from one of two sources and three switches,
  and absorbs the operator-and-fields part; the four callers become adapters
  (local values for Channel and Requests; the server spread for the
  container's zoom, with its count, for the Directory; the value histogram
  for the editor's zoom, on the scale first drawn, for Post). The four old
  editors are deleted.

The source shape the prototype settled on (trimmed):

```ts
type NumberSource =
  | { kind: "values"; values: number[]; total?: number }
  | { kind: "read"; read: ReadBars | null | undefined; zoom: ZoomState; count?: (bound: MetricBound) => ReactNode }
// switches: min (a floor), whole, noValue
```

**Blocked by:** SPR-01 (the editor draws the one Spread).

**Status:** ready-for-agent

**Context pointers:** spec `../spec.md` (user stories 42 to 57 and 63 to 65,
Implementation Decisions, Testing Decisions), `docs/adr/ADR-037-one-spread.md`,
`docs/one-spread-plan.md` (decisions 1, 3 to 8), and the prototype at
`prototype/one-spread-snapshot` @ 951326bb: the editor is `NumberBoundEditor`,
and each caller's adapter sits beside its old editor. Port the decisions,
renamed, ungated and test-first; nothing else is ported.

- [ ] One Number bound editor serves Channel, Directory, Post and Requests; the four old editors are gone.
- [ ] Floor, whole and No value switches behave as above on each caller.
- [ ] One back label, one no-value note and one Add wording, with the right count on each caller.
- [ ] The median prefills from local values only; a read source starts empty.
- [ ] A pick fills the operator and fields with the rounding above.
- [ ] Render tests pin the editor through its interface, per source and switch; the Channel and Directory editors' tests fold in.
- [ ] The Playwright specs that name the old editor test ids use the new ones, and the frontend unit suite, typecheck and lint pass.
