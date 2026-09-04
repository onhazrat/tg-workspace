# #10 Server-side Discover + scope counts (step 2 + T4.1 + T4.2)

**State:** merged 2026-07-22 · **Branch:** `phase4-server-side-discover` into `main` · **Diff:** +1668 / -25 across 20 files · **Opened:** 2026-07-22

---

Moves Discover candidate aggregation and per-channel scope counts off the browser and into SQL, per `docs/architecture-remediation-plan.md`. The load incident is already fixed (PR #9); this is efficiency + architecture groundwork.

## What's here

**Backend (`72fe628`)**
- `post_filters.py` — ports the Posts-tab view filters (keyword / forwarded / media) into SQL `WHERE` predicates. `media` is a JSON column and `media_only` folds a JSON flag + a sentinel text + a regex, so this is the parity-risky part; `test_post_filters.py` pins all of it (8 cases).
- `GET /data/discover/candidates` gains `keyword`/`forwarded`/`media`/`maxPerChannel` params and a latest-per-channel cap applied while streaming (ordered by channel+timestamp, served by the existing composite index). Returns a new `postsInScope` total so the client can resolve the empty-state reason faithfully.
- **New `GET /data/posts/counts`** (T4.2) — per-channel counts as a SQL `GROUP BY`, cap clamped with `LEAST` (mode-independent, so counts need no client fallback).

**Frontend (`657752a`)**
- Hand-written `getDiscoverCandidates` / `getPostsCounts` wrappers (ADR-006) sharing a `PostScopeQuery` builder; query hooks.
- `DiscoverView` uses the server unless a semantic query or `random` cap is active; `ChannelGrid` uses server counts unless a semantic query is active. `deriveDiscoveryEmptyReason` keeps the server path's empty-state precedence identical to `computeDiscoveryCandidates`, with a parity test.
- `summarizer.spec.ts` mocks `/discover/candidates` + `/posts/counts` (built from the same fixtures) since Discover no longer aggregates the mocked `/posts` client-side.

## Decisions (confirmed with the maintainer)

- Discover **preserves current behavior** — respects the active keyword/forwarded/media/cap filters, not just channel+date.
- Semantic search keeps the **client path** (already server-side + capped at 50; no over-fetch to remove).
- `random` cap stays **browser-side** (seeded PRNG); the server does `latest` + filtering. No mulberry32 port.

## Honest scope note

This moves the **computation** server-side but does **not yet** reduce posts shipped to the browser: `ScraperContext` still fetches `filteredPosts` eagerly for other consumers (AIContext, ChatContext, TagContext, PostFeed). Making that fetch lazy is the agreed follow-on and the actual byte-savings win. This PR is the necessary groundwork.

## Verification

- Backend: **494 tests** (39 new), mypy + ty + ruff clean.
- Frontend: `bunx tsc` + **466 unit tests** + biome clean.
- E2E: **51/51** `summarizer.spec.ts` against a backend rebuilt from this branch (workers=1). CI is billing-blocked on this repo, so local runs are the gate.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
