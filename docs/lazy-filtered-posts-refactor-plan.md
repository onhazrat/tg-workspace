# Make `filteredPosts` lazy — refactor plan

**Date:** 2026-07-22
**Status:** Not started. Prerequisites (server-side Discover + counts) are done —
see PR #10 / branch `phase4-server-side-discover`.

> Written to be executed by an agent with **no context except this file** plus
> `docs/architecture-remediation-plan.md` (the parent plan) and
> `docs/e2e-playwright-guide.md` (how to run the e2e suite). Read all three
> before starting.

---

## 1. Why this exists

The app began as a browser-only app and still behaves like one in one important
way: `frontend/src/contexts/ScraperContext.tsx` eagerly fetches **every** post
for the selected channels and date range into a `filteredPosts` array, via:

```ts
// ScraperContext.tsx (~line 670)
useEffect(() => {
  handleFilterPosts()
}, [handleFilterPosts])
```

`handleFilterPosts` (ScraperContext ~line 300) calls
`getPostsByDateRange(selectedNames, startDate, endDate)` which **pages to
exhaustion** (`repository.ts`, up to `MAX_POST_PAGES * POST_PAGE_SIZE` posts),
then runs `buildFilteredPostsFromRaw`. This runs on **every** scope/filter
change regardless of the active tab.

