# #21 ⬆️ Upgrade lucide-react to v1

**State:** merged 2026-07-25 · **Branch:** `pr6/lucide-v1` into `main` · **Diff:** +4 / -4 across 3 files · **Opened:** 2026-07-25

---

PR 6 of 7 — the last of the planned sequence. **Stacked on #20** (zod v4); base retargets to `main` once that merges. Stacked rather than parallel so the two `package.json` edits don't conflict.

Matches the upstream template's `lucide-react ^1.17.0` (resolves to 1.27.0).

## This was the step I most over-estimated

Budgeted at 2–5 h as the most expensive part of the migration — 90 files import lucide-react, and a major bump implied a rename sweep. **It was free.** v1 is a stable-release renumber of the 0.x line rather than an API break, and no icon used in this codebase was renamed or removed.

**Zero source changes.** `tsc` is clean across all 90 importers.

## One loose end tidied

`frontend/biome.json`'s `$schema` pin moves 2.3.14 → 2.5.5, matching the biome CLI that the `^2.4.16` floor now resolves to. This was left over from #18 — the mismatch emitted an advisory on every lint run.

Worth knowing: **upstream has the same staleness** (`2.3.14` pinned against `^2.4.16`), so this is a small deliberate divergence rather than a re-sync. Easy to revert if you'd rather track upstream exactly.

## One advisory deliberately left

Biome deprecates `linter.recommended` in favour of `preset`, to be removed in Biome 3. That's a config *semantic* change, not noise, so it belongs in its own commit rather than riding along with a dependency bump. Lint exits 0 today.

## Verification

- `bunx tsc -p tsconfig.build.json --noEmit` — clean
- `biome check` — exits 0
- `bun test src` — **482 passed, 0 failed** across 67 files
- `bun run build` — succeeds

🤖 Generated with [Claude Code](https://claude.com/claude-code)


## Comments

### onhazrat on 2026-07-25

## Playwright e2e run against the merged stack

Ran e2e for the first time against the full migrated stack (backend on **Python 3.14 in Docker**, all upgraded deps, zod 4 + lucide 1 on the frontend). This was the one verification gap left open in #18.

**Result: 81 passed, 2 failed (2.6 min, `workers=1`, `PLAYWRIGHT_CHANNEL=chrome`).**

Scope: `summarizer.spec.ts`, `tg-ui-primitives.spec.ts`, `settings-hub.spec.ts`, `login.spec.ts`. The other four specs (`items`, `admin`, `user-settings`, plus `reset-password`/`sign-up` transitively) still hit the known `PrivateService` client-generation gap — the client is generated with `ENVIRONMENT=production`, which excludes private routes. Pre-existing, unrelated.

### The 2 failures are pre-existing, not caused by this stack

Both are in `settings-hub.spec.ts` (`:44` and `:137`) and both are the same Playwright **strict mode violation** — `getByTestId("settings-search-results")` resolves to 2 elements:

- `components/settings/SettingsSearchResults.tsx:25` — static `data-testid="settings-search-results"` on an inner div
- `components/SettingsHub.tsx:364` — a *conditional* one on the outer container (`isSearching ? "settings-search-results" : ...`)

When a search is active, both render and match.

**Proof it predates the migration:** the spec file and both components are **byte-unchanged since `3acedb9`** — the commit immediately before #15. The conditional testid came in with `0aa131a` ("Add staging-only sourcemaps and route-derived debug identifiers").

It's deterministic rather than flaky, so it fails on every run; it went unnoticed because e2e runs are usually scoped to `summarizer.spec.ts`.

**Fix** is one line — rename one of the two testids. Deliberately *not* folded into this PR, since it's unrelated to the dependency work.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
