# AW-08: Artifact display, and Use this Scope

**What to build:** Make opening an Artifact an inspection rather than an edit.
Every Artifact shows its exact frozen boundaries, opening one leaves the
workspace alone, and a deliberate action restores its Scope when that is what
the Account wants.

**Blocked by:** AW-06

**Status:** ready-for-agent

## The rule this ticket makes true

Inspecting history never replaces current work. Restoring an old Scope is always
a choice, and what comes back is Fixed, because immutable timestamps are not a
former Live window.

## What it removes

Opening a saved report currently replaces the selected Channels and the date
range automatically and announces it afterwards. Both the mutation and its notice
go away.

## Acceptance criteria

- [ ] Every Artifact surface shows exact local Start, exact local End and derived Duration.
- [ ] No Artifact view shows End gap, a former workspace mode or relative "ago" text.
- [ ] Opening an Artifact changes only navigation and the Artifact being viewed; selected Channels, the Analysis window and the filters are untouched.
- [ ] The implicit scope-restoration behaviour and its notice are deleted.
- [ ] A Use this Scope action replaces the entire workspace Scope with the Artifact snapshot.
- [ ] Restoration sets the Analysis window to Fixed at the Artifact's exact boundaries, derives Duration, and calculates End gap against the synchronized current minute.
- [ ] The Artifact itself is unchanged by restoring it.
