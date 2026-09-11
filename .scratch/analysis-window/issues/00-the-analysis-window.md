# AW-00: The Analysis window (overview)

**What to build:** Implement the accepted Analysis-window design in ADR-018 and
the feature spec: one global four-field editor with explicit Live and Fixed
modes, authoritative server-time resolution, half-open Post selection, and one
complete immutable Scope snapshot shared by every Artifact kind.

**Blocked by:** Not applicable — this is the effort overview, not a workable ticket.

**Status:** superseded

## Superseded by the slices

This file is the effort-level summary. The workable tickets are `AW-01` through
`AW-09` in this directory; each cuts a complete path through schema, API and UI
and is sized for one agent session. The acceptance criteria below are the union
of theirs and are kept here as the completion checklist for the whole effort.

## The slices

Work the frontier: any ticket whose blockers are all done.

| Ticket | Blocked by |
|---|---|
| AW-01 One half-open window, everywhere | None |
| AW-02 The server owns now | AW-01 |
| AW-03 The Analysis-window controller | AW-02 |
| AW-04 The Posts editor, and a window that moves | AW-03 |
| AW-05 Frozen Scope, the contract and the Summary | AW-03 |
| AW-06 Frozen Scope, the other three families | AW-05 |
| AW-07 Drop the incomplete legacy Artifacts | AW-06 |
| AW-08 Artifact display, and Use this Scope | AW-06 |
| AW-09 Actions is where an Artifact begins | AW-04, AW-08 |

AW-01 lands and is observed on its own before the rest starts: it changes which
Posts every existing surface returns, and a boundary regression must not be able
to hide inside the larger feature. AW-04 and AW-05 can run in parallel once the
controller exists, as can AW-07 and AW-08 once all four families freeze Scope.

## The rule this ticket makes true

There is one Analysis window everywhere Scope is used. Live means a fixed
Duration plus End gap resolved from the server's current minute; Fixed means two
exact UTC instants. Every Post selector applies the same half-open interval, and
every Artifact freezes the complete resolved Scope at submission time.

## Acceptance criteria

- [ ] Scope owns one Analysis-window controller rather than independent Start and End state.
- [ ] The Account explicitly chooses Live or Fixed; mode is never inferred.
- [ ] The editor always exposes Start, End, Duration and End gap, with the propagation rules in the spec.
- [ ] Valid changes apply immediately; incomplete or invalid drafts leave the last valid Scope unchanged and show an associated inline error.
- [ ] Typed edits debounce for 400 ms and commit immediately on Enter or blur; presets and mode changes commit immediately.
- [ ] Live stores Duration and End gap, advances both boundaries from the synchronized current minute, and supports a positive End gap.
- [ ] Fixed stores exact Start and End, keeps them stationary, and lets End gap grow with the current minute.
- [ ] Switching modes preserves all four displayed values at the switching instant.
- [ ] Fixed boundaries use local minute-precision controls but persist exact UTC instants with seconds and milliseconds set to zero.
- [ ] Duration is at least one minute; End gap may be zero; future Fixed End and crossed boundaries are rejected rather than repaired.
- [ ] Duration and End gap share `1m`, `30m`, `1h`, `3h`, `8h`, `24h`, `7d`, and `30d` shortcuts; zero is not a shortcut.
- [ ] Choosing a Duration preset preserves End gap.
- [ ] Relative fields accept only the composable whole-minute grammar specified in the feature spec.
- [ ] A new Account defaults to a 24-hour Live window with zero End gap.
- [ ] Account-scoped persistence keeps Live intent rather than resolved timestamps, and legacy saved boundaries migrate as Fixed.
- [ ] Open tabs retain independent in-memory Scope and do not consume one another's storage events.
- [ ] Posts uses a persistent summary trigger, a desktop popover and a mobile bottom sheet; the editor remains open after a commit and has the specified keyboard/focus behavior.
- [ ] Ordinary UI uses local time without timezone or UTC labels; Duration is always visible.
- [ ] One backend resolver validates Fixed input and resolves Live input from the start of the server's current minute.
- [ ] The frontend synchronizes its preview clock to the server; browser clock skew cannot change an Action's selected Posts.
- [ ] Feed, counts, Semantic retrieval, prompt assembly and Discovery all use the shared half-open predicate `Start <= timestamp < End`.
- [ ] Semantic search always respects the current Analysis window, and its ignore-window option is removed.
- [ ] A visible Live Posts view invalidates on synchronized minute boundaries, focus regain and Sync completion without duplicating timers on other surfaces.
- [ ] The Actions tab shows the current Analysis-window summary and can open the Posts editor without losing the unfinished Action draft or its return path.
- [ ] Every UI-created Summary, Chat, Tag run and Discovery report originates in Actions.
- [ ] Action submission sends complete Scope; the server resolves and persists it before queue delay or expensive work begins.
- [ ] All four Artifact families store and return one validated frozen-Scope shape containing Channels, exact Start/End and every active post filter or explicit Post selection.
- [ ] Artifact updates cannot replace the frozen Scope.
- [ ] Every Artifact view shows exact local Start, exact local End and derived Duration, and does not show relative boundaries, former mode or End gap.
- [ ] Opening an Artifact does not alter workspace Scope or filters.
- [ ] Use this Scope explicitly restores the complete snapshot as Fixed and calculates its current End gap.
- [ ] The migration removes legacy Artifacts that cannot provide the complete frozen Scope instead of inventing missing filters.
- [ ] Generated API types are refreshed after the shared Scope and Artifact contracts change.
- [ ] Controller tests, backend contract tests and one Playwright workflow cover the three approved seams in the feature spec.
- [ ] Boundary tests are mutation-checked by temporarily restoring an inclusive End and observing the suite fail.

## Notes

The feature spec is authoritative for interaction details, examples, persistence,
API semantics, migration behavior and the agreed testing seams. ADR-018 is the
architectural decision record and wins if later ticket edits weaken the domain
rules.

There is no time slider in this ticket. A future Fixed-only histogram brush must
earn its complexity with server-side buckets and remains a separate decision.
