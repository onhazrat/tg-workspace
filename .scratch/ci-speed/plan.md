# CI speed plan

Status: Proposed  
Constraint: stay on standard `ubuntu-latest` / existing self-hosted deploys — **no larger runners, no paid Actions features**. Repo stays public → Actions minutes stay free.  
Goal: cut **wall-clock** to merge-green as far as possible; secondary goal is fewer flake-induced 30–40 min outliers.

Progress legend: `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cancelled / deferred

## Tasks

### Decisions (block Phase 1+ coding)

- [ ] D1 — Choose image distribution: GHCR (recommended) vs docker-save artifacts
- [ ] D2 — Choose fork-PR policy: build-in-job fallback (recommended) vs maintainer-only Playwright
- [ ] D3 — Choose backend matrix width: 3 jobs `api` / `services` / `rest` (recommended) vs 2
- [ ] D4 — Choose coverage HTML: every PR without `dynamic_context` vs `main`-only artifact

### Phase 0 — Instrument

- [ ] 0.0 Phase 0 complete (exit: green PR with durations in logs; no behavior change)
  - [ ] 0.1 Add `pytest --durations=30` to backend CI test invocation
  - [ ] 0.2 Enable Playwright slow-test / per-file timing in CI shard logs
  - [ ] 0.3 Add `.scratch/ci-speed/results.md` and record baseline wall-clock from a green run

### Phase 1 — Shared Playwright build + shards

- [ ] 1.0 Phase 1 complete (exit: shard jobs spend ~0 on build; wall-clock dominated by slowest shard tests)
  - [ ] 1.1 Split `playwright.yml`: add single `build-images` job (buildx + `compose.cache.yml` as sole cache writer)
  - [ ] 1.2 Tag and push `backend` / `frontend` / `playwright` images to GHCR as `:<git-sha>` (public packages)
  - [ ] 1.3 Change `test-playwright` matrix to pull/retag images only — no `docker compose build` on shards
  - [ ] 1.4 Implement fork fallback (per D2): same-repo pushes to GHCR; forks build in-job with GHA cache
  - [ ] 1.5 Drop `ENVIRONMENT=local bash scripts/generate-client.sh` from Playwright CI
  - [ ] 1.6 Split `frontend/tests/summarizer.spec.ts` into 3–4 files by feature area
  - [ ] 1.7 Raise Playwright matrix from 2 → 4 shards after shared build is green
  - [ ] 1.8 Confirm required status checks / `alls-green` still match new job names
  - [ ] 1.9 Record Phase 1 wall-clock in `results.md` (warm + one cold if available)
  - [ ] 1.10 Do **not** raise Playwright `workers` above 1

### Phase 2 — Backend off the critical path

- [ ] 2.0 Phase 2 complete (exit: backend wall-clock ≤ Playwright; target ~3–5 min)
  - [ ] 2.1 Add path filters to `test-backend.yml` (`backend/**`, lockfiles, compose, workflow)
  - [ ] 2.2 Remove `dynamic_context = "test_function"` from default CI coverage path
  - [ ] 2.3 Keep `--fail-under=70`; gate HTML artifact per D4 (`main`-only or every PR without contexts)
  - [ ] 2.4 Introduce matrix jobs with **separate DBs** per D3 (`app_test_api` / `app_test_services` / …)
  - [ ] 2.5 Wire `coverage run --parallel-mode` per matrix leg + combine job + fail-under
  - [ ] 2.6 Re-measure; only if still long-pole, spike per-worker DBs + xdist inside largest leg (else mark `[-]`)
  - [ ] 2.7 Record Phase 2 wall-clock in `results.md`

### Phase 3 — Redundant / always-on work

- [ ] 3.0 Phase 3 complete (exit: unrelated PRs skip untouched workflows; smoke uses cache)
  - [ ] 3.1 Path-filter `test-docker-compose.yml` to compose/Dockerfiles/workflow
  - [ ] 3.2 Add `compose.cache.yml` + buildx (or reuse Phase 1 GHCR tags) to docker-smoke
  - [ ] 3.3 Path-filter `zizmor.yml` to `.github/workflows/**`
  - [ ] 3.4 Leave `pre-commit.yml` always-on for PRs (no aggressive path filter)
  - [ ] 3.5 Decide later: fold smoke health-check into Playwright build vs keep separate (`[-]` until Phase 1 stable)

### Phase 4 — Flake tax

- [ ] 4.0 Phase 4 complete (exit: failed-run wall-clock ≈ green + one retry, not +20 min docker)
  - [ ] 4.1 After Phase 1, inventory flaky titles from last ~20 failed Playwright runs
  - [ ] 4.2 Fix root causes (shared account / channel-list / timing) — no retry inflation
  - [ ] 4.3 Keep `--fail-on-flaky-tests`
  - [ ] 4.4 Optionally drop `retries` 2 → 1 once flake rate is near zero (data-gated)
  - [ ] 4.5 Record failure outlier times in `results.md`

### Phase 5 — Stretch (only if wall-clock still > ~5 min)

- [ ] 5.0 Phase 5 complete or marked deferred
  - [ ] 5.1 Playwright 6 shards if 4 still unbalanced after summarizer split
  - [ ] 5.2 Backend xdist + per-worker DBs inside largest matrix leg
  - [ ] 5.3 Optional: merge frontend-unit into pre-commit bun install (tiny win)
  - [ ] 5.4 Skip entire phase if Phases 1–4 already meet success metrics (`[-]`)

### Success criteria

- [ ] S1 — Green PR wall-clock p50 ≤ 6 min
- [ ] S2 — Green PR wall-clock p95 ≤ 10 min
- [ ] S3 — No Playwright **shard** job spends >5 min in `docker compose build` (should be ~0)
- [ ] S4 — Backend no longer the long pole on backend-touching PRs
- [ ] S5 — Still $0 Actions minutes on public standard runners; GHCR packages public

---

## Current baseline (measured 2026-09-08)

| Signal | Value |
|---|---|
| Green PR wall-clock | ~12 min (Playwright critical path) |
| Backend | ~9.5 min (`2391 passed in 503s` under coverage) |
| Playwright (warm cache) | ~12 min: ~3 min docker build ×2 shards + 6–8 min tests |
| Playwright (cold/contended cache) | build alone **18–20 min** on one shard |
| Failed Playwright | 27–42 min (cold build + retries) |
| Billed runner-min / green PR | ~34 (free while public; still a concurrency/fair-use load) |

Critical path today: **Playwright ≈ Backend ≈ 10–12 min**. Everything else is noise for wait time.

## Non-negotiables

1. Playwright `workers: 1` stays until tests have per-worker users/DBs (parallelism already measured as slower and flakier).
2. Backend stays on one `app_test` DB with per-test truncate unless we add **per-worker databases** — naive `pytest-xdist` will race.
3. No larger / macOS / Windows hosted runners.
4. Do not weaken architecture guards to “go green faster.”
5. Client drift stays enforced by pre-commit `generate-frontend-sdk` + conform files; Playwright must not become the only check.

## Target shape (end state)

```
PR opened / push
├── zizmor          (workflow paths only)           ~15s
├── pre-commit      (always on PR; already ~1m)     ~1m
├── frontend-unit   (frontend paths)                ~30s
├── backend         (backend paths; faster suite)   ~3–5m  ← leave critical path
├── docker-smoke    (compose/Dockerfiles only)      ~1m
└── playwright
    ├── changes? (existing filter)
    ├── build (once) → push GHCR :sha             ~2–4m warm / bounded cold
    ├── test shard 1..4 (pull only, workers=1)    ~3–4m each → wall ~3–4m
    └── merge reports
Wall-clock target: ~4–6 min green when cache/GHCR warm; cold first push still
bounded by one build, not two racing writers.
```

---

## Phase 0 — Instrument (small, unblocks every later phase)

**Why:** we optimized from one green run; next changes need numbers.

- Backend CI: add `pytest --durations=30` (or write JUnit) so the top 30 slow tests are visible in the log.
- Playwright: enable `reportSlowTests` / print per-file timing in the shard log once; confirm file-level shard balance after splits.
- Document measured wall-clock in this folder after each phase (`results.md`).

**Exit:** one green PR with durations in the log; no behavior change.

---

## Phase 1 — Kill the Docker double-build (highest wall-clock + outlier impact)

**Problem:** both Playwright shards run `docker compose build` and both `cache_to` the same GHA scopes. Warm ≈ 3 min ×2; cold/race ≈ 18–20 min on one shard.

**Do:**

1. Split `playwright.yml`:
   - `build-images` job: setup buildx + GHA runtime, `docker compose build` **once**, tag `backend` / `frontend` / `playwright` as `ghcr.io/<owner>/<repo>/…:<git-sha>`, push.
   - `test-playwright` matrix: `docker pull` those tags (or retag locally), **no rebuild**, run shard tests.
2. Permissions: `packages: write` on the build job; images **public** (free storage/transfer for public packages).
3. Keep `compose.cache.yml` on the **build** job only (single writer). Shards do not write cache.
4. Tag strategy: `:sha` immutable; optional `:playwright-cache` moving tag unused — prefer digest/sha only.
5. Drop `ENVIRONMENT=local bash scripts/generate-client.sh` from Playwright CI. Trust committed client; drift stays on pre-commit. Saves ~15s + avoids local-vs-production OpenAPI divergence in the image.
6. After shared build is green, raise matrix to **4 shards**.

**Also in this phase (cheap):**

- Split `frontend/tests/summarizer.spec.ts` (~54 tests / ~1900 LOC) into 3–4 files by feature area so file-based sharding balances. Without this, 4 shards still leave one fat file as the long pole.

**Do not:** raise `workers` above 1.

**Exit:** green Playwright wall-clock dominated by the slowest shard’s **test** time (~3–4 min after split+4 shards), not by build. Cold-path build happens **once**.

**Risks / watch:**

- GHCR auth on forks: fork PRs often lack `packages: write`. Keep a fallback: forks build locally with GHA cache (today’s path), or require maintainer runs. Prefer: `if: github.event.pull_request.head.repo.full_name == github.repository` for push; forks use build-in-job path.
- Image size (~2.2GB backend): push/pull time is real; still beats dual cold builds.
- Branch protection: required check name may change if job names change — update required status checks.

---

## Phase 2 — Backend off the critical path

**Problem:** ~9.5 min serial suite under `coverage run` with `dynamic_context = "test_function"`. Cannot flip on xdist safely.

**Do, in order:**

1. **Path filters** on `test-backend.yml`: `backend/**`, root `uv.lock` / `pyproject.toml`, `compose*.yml` (db), `.github/workflows/test-backend.yml`. Docs-only / frontend-only PRs skip.
2. **CI coverage diet:**
   - Remove `dynamic_context = "test_function"` from the default CI path (keep optional local HTML-with-contexts via env or a `coverage-html` workflow_dispatch).
   - Keep `--fail-under=70` (today ~88%). Optionally run full HTML artifact only on `main`.
3. **Matrix split (not xdist):** 2–3 jobs sharing one service container pattern, **each with its own DB name** (`app_test_api`, `app_test_services`, …) created in the job:
   - Job A: `tests/api`
   - Job B: `tests/services`
   - Job C: `tests/jobs tests/deployment tests/core tests/scripts tests/prompts tests/crud`
   - Each job: own postgres (or one postgres, multiple databases), migrate, `coverage run` with `--parallel-mode` data file, then a tiny `coverage-combine` job + fail-under.
4. Re-measure. If still > Playwright wall-clock, only then consider true xdist **inside** one directory with per-worker DBs (`app_test_gw0` …) — larger fixture change; defer unless needed.

**Exit:** Backend wall-clock ≤ Playwright (target ~3–5 min). Critical path becomes Playwright shards or pre-commit.

**Risks:** matrix multiplies free minutes (acceptable). Truncate/inventory guards must see the right DB. Combine coverage must still hit 70.

---

## Phase 3 — Stop paying for redundant / always-on work

1. **`test-docker-compose.yml`:** add path filters (`compose*.yml`, `Dockerfile*`, `backend/Dockerfile*`, `frontend/Dockerfile*`, workflow file). Layer `compose.cache.yml` + buildx like Playwright’s build job (or reuse GHCR tags from Phase 1 when the same SHA already built — optional later).
2. **`zizmor.yml`:** path-filter to `.github/workflows/**` (and zizmor config if any). Already cheap; avoid pointless runs.
3. **`pre-commit.yml`:** leave always-on for PRs (auto-fix / SDK regen). Do **not** path-filter aggressively — formatting and SDK hooks are the point.
4. **Smoke vs Playwright overlap:** keep smoke as a cheap boot gate with cache; do **not** delete it until branch protection + Phase 1 are stable. Optional later: one curl health step inside the Playwright build job and drop the separate workflow (saves a runner, not wall-clock once Playwright is ~4 min).

**Exit:** unrelated PRs run only what they touch; smoke no longer cold-builds without cache.

---

## Phase 4 — Flake tax (outlier killer)

Failed runs at 27–42 min are mostly cold/contended builds (Phase 1) plus `retries: 2`.

1. After Phase 1, collect remaining flaky titles from blob/HTML reports (last 20 failed Playwright runs).
2. Fix root causes (shared channel list / timing / unbounded fetches called out in `playwright.config.ts` comments) rather than raising retries.
3. Keep `--fail-on-flaky-tests` (quality signal). Do not hide flakes by disabling it.
4. Optional: `retries: 1` once flake rate is near zero — cuts failure wall-clock; only after data says so.

**Exit:** failed run wall-clock ≈ green run + one retry on one test, not +20 min of docker.

---

## Phase 5 — Stretch (only if still hungry)

- Playwright: 6 shards if 4 still unbalanced after `summarizer` split.
- Backend: per-worker DBs + xdist inside the largest matrix leg.
- Cache GHCR images between PRs on the same SHA only (already); do not try to share mutable `:latest` across PRs.
- Consider merging frontend-unit into pre-commit’s bun install to save a runner (tiny wall-clock win).

Skip unless Phases 1–4 leave wall-clock above ~5 min.

---

## Explicitly out of scope

| Idea | Why not |
|---|---|
| Playwright `workers: 2+` without isolation | Already measured regression |
| Naive `pytest-xdist` on one `app_test` | Truncate races |
| Larger runners | Not free |
| Paying for Actions / BuildJet / etc. | Violates free constraint |
| Deleting architecture-guard tests to go faster | Wrong trade |
| Making Playwright skip on push to `main` | `main` must stay honest |

---

## Sequencing & approval gates

| Phase | Touches | Approx effect on green wall-clock | Approve before coding? |
|---|---|---|---|
| 0 Instrument | workflows only | none | no — do first |
| 1 Shared build + shard + split summarizer | `playwright.yml`, GHCR, `summarizer.spec.ts` | **12 min → ~5–7 min**; kills 18–20 min build spikes | **yes** (forks + required checks) |
| 2 Backend matrix + coverage diet + paths | `test-backend.yml`, coverage config, maybe compose test DBs | Backend **9.5 → ~3–5 min**; leaves critical path | **yes** (DB-per-job design) |
| 3 Path filters / smoke cache | other workflows | fewer runs; little green-path change | soft |
| 4 Flakes | frontend tests | failure outliers | yes if behavior changes |
| 5 Stretch | as needed | marginal | yes |

## Success metrics

- Green PR wall-clock **p50 ≤ 6 min**, **p95 ≤ 10 min** (vs ~12 / ~40 today).
- No Playwright job spends >5 min in `docker compose build` on a shard (shards should spend ~0).
- Backend no longer the long pole on backend-touching PRs.
- Still $0 Actions minutes on public standard runners; GHCR packages public.

## Challenge / decisions needed from you

1. **GHCR vs docker-save artifact** for Phase 1: I recommend **GHCR** (public packages, pull by digest). Artifacts for multi-GB images are clumsy and slow to upload twice. OK?
2. **Fork PRs:** accept “build-in-job fallback for forks” vs “maintainer-only Playwright for forks”?
3. **Backend matrix:** 2 jobs (`api` | `rest`) vs 3 (`api` | `services` | `rest`)? I recommend **3** given services ≈ half the suite.
4. **Coverage HTML every PR:** drop to `main`-only, or keep artifact without `dynamic_context`?

Once those four are decided, Phase 0+1 can land as the first implementation PR.
