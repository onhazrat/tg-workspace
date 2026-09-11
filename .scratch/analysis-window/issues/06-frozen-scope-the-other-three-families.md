# AW-06: Frozen Scope, the other three families

**What to build:** Move Chat, Tag run and Discovery report onto the frozen-Scope
value object AW-05 established, so Artifact kind stops changing temporal meaning.

**Blocked by:** AW-05

**Status:** ready-for-agent

## The rule this ticket makes true

All four Artifact families freeze Scope the same way, through one contract. A
filter added or changed later cannot reach only some producers.

## Acceptance criteria

- [ ] Chat, Tag run and Discovery report each persist the same validated frozen-Scope value at creation, through the same submission-time resolution.
- [ ] Each of their read models returns that value and derives Duration from the exact boundaries.
- [ ] A later update to any of the three cannot replace its frozen Scope.
- [ ] The unified History read and each detail read expose one Scope shape across all four kinds.
- [ ] A parameterized test matrix covers all four families: each creation path freezes submission-time boundaries and the complete filter set before a simulated queue delay, each read returns the same immutable Scope, and a later write cannot replace it.
- [ ] Any per-kind scope representation that would now duplicate the shared one is identified for removal in AW-07.
- [ ] The generated API client is regenerated.
