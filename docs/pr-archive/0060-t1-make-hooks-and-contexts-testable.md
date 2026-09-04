# #60 ✅ T1: make hooks and contexts testable

**State:** merged 2026-07-31 · **Branch:** `t1-testing-seam` into `main` · **Diff:** +280 / -29 across 7 files · **Opened:** 2026-07-31

---

Unit `T1` from `docs/architecture-simplification-plan.md` — the prerequisite that gates `A3`, `G1` and `G2`.

## Why

There was **no way to test a hook or a context** in this repo. The only tool for exercising a component was `renderToStaticMarkup` — one static pass, no effects, no state updates, no interaction. That is why **0 of 9 contexts and 2 of 32 hooks** had tests: the capability didn't exist, rather than having been skipped.

The two largest units in the plan (`A3` collapsing `repository.ts`, `G1` splitting the 1,103-LOC `ScraperContext`) rewrite exactly that untested code. Playwright is not a substitute — it's slow, must run serially, and needs a rebuilt backend.

## What

`@testing-library/react` 16.3.2 + `@happy-dom/global-registrator`, wired through `frontend/bunfig.toml` → `frontend/test-setup.ts`. **`bun test` is sufficient — no Vitest needed.**

The proof is 7 tests on `DataContext`, chosen because the behaviour is worth pinning on its own account: the provider silently auto-selects channels that appear and drops ones that vanish, via nested `setState` updaters, then persists to localStorage. A regression there surfaces as *"my channel selection is sometimes wrong"*, not as a crash.

## The tests were mutation-tested, not trusted

They passed first try, which is a reason for suspicion rather than confidence. So I broke the source deliberately and confirmed they catch it:

| Mutation | Tests failing |
|---|---|
| never auto-add newly appeared channels | **5** |
| never drop channels that vanished | **1** |
| stop persisting selection to localStorage | **1** |
| *(restored)* | **0** — 7 pass |

## Two findings to carry into T2 / A3 / G1

**1. Bun's `mock.module` is process-wide, not file-scoped.** A first draft mocked `@/lib/repository` and silently broke `repository.test.ts` once the whole suite ran in one process — and it **hung** rather than failed, which is the worse failure mode. Context tests should **seed the react-query cache instead**. Only three of `DataContext`'s queries can fetch at all (the five log queries and `dbStats` are `enabled: false`), and seeded entries stay fresh for `SUMMARIZER_STALE_TIME`, so no `queryFn` runs and the repository is never reached.

**2. A global DOM changes existing behaviour.** `repository.posts.test.ts` assigned `globalThis.localStorage` unconditionally, commented *"bun's runtime has no localStorage"*. happy-dom now provides one as a **readonly** property, so the assignment threw and took 4 tests with it. It now polyfills only when localStorage is genuinely absent — correct with or without the preload.

## Verification

- **frontend: 686 pass / 0 fail** across 99 files, against a **679 / 98** baseline captured on unmodified `main` — the delta is exactly the 7 new tests
- `tsc -p tsconfig.build.json` clean · biome clean · `bun run build` succeeds
- Pre-commit hooks pass

Two things noted but **not** changed here:

- `tsconfig.build.json` excludes `src/**/*.test.tsx`, so test files aren't typechecked by the project's typecheck command. Pre-existing.
- Noted for **F1**: the build emits `dist/assets/schemas-*.js` at **132.84 kB (39.70 kB gzip)**. The dead generated schemas aren't just repo weight — they ship to every user.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
