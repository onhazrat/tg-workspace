import { api } from "@/api"
import { hydrateChannelMirror } from "@/lib/channels/mirror-hydration"
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
 * ## Why there is no IndexedDB fall-through
 *
 * These used to read the mirror when the etag said "fresh", or when the request
 * failed. Serving a channel list from the browser mirror is what ADR-009
 * retires. The mirror is still *written* (see below), which is a separate
 * concern that goes with A4.
 */

/**
 * Channels plus their per-channel stats, in one round trip.
 *
 * `includeStats` exists to avoid the N+1 this otherwise becomes: the Channels
 * tab needs a stats row per channel, and fetching them individually is ~1,070
 * requests.
 */
export async function listChannelsWithStats(
  client: ChannelsApi = api,
): Promise<{
  channels: Channel[]
  stats: Record<string, ChannelStats>
}> {
  const rows = await client.listChannels({ includeStats: true })

  const channels: Channel[] = []
  const stats: Record<string, ChannelStats> = {}
  for (const row of rows) {
    const { stats: channelStats, ...channel } = row
    channels.push(channel)
    if (channelStats) stats[channel.name] = channelStats
  }

  /**
   * Fire-and-forget, deliberately.
   *
   * This used to `await cache.saveChannel(...)` per channel inside the loop —
   * one IndexedDB transaction each, serially, in front of the data the Channels
   * tab needs, which is what produced the long skeleton phase at ~1,070
   * channels. `hydrateChannelMirror` batches it into one transaction and never
   * rejects, so `void` here cannot produce an unhandled rejection.
   *
   * The mirror is now **write-only** as far as channels are concerned: nothing
   * reads it back except `repository.checkNeedsMigration`, which asks "is there
   * local data the server does not have?". A4 deletes both together — dropping
   * the write here first would make that check silently answer "no".
   */
  void hydrateChannelMirror(channels)

  return { channels, stats }
}

export async function listChannels(
  client: ChannelsApi = api,
): Promise<Channel[]> {
  const { channels } = await listChannelsWithStats(client)
  return channels
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
