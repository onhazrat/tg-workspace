import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import type { Channel, ChannelStats } from "@/types"
import {
  bulkUpdateChannelTags,
  type ChannelsApi,
  deleteChannel,
  getChannelStats,
  listChannelStats,
  listChannels,
  upsertChannel,
} from "./store"

/**
 * The channels family's contract after A3.2.
 *
 * The load-bearing assertion here is a **negative** one: a channel write must
 * not invalidate `queryKeys.channels`. `repository.ts` expressed that by
 * calling `markResourceSynced("channels")` after every write, which stored the
 * new etag so the next staleness check answered "fresh". Seventeen call sites
 * already apply their change optimistically through `setChannelsInCache`, so an
 * invalidation here would refetch the whole list on every edit and once per
 * channel during bulk follow — at ~1,070 channels, the load shape
 * `docs/discover-bulk-follow-load-investigation.md` had to root-cause once.
 *
 * A3.1 did the opposite for logs, on purpose. Anyone generalising that pattern
 * across the remaining families should fail these.
 */

const channel = (name: string): Channel =>
  ({ id: `id-${name}`, name, startTime: 0 }) as Channel

const stats = (posts: number): ChannelStats =>
  ({ totalPosts: posts }) as ChannelStats

let listed: Array<Record<string, unknown> | undefined> = []
let statsListed = 0
let upserted: Array<[string, unknown]> = []
let deleted: string[] = []
let statsFail = false

/**
 * Injected rather than `mock.module("@/api", …)`: Bun's module mocks are
 * process-wide, and `lib/repository.posts.test.ts` already mocks that module —
 * so mocking it here would pass alone and collide once the suite runs in one
 * process. See `ChannelsApi` in `store.ts`.
 */
const fakeApi = {
  listChannels: async () => {
    listed.push(undefined)
    return [{ ...channel("alpha"), stats: stats(3) }, { ...channel("beta") }]
  },
  upsertChannel: async (id: string, body: Partial<Channel>) => {
    upserted.push([id, body])
    return body as Channel
  },
  deleteChannel: async (id: string) => {
    deleted.push(id)
    return { status: "deleted" }
  },
  getChannelStats: async (id: string) => {
    if (statsFail) throw new Error(`no stats for ${id}`)
    return stats(7)
  },
  listChannelStats: async () => {
    statsListed += 1
    return { alpha: stats(3) }
  },
  bulkUpdateChannelTags: async (_body: {
    updates: { channelId: string; tags: Channel["tags"] }[]
  }) => ({ updated: 1, channels: [channel("alpha")] }),
} as unknown as ChannelsApi

function seedFresh() {
  queryClient.setQueryData(queryKeys.channels, [])
}

function isStale(): boolean {
  return (
    queryClient
      .getQueryCache()
      .find({ queryKey: queryKeys.channels })
      ?.isStale() ?? true
  )
}

beforeEach(() => {
  listed = []
  statsListed = 0
  upserted = []
  deleted = []
  statsFail = false
  queryClient.clear()
})

afterEach(() => {
  queryClient.clear()
})

describe("listChannels / listChannelStats", () => {
  it("does not ask for stats on the list request", async () => {
    await listChannels(fakeApi)

    // `includeStats=true` cost 2.36s of a 3.13s response for 46KB of a 536KB
    // payload, and blocked the grid's first paint on it. Stats are their own
    // request now.
    expect(listed).toEqual([undefined])
  })

  it("never lets a stats block ride along on a Channel", async () => {
    // An older server still emits one; it must not reach the Channel type.
    const channels = await listChannels(fakeApi)

    expect(channels.map((c) => c.name)).toEqual(["alpha", "beta"])
    expect("stats" in channels[0]).toBe(false)
  })

  it("fetches stats as one batch keyed by channel name", async () => {
    // Still one request for all of them — the N+1 `includeStats` existed to
    // avoid is still avoided, just on its own call.
    expect(await listChannelStats(fakeApi)).toEqual({ alpha: stats(3) })
    expect(statsListed).toBe(1)
  })

  it("goes to the server every time — there is no cache fall-through", async () => {
    await listChannels(fakeApi)
    await listChannels(fakeApi)

    expect(listed).toHaveLength(2)
  })
})

describe("writes do NOT invalidate the channels query", () => {
  it("upsertChannel leaves the cached list fresh", async () => {
    seedFresh()
    expect(isStale()).toBe(false)

    await upsertChannel(channel("alpha"), fakeApi)

    expect(upserted).toEqual([["id-alpha", channel("alpha")]])
    expect(isStale()).toBe(false)
  })

  it("deleteChannel leaves the cached list fresh", async () => {
    seedFresh()

    await deleteChannel("id-alpha", fakeApi)

    expect(deleted).toEqual(["id-alpha"])
    expect(isStale()).toBe(false)
  })

  it("bulkUpdateChannelTags leaves the cached list fresh", async () => {
    seedFresh()

    await bulkUpdateChannelTags([{ channelId: "id-alpha", tags: [] }], fakeApi)

    expect(isStale()).toBe(false)
  })

  it("a write does not refetch the list either", async () => {
    seedFresh()

    await upsertChannel(channel("alpha"), fakeApi)
    await deleteChannel("id-beta", fakeApi)

    expect(listed).toEqual([])
  })
})

describe("getChannelStats", () => {
  it("returns the stats row", async () => {
    expect(await getChannelStats("id-alpha", fakeApi)).toEqual(stats(7))
  })

  it("returns null instead of throwing when the request fails", async () => {
    statsFail = true

    // Both callers refresh a card after a sync that already succeeded; a
    // failure here must not fail that sync.
    expect(await getChannelStats("id-alpha", fakeApi)).toBeNull()
  })
})
