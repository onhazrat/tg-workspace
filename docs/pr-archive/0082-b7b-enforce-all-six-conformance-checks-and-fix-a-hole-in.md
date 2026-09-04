# #82 ✅ B7b: enforce all six conformance checks, and fix a hole in the guard

**State:** merged 2026-08-01 · **Branch:** `b7b-conformance` into `main` · **Diff:** +221 / -31 across 3 files · **Opened:** 2026-08-01

---

Part of the architecture-simplification programme (`docs/architecture-simplification-plan.md`, workstream B).

## The plan's premise was wrong, and the finding is the unit

B7b was "enforce the four remaining conformance checks", assuming unfinished work. Enumerating the mismatch sets — by iteratively `Exclude`-ing each field TypeScript named, since it reports only the first member of a union — gave exactly **eight** fields, and every one is a place where **our type is deliberately narrower than the server's**:

| | server | ours |
|---|---|---|
| `LLMLog.status`, `NetworkLog.status` | `string` | `"success" \| "failed"` |
| `LLMLog.type` | `string` | four known prompt kinds |
| `Post.retrievalPass` | `string \| null` | `"initial" \| "incremental"` |
| `Post.media`, `Post.links` | untyped JSON | `PostMedia`, `PostBodyLink[]` |
| `Channel.tags`, `Channel.discoveredVia` | untyped JSON | shaped |

None is drift, and none is fixable in the original direction — it asks the *server* to declare a literal union it deliberately does not, or a nested model that `schemas/posts.py` documents at length why it must not (declaring it changes the wire format, the B3 rule).

Widening our types to match was the mechanical reading, and would have **thrown away real knowledge**: those four narrowings are what let a `switch` over log status be exhaustive.

## So: three assertions per model, not one

1. **`…Conforms`** — server fields stay assignable to ours. Catches a **retype**.
2. **`…RefinementsHold`** — the narrowed fields stay *subtypes* of the server's. Catches a retype hiding under a narrowing.
3. **`…HasServerFields`** — an explicit allowlist of load-bearing columns is still *declared*.

## (3) exists because the guard had a hole, and its docstring denied it

The file claimed *"Rename `postsCount`, retype `timestamp` as a string, or drop a column, and the corresponding line stops compiling."*

It did not. `MismatchedServerFields` iterates the **intersection** of the two key sets, so a renamed or dropped column simply leaves the comparison rather than failing it — silently, guard still green. A mutation renaming a server field **compiled clean**.

Same shape of defect as B7's first draft, which could not fail at all. Found only by mutation-testing the guard rather than trusting it.

## One TypeScript subtlety was load-bearing

`PostMedia` had to become a `type` alias rather than an `interface`: TS gives aliases an implicit index signature but withholds one from interfaces, so only the alias form is assignable to the server's `media?: { [key: string]: unknown }`. Nothing extends or merges into it, so the forms are otherwise identical.

## Mutation-tested, and one limitation stated honestly

| scenario | caught |
|---|---|
| server renames a field | ✅ |
| server retypes a refined field (`status: string → number`) | ✅ |
| server retypes a plain field (`timestamp → string`) | ✅ |
| server changes a JSON column's shape | ✅ |
| **we** widen our own type for an untyped JSON column | ❌ |

The last **cannot** be caught: if the server says `media?: {[key: string]: unknown}` it contributes no information to validate `PostMedia` against. That is a property of the loose column, not a gap in the guard, and it is now written in the file rather than left implicit.

## Verified

frontend **744 pass / 0 fail** · `tsc` clean · biome clean.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
