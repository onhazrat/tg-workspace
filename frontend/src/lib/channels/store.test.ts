import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { queryKeys } from "@/hooks/queryKeys"
import { queryClient } from "@/lib/queryClient"
import type { Channel, ChannelStats } from "@/types"
import {
  bulkUpdateChannelTags,
  type ChannelsApi,
  deleteChannel,
  getChannelStats,
  listChannels,
  listChannelsWithStats,
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
  listChannels: async (params?: { includeStats?: boolean }) => {
    listed.push(params)
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
  bulkUpdateChannelTags: async (_body: {
    updates: { channelId: string; tags: Channel["tags"] }[]
  }) => ({ updated: 1, channels: [channel("alpha")] }),
} as unknown as ChannelsApi

function seedFresh() {
  queryClient.setQueryData(queryKeys.channels, {
    channels: [],
    channelStats: {},
  })
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
  upserted = []
  deleted = []
  statsFail = false
  queryClient.clear()
})

afterEach(() => {
  queryClient.clear()
})

describe("listChannelsWithStats", () => {
  it("asks for stats in the same request", async () => {
    await listChannelsWithStats(fakeApi)

    // Without `includeStats` the Channels tab needs one stats request per
    // channel — ~1,070 of them.
    expect(listed).toEqual([{ includeStats: true }])
  })

  it("splits stats out of the rows and keys them by channel name", async () => {
    const { channels, stats: byName } = await listChannelsWithStats(fakeApi)

    expect(channels.map((c) => c.name)).toEqual(["alpha", "beta"])
    expect(byName).toEqual({ alpha: stats(3) })
    // The `stats` key must not survive on the channel itself.
    expect("stats" in channels[0]).toBe(false)
  })

  it("goes to the server every time — there is no cache fall-through", async () => {
    await listChannelsWithStats(fakeApi)
    await listChannelsWithStats(fakeApi)

    expect(listed).toHaveLength(2)
  })

  it("listChannels drops the stats half", async () => {
    expect((await listChannels(fakeApi)).map((c) => c.name)).toEqual([
      "alpha",
      "beta",
    ])
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
