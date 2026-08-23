# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root: the glossary. It holds no implementation detail.
- **`docs/migration/`**: this repo's ADRs are `ADR-001` … `ADR-010` **there**, not in `docs/adr/`. Read the ones that touch the area you're about to work in.
- **`docs/migration/DECISIONS.md`**: locked migration decisions, marked *"do not revisit without explicit stakeholder sign-off"*. Read it the same way you read an ADR, and treat a contradiction with it as a conflict to surface rather than override.
- **`CLAUDE.md`** at the repo root: architecture and the enforced guards. Its "Architecture guards" table says which rules are enforced by a failing test or a compile error and which are only prose.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a **single-context** repo. The root `package.json` declares a `frontend` workspace, but that
splits the backend from the frontend of one product; both halves share the vocabulary in the single
root `CONTEXT.md`.

```
/
├── CONTEXT.md                          ← the glossary
├── CLAUDE.md                           ← architecture + enforced guards
├── docs/migration/
│   ├── DECISIONS.md                    ← locked decisions
│   ├── ADR-001-repo-layout.md
│   └── …  ADR-002 … ADR-010
├── backend/
└── frontend/
```

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids: each entry carries an explicit *Avoid* list, and those are the words not to reach for.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR or a locked decision, surface it explicitly rather than silently overriding:

> _Contradicts ADR-002 (light auth, single-operator), but worth reopening because…_
