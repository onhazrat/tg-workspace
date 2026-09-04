# #18 ⬆️ Frontend dependency catch-up

**State:** merged 2026-07-25 · **Branch:** `pr4/frontend-deps` into `main` · **Diff:** +1098 / -857 across 21 files · **Opened:** 2026-07-25

---

PR 4 of 7. **Stacked on #17** — bases retarget as each merges.

Non-breaking bumps to match the upstream template. **29 packages**, including react/react-dom 19.0.0 → 19.2.7, axios 1.13.5 → 1.18.0, typescript 5.8.2 → 5.9.3, `@types/node` 22 → 25, biome 2.3.14 → 2.4.16, `@playwright/test` 1.58.2 → 1.61.1, `@tanstack/react-query` 5.90 → 5.101, the radix-ui set, react-hook-form, tailwind-merge, form-data.

`frontend/Dockerfile.playwright` → `v1.61.1-noble`, in lockstep with `@playwright/test` (the two must match exactly).

## Deliberately not touched

| Package | Why |
|---|---|
| `vite` `^8.1.5`, `@tailwindcss/vite` `^4.3.3` | **we're ahead** of upstream's `^8.0.16` / `^4.3.0` |
| `@vitejs/plugin-react` | upstream uses `-swc`; that's a real swap, not a bump — out of scope |
| `@tanstack/router-plugin` | upstream's `^1.168.18` would be a **downgrade** from our `^1.168.23` |
| `zod`, `lucide-react` | both majors — PR 5 and PR 6 |

## Two pre-existing defects, surfaced by the newer tooling

Neither was introduced here; both were latent and are now caught:

1. **`contexts/ChatContext.tsx`** had `systemInstruction ?? "" ?? ""` — a dead second coalesce. TypeScript 5.9 reports it as `TS2881`.
2. **`lib/commands/palette-search.test.ts`** used `(state?.items as T[]).map(...)` in two places. If `state` were undefined this **throws** rather than short-circuiting — the cast hides it from the type checker. biome 2.4's `noUnsafeOptionalChaining` catches it. Both sites already assert `state` exists, so a non-null assertion states the actual intent.

`lib/settings/search.ts` picks up biome 2.4's revised type re-export ordering.

## Verification

- `bunx tsc -p tsconfig.build.json --noEmit` — clean
- `biome check` — clean
- `bun test src` — **482 passed, 0 failed** across 67 files
- `bun run build` — succeeds

Playwright e2e is **not** run here: it needs the full stack up and must run with `--workers=1`. Worth running against the merged stack before this ships.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
