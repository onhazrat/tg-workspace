# DDS-03: Drop `Post.harvested`

**Status:** needs-info

## What to build

A migration dropping `Post.harvested` and its partial index, and the Post upsert's reset of it.
Nothing reads the flag once DDS-02 lands.

## Acceptance criteria

- [ ] Staging shows the Directory kept growing after DDS-02 shipped (entry count and probe usage
      over at least a week).
- [ ] Column, index and every reference to the flag removed; autogenerate shows no drift.
- [ ] Backend suite passes.

## Blocked by

- DDS-02, plus the staging evidence above (why this is `needs-info`, not `ready-for-agent`).
