# CI speed results

Record wall-clock after each workstream. Do not invent stretch work once S1–S5 in `plan.md` are met.

## Baseline (2026-09-08, before A)

| Signal | Value |
|---|---|
| Green PR wall-clock | ~12 min |
| Backend | ~9.5 min (2391 passed in 503s) |
| Playwright warm | ~12 min (build ~3 min ×2 + tests 6–8 min) |
| Playwright cold build | 18–20 min on one shard |

## After A–C (this PR)

| Change | Status |
|---|---|
| Backend / smoke / zizmor path filters | shipped |
| Coverage `dynamic_context` removed; htmlcov main-only | shipped |
| Playwright build only `backend`+`playwright`; no host client regen | shipped |
| Shared `build-images` → GHCR (forks: artifact); shards `--no-build` | shipped |
| `summarizer.spec.ts` split into 5 files; 4 shards | shipped |
| Backend 3-way matrix + per-leg DBs | shipped |
| Measured green wall-clock | _pending first green CI on this branch_ |

## Flake inventory (E)

From failed Playwright runs on 2026-09-08 (pre- and mid-fix):

| Title | File | Pattern |
|---|---|---|
| User can switch between theme modes | `user-settings.spec.ts` | `locator.click` timeout; `--fail-on-flaky-tests` red on retry pass |
| (same) Selected mode is preserved… | `user-settings.spec.ts` | Same duplicate `system-mode` test id on `/settings` |
| channel grid loads more cards… | `summarizer-channels.spec.ts` | `seedBulkChannels` 500 under `Promise.all` of PUTs |
| shard green, job red | `playwright.yml` upload | `FinalizeArtifact` 403 after 34 passed |

Theme root cause: `/settings` rendered Appearance segmented control **and** sidebar theme dropdown both with `data-testid="system-mode"`. Fix: rename section control to `appearance-section-system-mode`.

`seedBulkChannels` root cause: each PUT commits then `touch_sync("channels")` locks one `tg_sync_meta` row; 25–70 parallel creates queue and intermittently 500. Fix: sequential puts + 5xx retry.

Upload: `continue-on-error: true` on blob-report upload so an Actions storage 403 cannot fail a green shard.

Cold docker builds (18–20 min) and cache races were the other outlier driver — addressed by workstream B, not a test flake.

`retries: 2` left as-is until a green streak shows flake rate near zero.
