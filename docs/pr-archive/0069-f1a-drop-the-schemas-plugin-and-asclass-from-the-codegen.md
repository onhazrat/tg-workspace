# #69 🔧 F1a: drop the schemas plugin and asClass from the codegen config

**State:** merged 2026-08-01 · **Branch:** `f1-codegen-config` into `main` · **Diff:** +2791 / -8728 across 19 files · **Opened:** 2026-08-01

---

Unit `F1` from `docs/architecture-simplification-plan.md`, **split** — this is `F1a`.

## What

- **`@hey-api/schemas` dropped** → `schemas.gen.ts` deleted, **5,930 LOC**. (The audit measured 2,986; it grew as B1–B6 added response models.) The generated client goes **10,796 → 4,866 lines**.
- **`asClass: true` dropped** → the SDK emits tree-shakeable standalone functions. 16 `XService.method()` call sites became `xServiceMethod()`.

## The audit's bundle claim was wrong — and this disproves it

The audit said dropping `@hey-api/schemas` would remove `dist/assets/schemas-*.js` at **132.84 kB (39.70 kB gzip)**, "shipped to every user for code nothing imports."

**It is not that file.** Three independent checks:

1. Deleting `schemas.gen.ts` left that chunk **byte-identical** — same content hash `i5p3SWqF`.
2. Its contents are Radix/React helpers. Vite names the chunk after `src/lib/settings/schema.ts`, its entry module — a coincidence of naming.
3. Total assets moved **2204 KB → 2200 KB** (4 KB) across the same 25 chunks.

`schemas.gen.ts` was never exported from `client/index.ts`, so nothing could import it and it was **already tree-shaken out**.

**The real payoff is repo weight, not bundle size:** 5,930 lines of generated noise that regenerated on every API change and buried real diffs in review. Worth doing — just not for the stated reason. §6's metrics table is corrected.

## Why `F1b` is split out

The planned F1 bundled a third change — replacing `legacy/axios` with the fetch transport — and sized all three as **S**. That is wrong for this one. `@hey-api/client-fetch` **does not throw**; it returns `{data, error, response}`. So the swap changes error *semantics*:

- `main.tsx` builds `QueryCache`/`MutationCache` `onError` around `err instanceof ApiError`
- `utils.ts` narrows on both `ApiError` and `AxiosError`
- all 16 call sites rely on a throwing client

Plus the `clearStaleSession()` port. It needs the **e2e login flow** to verify — the exact path the change can silently break — so it gets its own PR. The `axios` dependency comes out there, not here.

## Verification

| Check | Result |
|---|---|
| frontend suite | **686 pass / 0 fail** |
| `tsc -p tsconfig.build.json` | clean |
| biome | clean |
| `bun run build` | succeeds; 2204 KB → 2200 KB |

🤖 Generated with [Claude Code](https://claude.com/claude-code)
