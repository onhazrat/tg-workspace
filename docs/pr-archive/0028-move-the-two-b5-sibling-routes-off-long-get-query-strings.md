# #28 🔧 Move the two B5 sibling routes off long GET query strings

**State:** merged 2026-07-27 · **Branch:** `fix/post-scope-sibling-routes` into `main` · **Diff:** +1016 / -447 across 15 files · **Opened:** 2026-07-27

---

B5 fixed `/data/posts/counts` only. `GET /data/posts` and `GET /data/discover/candidates` built the identical `?channelNames=a,b,c,...` string from the same selection and would have failed the same way. `/posts` is the hot Posts-feed path, so of the three it is the one a real account hits first.

Both are POST now.

## What changed

Two body models extend `PostScopeRequest` rather than restating it:

| Model | Adds |
|---|---|
| `PostFeedRequest` | `channelName`, `limit`, `offset`, `maxPerChannelMode`, `sort`, `seed` |
| `DiscoverCandidatesRequest` | `signals`, with `channelNames` re-declared as **required** to preserve the query param's contract |

The `limit`/`offset` bounds move onto the model, so an out-of-range page is still a 422 rather than an unbounded read.

**`postScopeParams` is deleted, not left unused.** It was the query-string builder this change exists to remove; leaving it in place would hand the next caller a working way to reintroduce the bug. Same reasoning as `stringSetting` in Batch 1.

## Why this shipped three times, and what now stops a fourth

Each endpoint built the string independently, and each works perfectly against the handful of channels a dev environment holds. The failure only appears at the ~1,070 a real account has, where the string reaches roughly 13 KB — past the request-line limits proxies and servers enforce. Nothing in types, lint, or review distinguishes the two cases.

So the guard is a **source sweep**, not another endpoint test. `api/post-scope-transport.test.ts` fails if any module under `src/api/` puts a channel selection into a URL, in any shape it can take (`qs.set`/`append`, or interpolated into a template URL), and separately asserts all three endpoints are still POSTed.

Verified by reintroducing the defect: it fails and names the exact line.

Comments are exempt — the docblock explaining the bad shape quotes it verbatim — and that exemption has its own test proving it does not also blind the sweep to real code.

## Notes from doing it

- **The full backend suite caught four call sites I had missed**, in `test_data.py` and `test_sync_jobs.py`. A grep for `data/posts` missed them because they build the URL from a `DATA` prefix constant. Converting a route means finding every caller, not just the ones in the module being edited.
- Two e2e mocks were updated rather than worked around: one gated on `method() !== "GET"`, the other read `media` from `searchParams`. Both now match on the path and read the request body.

This is a breaking API change, but the frontend is the only consumer and the committed client is regenerated in the same commit.

## Verification

- Backend **524 passed** (was 514) — including `test_post_scope_body.py`, which sends a 1,200-handle selection whose query-string equivalent exceeds 10 KB, and asserts both routes now answer a GET with **405** so the old shape cannot quietly return
- Frontend **591 unit tests** (was 585), biome clean, `tsc --noEmit` clean
- **62/62 e2e**, against a backend rebuilt for the route change and verified to be serving POST before the run

🤖 Generated with [Claude Code](https://claude.com/claude-code)
