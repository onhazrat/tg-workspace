import { api } from "@/api"
import type { Channel, ChannelStats } from "@/types"

/**
 * The slice of `api` this module uses, injectable as a **test seam**.
 *
 * `src/lib/repository.posts.test.ts` calls `mock.module("@/api", …)`, and Bun's
 * module mocks are process-wide rather than file-scoped — so a test that mocked
 * or spied on `@/api` here would collide with that one as soon as the whole
 * suite runs in a single process, and pass alone while failing in the suite.
 * Injection is the pattern this repo settled on for exactly that (see
 * `LogPoster` in `lib/logs/write.ts`, `fetchPage` in `data-transfer/entities/post.ts`).
 * Production callers never pass it.
 */
export type ChannelsApi = Pick<
  typeof api,
  | "listChannels"
  | "upsertChannel"
  | "deleteChannel"
  | "getChannelStats"
  | "listChannelStats"
  | "bulkUpdateChannelTags"
>

/**
 * Reads and writes for the `Channel` aggregate.
 *
 * ## Why these do NOT invalidate the channels query
 *
 * A3.1 replaced the logs family's etag staleness with explicit invalidation.
 * **Channels are the opposite case, and copying that pattern here would be a
 * regression.**
 *
 * `repository.ts` called `markResourceSynced("channels")` after every channel
 * write, which stored the *new* etag locally so the next staleness check
 * returned `false`. A channel write deliberately **suppressed** the refetch,
 * because seventeen call sites have already applied the change optimistically
 * through `setChannelsInCache`/`setChannelStatsInCache` in `hooks/useChannels`.
 *
 * Invalidating here would refetch the whole list on every edit, and once per
 * channel during bulk follow. At the ~1,070 channels a real account holds that
 * is the load shape `docs/discover-bulk-follow-load-investigation.md` already
 * had to root-cause once.
 *
 * A **data import** is the one write that is not optimistic — it replaces rows
 * wholesale. It does not invalidate either: it re-reads with `listChannels()`
 * and writes the result through `ctx.setChannels`, which is authoritative and
 * costs the same one request an invalidation would have triggered.
 *
 * ## No IndexedDB anywhere
 *
 * These used to read a browser mirror when the etag said "fresh" or the request
 * failed, and write it back on every list. A3 removed the read, A4 removed the
 * write and the mirror itself. PostgreSQL is the only store.
 */

/**
 * The channel list the grid paints from — **without** stats.
 *
 * Stats used to ride along on `includeStats=true`, one round trip for both. The
 * round trip was never the problem: the two aggregate queries behind the stats
 * cost 2.36s of a 3.13s response while contributing 46KB of a 536KB payload, so
 * the grid blocked its first paint on them. Only `activity_rate` and
 * `total_posts` — two of eleven sort options, and not the default — read them at
 * all.
 *
 * They are still one batch, just a second one: see `listChannelStats`. The N+1
 * that `includeStats` existed to avoid is still avoided.
 */
export async function listChannels(
  client: ChannelsApi = api,
): Promise<Channel[]> {
  const rows = await client.listChannels()
  // The server no longer emits `stats` here, but a client running against an
  // older build would; strip it rather than letting it ride along on Channel.
  return rows.map(({ stats: _stats, ...channel }) => channel)
}

/** Every channel's stats, keyed by channel name. */
export async function listChannelStats(
  client: ChannelsApi = api,
): Promise<Record<string, ChannelStats>> {
  return client.listChannelStats()
}

export async function upsertChannel(
  channel: Channel,
  client: ChannelsApi = api,
): Promise<Channel> {
  return client.upsertChannel(channel.id, channel)
}

export async function deleteChannel(
  id: string,
  client: ChannelsApi = api,
): Promise<void> {
  await client.deleteChannel(id)
}

export async function bulkUpdateChannelTags(
  updates: { channelId: string; tags: Channel["tags"] }[],
  client: ChannelsApi = api,
): Promise<{ updated: number; channels: Channel[] }> {
  return client.bulkUpdateChannelTags({ updates })
}

/**
 * Stats for one channel.
 *
 * Returns `null` rather than throwing: both callers (`useSyncJob`,
 * `useFollowJob`) ask for these to refresh a card after a sync, and a failure
 * there must not fail the sync that just succeeded. `repository` got this same
 * shape by falling back to the mirror and returning whatever it held.
 */
export async function getChannelStats(
  channelId: string,
  client: ChannelsApi = api,
): Promise<ChannelStats | null> {
  try {
    return await client.getChannelStats(channelId)
  } catch {
    return null
  }
}
