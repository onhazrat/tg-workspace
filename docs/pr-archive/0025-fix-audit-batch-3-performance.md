# #25 ⚡ Fix audit Batch 3: performance

**State:** merged 2026-07-26 · **Branch:** `ui-ux-audit-batch3` into `main` · **Diff:** +1275 / -165 across 29 files · **Opened:** 2026-07-26

---

Batch 3 of the staging UI/UX audit — performance. Follows #23 (security) and #24 (correctness). All five items shipped.

Full re-verification of all findings: `docs/staging-ui-ux-audit-verification.md`.

## Regression coverage

Every fix ships with a test. Frontend unit **552 → 571**; backend gains **14 route tests**.

## What changed

| ID | Fix |
|---|---|
| **B4** | Debug narration was reaching the console of built bundles. New `lib/logger.ts`; the 18 `console.log` calls route through `logger.debug`, gated on `import.meta.env.DEV` as a *direct member access* so Vite folds the branch. Verified in the production bundle: the function compiles to `debug:(...e)=>{}` with **zero** surviving `console.debug`. A source sweep fails if `console.log` returns, and is itself checked against a reintroduction. |
| **B5** | `/data/posts/counts` moved from GET to POST with a JSON body. At 43 channels the query string was ~700 chars; at the ~1,070 a real account holds it is ~13 KB — past what proxies accept in a request line. Committed client regenerated. |
| **B3** | Channel photos and post thumbnails carried no caching headers, so every reload re-downloaded every avatar. They now return `ETag` + `Cache-Control: private, max-age` and answer `If-None-Match` with a 304. |
| **B1** | The channel-list mirror write moved off the critical path, plus a bulk `cache.saveChannels` and an in-flight guard on the retention pass. |
| **B2** | Channels grid windowed with `@tanstack/react-virtual`. Initial DOM: **20 cards / 1,442 nodes → 9 cards / 654 nodes**. |

## B1's stated cause was wrong

The audit reports "~30 second client-side IndexedDB init on every page load," read from the console gap between `[DB] Initializing database...` and the retention lines 30 seconds later. That gap is not init: `useCachePrune` has always had `PRUNE_START_DELAY_MS = 30_000`, so the prune is *deliberately* deferred by exactly 30 seconds. `initDB` is also memoised behind a module-level promise.

The real cost is elsewhere and worse — `listChannelsWithStats()` did:

```ts
for (const row of rows) { …; await cache.saveChannel(channel) }
```

One awaited IndexedDB transaction **per channel, serially**, in front of the data the Channels tab renders — ~1,070 round-trips. That is the long skeleton phase. It now returns immediately and writes the mirror in one bulk transaction at idle. The mirror stays: `DECISIONS.md` §5 keeps it as the offline read cache.

Two further claims did not hold. The "second run" cannot be React StrictMode — that double-invoke is dev-only and the audit measured a production bundle. And deleting rows older than *N* days is idempotent, so a repeat pass was wasted work, not data loss. The genuine gap — two prunes overlapping if one outlives the interval — is now guarded.

## B2 was reverted on false evidence, then restored

Worth recording because the failure mode is subtle.

The first e2e run showed **17 of 61 failing** and the change was pulled. The tell that something was wrong: after reverting virtualization *completely*, the suite got **worse — 23 failing**. A revert cannot do that.

The cause was environmental. The backend container had been started before the B5 route change and never rebuilt (`docker compose up -d` does not rebuild), so it still served `GET /posts/counts` and answered the new `POST` with **405**. Every counts call failed, channel cards failed to render, and the damage surfaced in the palette, tag-chain, trim and grid-scroll specs — exactly the profile of broken windowing. After `up -d --build backend`, virtualization passes **61/61**.

Contaminated runs also took ~4x longer (10.2 min vs 2.5 min) because failures burn retry time; a suspiciously slow suite is itself a signal.

One genuine bug surfaced during the work: the first implementation hung the page under scroll, from a `useEffect` keyed on the `virtualizer` object — a fresh reference each render, so every render re-measured and every measure re-rendered. Typecheck and unit tests were clean throughout; only a browser caught it. It is now keyed on `lanes`, with a comment saying why.

`overscan` is deliberately 6 rows rather than the default 2: beyond smoothing scrolling, it keeps a workable number of cards mounted for anything locating them by `[data-channel-name]` without scrolling first.

## ⚠️ Not fixed — same defect, two sibling routes

B5 fixed `/posts/counts` because that is what a cold Channels load happens to issue. The **same unbounded query string** is built by `getPosts`, `getPostsFeed` (the hot Posts-feed path) and `getDiscoverCandidates`, hitting `GET /data/posts` and `GET /data/discover/candidates`. All three carry the full selection and fail identically at ~1,070 channels.

They are deliberately **not** fixed here: converting `GET /posts` — a resource listing used by the feed, exports and repository batching — to POST touches three client methods plus the generated client, and wants its own PR and e2e pass. `postScopeBody` and `PostScopeRequest` now exist as the shared pattern, so it is mechanical work.

## Verification

- `biome` clean · `tsc --noEmit` clean · `mypy` + `ruff` clean
- **571** frontend unit tests, **514** backend tests
- **61/61 e2e**, against a freshly rebuilt backend

The staging proxy credential flagged in #23 and #24 has been rotated.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