The staging load **incident is already fixed** (each request is bounded; see
`docs/discover-bulk-follow-load-investigation.md` §Re-measurement). What remains
is a *client-side* inefficiency: the browser still downloads the whole scope's
posts even when nothing on screen needs them. Server-side Discover and counts
(PR #10) removed two consumers of `filteredPosts` but the eager fetch still
happens for the rest. **This plan removes the eager fetch.**

**Acceptance:** navigating to Discover, or changing channel selection while on
the Channels tab, must not trigger a full posts download. A summary/chat/tag
run must still see exactly the posts it would have before (no behaviour change).

---

## 2. Every consumer of `filteredPosts` (the whole surface)

Run `grep -rn filteredPosts frontend/src` to confirm before starting; as of
2026-07-22:

| Consumer | File | What it needs | Lazy strategy |
|---|---|---|---|
| **Summary** | `contexts/AIContext.tsx:168,323` (`postsToSummarize`, `formatPostsForPrompt`) | the full filtered post set at **summary time** | fetch on demand when the user runs a summary |
| **completePendingSummary** | `contexts/AIContext.tsx` (~387) | ~10-20 cited post IDs only | already should use `POST /data/posts/lookup` (T2.2) — see parent plan T5.1 special case |
| **Chat** | `contexts/ChatContext.tsx:188` (`postsToChat`) | full filtered set at **chat time** | fetch on demand when the user sends a chat turn |
| **Tag** | `contexts/TagContext.tsx:150` (`formatPostsForTagPrompt`) | full filtered set at **tag time** | fetch on demand when the user runs tagging |
| **Posts feed display** | `components/PostFeed.tsx:114` (`filteredPosts.slice(0, visiblePosts)`) | posts to render, already windowed to `visiblePosts` (~20) | paginate the fetch: load pages as the feed scrolls, not all upfront |
| **Discover** | `components/DiscoverView.tsx` | — | ✅ already server-side (PR #10) |
| **Channel grid counts** | `components/ChannelGrid.tsx` | — | ✅ already server-side (PR #10) |
| **Trim command** | `lib/commands/extended-commands.ts:198` (`buildPostsInScopeCounts`) | per-channel counts | use `GET /data/posts/counts` (T4.2) or the counts already loaded by ChannelGrid |
| **Entity picker** | `lib/commands/entity-candidates.ts:19` (`.slice(0,100)`) | first 100 posts for suggestions | fetch one bounded page (`limit=100`) on demand |
| **Command ctx plumbing** | `hooks/useCommandRegistry.ts:232,254`, `lib/commands/types.ts:186` | passes `filteredPosts` through | replace with an on-demand fetch fn in the command context |

**Key observation:** only PostFeed genuinely needs posts *while a view is open*.
Everything else (AI/Chat/Tag/entity/trim) needs them *at the moment an action
fires*. That is what makes laziness possible.

---

## 3. Design

Introduce an **on-demand fetch** that returns the scoped, filtered posts to a
caller, instead of a `filteredPosts` array that is eagerly populated and read
from context.

### 3.1 A `getScopedPosts()` function on ScraperContext

Add a function (not state) that performs today's `handleFilterPosts` body and
**returns** the posts:

```ts
// returns the same array buildFilteredPostsFromRaw would have produced,
// fetched on demand — no state write, no eager effect.
const getScopedPosts = useCallback(async (): Promise<Post[]> => { ... }, [deps])
```

- It must honour the same branches `handleFilterPosts` has today:
  `relatedPostSearch`, `semanticQuery` (both already bounded at 50), else the
  filtered/paged path. Keep those semantics **exactly** — they are parity-
  sensitive (see parent plan T5.1: byte-identical prompt output is the bar).
- AI/Chat/Tag call `await getScopedPosts()` at action time.

### 3.2 PostFeed paginates

PostFeed should fetch a bounded first page and load more on scroll (there is
already a `useScrollLoadMore` hook and a `visiblePosts` window). Use
`getPostsByDateRange(..., { limit })` with growing offset, or a dedicated
paginated hook. It must **not** page to exhaustion on mount.

### 3.3 Remove the eager effect

Once every consumer has an on-demand or paginated path, delete the
`useEffect(() => { handleFilterPosts() }, [handleFilterPosts])` and the
`filteredPosts` state. Anything still reading `filteredPosts` from context is a
missed consumer — grep must come back empty (except tests you update).

---

## 4. Sequenced increments (each independently shippable + verifiable)

Do these in order; each is a commit/PR on its own and leaves the app working.

1. **`getScopedPosts()` alongside the existing `filteredPosts`.** Add the
   function; do not remove anything yet. No behaviour change. Unit-test it
   returns the same set as the current eager path for the same inputs.
2. **Migrate AIContext (summary + chat-adjacent) to `getScopedPosts()`.** The
   summary path builds its prompt from the returned posts. Switch
   `completePendingSummary` to `POST /data/posts/lookup` (it only needs cited
   IDs). Verify a real summary is byte-identical (parent plan T5.1 parity bar):
   snapshot `formatPostsForPrompt` output before/after for a fixed fixture.
3. **Migrate ChatContext** to `getScopedPosts()` at send-turn time.
4. **Migrate TagContext** to `getScopedPosts()` at tag-run time.
5. **Migrate the command paths** (`entity-candidates` → one `limit=100` fetch;
   `extended-commands` trim → `/data/posts/counts`; drop `filteredPosts` from
   the command context type).
6. **Paginate PostFeed** so the Posts tab fetches incrementally.
7. **Remove the eager effect + `filteredPosts` state.** Grep must be clean.
   This is the commit that actually stops the over-fetch.

**Do not** collapse these into one PR — step 7 is only safe once 1-6 land.

---

## 5. Interaction with the deferred T5.1

Parent plan **T5.1 (server-side prompt assembly) is deferred.** This refactor
is deliberately *narrower*: it fetches the same posts on demand and keeps
**client-side** prompt building (`formatPostsForPrompt` /
`formatPostsForTagPrompt`) unchanged. That preserves byte-identical output
while removing the eager fetch. When T5.1 is eventually done, these on-demand
fetches become server-side prompt calls and the post arrays stop crossing the
wire at all. Keep the two changes separate: **do not** start assembling prompts
server-side as part of this refactor.

---

## 6. Verification per increment

- Backend (unchanged here, but if touched): `cd backend && uv run pytest tests/ -q`.
- Frontend unit + types + lint:
  `cd frontend && bun test src && bunx tsc -p tsconfig.build.json --noEmit && bun run lint && bun run test:tg-ui`.
- E2E: **follow `docs/e2e-playwright-guide.md` exactly** (run from `frontend/`,
  `PLAYWRIGHT_CHANNEL=chrome`, and if any unmocked endpoint is hit, the :8000
  backend must run your branch's code). `bunx playwright test tests/summarizer.spec.ts`.
- Manual: open Discover with channels selected — confirm in the network tab
  there is **no** `/data/posts` page burst. Run a summary, a chat turn, and a
  tag run — confirm each still produces coherent output and the same citations.

---

## 7. Traps (learned the hard way)

- **`getScopedPosts` must keep the semantic/related branches bounded at 50** —
  do not accidentally route them through the paged path.
- **Prompt parity is the acceptance bar.** Snapshot before changing AIContext.
- **The e2e suite runs `workers: 1`** (shared backend; see the guide). Do not
  re-parallelise it.
- **Grep is the definition of done for step 7** — a lingering `filteredPosts`
  read means a consumer was missed and the eager fetch can't be removed safely.
