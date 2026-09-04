# 1. `summaries/store.test.ts` fails on CI and passes everywhere locally

**Status:** open
**Blocked by:** None

**What to fix:** `Test Frontend Unit` is the one workflow still red after CI was
re-enabled on 2026-09-05. It fails inside `src/lib/summaries/store.test.ts` with

    SyntaxError: Export named 'saveSummary' not found in module
    .../src/lib/summaries/store.ts

`store.ts` exports it. The named symbol also **changes between runs**: the first
failure said `saveSummary`, the next said `deleteSummary`, on identical source.

## The numbers

Local runs 901 tests across 118 files, all passing. CI runs **889 across the same
118 files**, with 888 pass and 1 fail. `store.test.ts` holds 13 tests, so CI
collects the file, fails it once, and loses the other 12. That accounts for the
gap exactly.

## What has been ruled out

- **Bun version.** CI pinned 1.3.12 while local ran 1.4.0. The pin was bumped to
  1.4.0 in `3fea3a1`, whose message wrongly claims this was the fix. CI still
  fails on 1.4.0, and the reported symbol simply changed. The bump is worth
  keeping on its own merits; it was not the cause.
- **An import cycle.** A value-import graph over all of `src/` finds zero cycles
  reaching `store.ts`. `import type` was excluded, since it is erased.
- **Install layout.** CI runs `bun install` inside `frontend/` while the repo is
  a workspace rooted one level up. Reproducing that locally still gives 901 pass.
- **Filename casing.** The suspicion was macOS resolving a case-mismatched path
  that Linux would not. All four of the test's imports (`@/hooks/queryKeys`,
  `@/lib/queryClient`, `@/lib/singleFlight`, `@/types`) match their files exactly,
  and `git ls-files` shows no two paths differing only by case.
- **Module shadowing.** No `store/` directory beside `store.ts`.

## What is left

The remaining difference between the two environments is the operating system:
macOS locally, Linux on the runner. Nothing above explains why that changes
whether bun sees a plain named export.

The next step is to stop guessing from here and reproduce it on Linux, either in
the `test-docker-compose` image or with `act`, where the failure can be bisected
directly instead of through a five-minute CI round trip.
