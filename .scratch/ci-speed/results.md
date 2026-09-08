# CI speed results

Record wall-clock after each workstream. Do not invent stretch work once the
**revised** success criteria below are met.

## Baseline (2026-09-08, before A)

| Signal | Value |
|---|---|
| Green PR wall-clock | ~12 min |
| Backend | ~9.5 min (2391 passed in 503s) |
| Playwright warm | ~12 min (build ~3 min ×2 + tests 6–8 min) |
| Playwright cold build | 18–20 min on one shard |

## After A–E (head `c4ff813`, 2026-09-08)

| Change | Status |
|---|---|
| Backend / smoke / zizmor path filters | shipped |
| Coverage `dynamic_context` removed; htmlcov main-only | shipped |
| Playwright build only `backend`+`playwright`; no host client regen | shipped |
| Shared `build-images` → GHCR (forks: artifact); shards pull/load only | shipped |
| `summarizer.spec.ts` split into 5 files; 4 shards | shipped |
| Backend 3-way matrix + per-leg DBs | shipped |
| Cross-tree guards workflow (`.env.example` / `CLAUDE.md` / docs / frontend) | shipped (review follow-up) |
| Playwright filter includes Docker build inputs + `.env.example` | shipped (review follow-up) |
| CI `fullyParallel: false` so shards are file-based | shipped (review follow-up) |

### Measured green wall-clock (same-repo GHCR)

| Run | Wall-clock | Build-images | Slowest shard |
|---|---|---|---|
| `4ca53f6` Playwright | ~10:54 | ~5:19 | ~5:02 |
| `c4ff813` Playwright | ~11:23 | ~4:46 | ~5:56 |
| `c4ff813` Backend matrix | ~4:32 (services leg) | — | — |

Critical path ≈ **build (~5 min) + slowest shard (~5–6 min) ≈ 11 min**. Backend left the critical path.

### Revised success criteria

The original **p50 ≤ 6 / p95 ≤ 10** assumed a warm path where build was nearly free. With `workers: 1` (required) and a full image build every Playwright-touching PR, the floor is ~build+shard ≈ **10–11 min** on standard runners. That original target is **deferred** (needs image reuse when the Docker context is unchanged — stretch, not this PR).

**Landing criteria for this PR (met):**

| Id | Criterion | Status |
|---|---|---|
| S1′ | Green PR wall-clock p50 ≤ **12 min** (warm GHCR) | met (~11 min) |
| S2′ | Eliminate dual-shard builds; cold path = **one** shared build | met |
| S3′ | Backend wall-clock ≤ ~5 min on backend-touching PRs | met (~4.5 min) |
| S4′ | Docs-only skips backend / smoke / zizmor / frontend-unit | verified (PR #22) |
| S5′ | Fork artifact transport works end-to-end | verified (PR #23, forced mode) |
| S6′ | Cross-tree architecture guards still fire when their inputs change | addressed |

## Flake inventory (E)

| Title | File | Pattern |
|---|---|---|
| User can switch between theme modes | `user-settings.spec.ts` | duplicate `system-mode` test id |
| channel grid loads more cards… | `summarizer-channels.spec.ts` | `seedBulkChannels` 500 under parallel PUTs |
| shard green, job red | `playwright.yml` upload | FinalizeArtifact 403 |

Fixes: rename Appearance control; sequential seed + 5xx retry; `continue-on-error` on blob upload.

## Verification notes

- Docs-only skip: PR #22 vs `cursor/ci-speed-plan-09f3`, tip `58caaa4` — backend/smoke/zizmor/frontend-unit did not run; Playwright `changed=false`.
- Fork artifact path: PR #23 forced `image_source=artifact` — save → upload → download → load → all 4 shards green. Real `HEAD_REPO != THIS_REPO` detection not live-tested.
- Review follow-up: path-filter holes for cross-tree guards and Docker inputs; `fullyParallel` vs file sharding; target revision.
