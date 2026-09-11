# AW-03: The Analysis-window controller

**What to build:** Replace the two independently managed timestamps in the
workspace with one Analysis-window controller. The Account explicitly chooses
Live or Fixed, four linked fields stay truthful, every valid change applies
immediately and an invalid one leaves the last valid Scope alone.

**Blocked by:** AW-02

**Status:** ready-for-agent

## The rule this ticket makes true

Mode is chosen, never inferred. Canonical Live state is mode plus Duration and
End gap, with Start and End derived from the synchronized current minute;
canonical Fixed state is mode plus two exact instants, with Duration and End gap
derived. There are never four independent stored facts to drift apart.

## What it replaces

The current pair silently moves the other boundary when one crosses it and
silently clamps a future end. Both repairs go away: the same input is now an
inline error that changes nothing.

## Acceptance criteria

- [ ] Scope owns one controller; Start and End are no longer independent state anywhere.
- [ ] Editing Start holds End and recalculates Duration; editing End holds Start and recalculates Duration and End gap; editing Duration holds End and End gap and recalculates Start; editing End gap holds Duration and recalculates Start and End.
- [ ] Those rules apply in both modes, and normal clock behaviour for the mode resumes after the edit commits.
- [ ] Switching modes commits immediately and changes none of the four displayed values at the switching instant.
- [ ] Each field has a draft separate from committed Scope; a typed valid value commits after 400 ms without input, or immediately on Enter or blur.
- [ ] An incomplete or invalid draft shows an associated inline error and leaves the committed Scope untouched; closing the editor discards it.
- [ ] Relative fields accept only composable whole-minute tokens in descending order such as `1d 6h` or `2h 30m`; unknown units, fractions, negatives, ambiguous duplicates and trailing text are invalid, and whitespace is forgiving.
- [ ] Fixed edits normalize to zero seconds and milliseconds and store UTC; the ordinary interface shows local time with no timezone, offset or UTC label.
- [ ] A new Account defaults to a 24-hour Live window with a zero End gap.
- [ ] Persistence is Account-scoped and browser-local: Live persists mode, Duration and End gap and never resolved timestamps; Fixed persists mode and both instants; drafts and errors persist not at all.
- [ ] Existing saved Start and End values migrate once to Fixed, with Duration derived and End gap calculated on load; nothing infers Live from an end that happens to be near now. Missing or malformed values fall back to the default.
- [ ] Open tabs keep independent in-memory Scope and do not consume one another's storage events; each valid commit still writes the last-used value.
- [ ] The controller takes an injected clock, synchronized to the server's minute, so temporal behaviour is testable without wall time.
- [ ] A pure formatter renders the compact summary in both modes, for example `Live · 1d 10h ago → 30m ago (1d 9h 30m)` and `Fixed · Sep 10 09:30 → Sep 11 14:30 (1d 5h)`.
- [ ] Controller tests use a fake clock and assert committed Scope and visible field values, never reducer action names or internal update counts.

## Notes

With a 30-minute End gap, choosing the 24-hour Duration preset must produce
`1d 30m ago → 30m ago (1d)` — the gap survives a Duration change.

Prefactor: Scope currently sits in the general UI context beside unrelated flags.
Move it to its own module as part of this ticket rather than growing that context.
