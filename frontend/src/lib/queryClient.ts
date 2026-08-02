import { QueryClient } from "@tanstack/react-query"

/**
 * The app's single `QueryClient`, importable outside React.
 *
 * ## Why this is not just `main.tsx`'s local
 *
 * A3 replaces `repository.ts`'s etag staleness with react-query invalidation.
 * That works for components, which have `useQueryClient()` — but a large share
 * of the writers are **not React and cannot be**: `services/telegram.ts`,
 * `services/ai.ts`, `lib/network/tor-actions.ts`, `lib/channels/add-channel.ts`
 * and `lib/channels/refresh-metadata.ts` all write logs from plain async
 * functions called out of event handlers and services.
 *
 * Without a reachable client, those writes would land on the server and stay
 * invisible for up to `SUMMARIZER_STALE_TIME`, because nothing would mark the
 * cached list stale. The old code got this for free — `apiWrite` refreshed the
 * sync-meta etag, and the next read compared etags and refetched. `staleTime`
 * does *not* substitute for that: it governs when a refetch is **allowed**, not
 * when one is **needed**.
 *
 * ## On it being a module singleton
 *
 * Tests that need isolation construct their own `QueryClient` and pass it
 * through `QueryClientProvider`, as the existing context and hook tests already
 * do — they never observe this one. It exists for the non-React writers, which
 * have nowhere else to get a client from.
 */
export const queryClient = new QueryClient()
