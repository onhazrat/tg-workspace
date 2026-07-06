import { describe, expect, test } from "bun:test"

import { computeForwardSourceDiscovery } from "@/lib/posts/discover-forward-sources"
import type { Channel, Post } from "@/types"

function makePost(
  overrides: Partial<Post> & Pick<Post, "id" | "channelName" | "timestamp">,
): Post {
  const { id, channelName, timestamp, ...rest } = overrides
  return {
    id,
    channelName,
    text: rest.text ?? `Post ${id}`,
    date: new Date(timestamp).toISOString(),
    timestamp,
    ...rest,
  }
}

const followedChannels: Channel[] = [
  { id: "1", name: "known" },
  { id: "2", name: "sourceA" },
]

describe("computeForwardSourceDiscovery", () => {
  test("original_only returns no candidates", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "sourceA",
        timestamp: 1000,
        forwardedFrom: "newchan",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, followedChannels, {
      forwardedFilter: "original",
      selectedChannelCount: 1,
    })

    expect(result.candidates).toEqual([])
    expect(result.emptyReason).toBe("original_only")
  })

  test("all includes followed and unfollowed sources with full stats", () => {
    const posts = [
      ...Array.from({ length: 20 }, (_, index) =>
        makePost({
          id: index + 1,
          channelName: "sourceA",
          timestamp: 1000 + index,
          forwardedFrom: "known",
          forwardedFromName: "Known Channel",
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        makePost({
          id: 100 + index,
          channelName: "sourceB",
          timestamp: 2000 + index,
          forwardedFrom: "newchan",
          forwardedFromName: "New Channel",
        }),
      ),
    ]

    const result = computeForwardSourceDiscovery(posts, followedChannels, {
      forwardedFilter: "all",
      selectedChannelCount: 2,
    })

    expect(result.emptyReason).toBeUndefined()
    expect(result.candidates).toHaveLength(2)

    const known = result.candidates.find((c) => c.name === "known")
    const fresh = result.candidates.find((c) => c.name === "newchan")

    expect(known?.postCount).toBe(20)
    expect(known?.isFollowed).toBe(true)
    expect(fresh?.postCount).toBe(10)
    expect(fresh?.isFollowed).toBe(false)
  })

  test("forwarded includes followed and unfollowed sources", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "sourceA",
        timestamp: 1000,
        forwardedFrom: "known",
      }),
      makePost({
        id: 2,
        channelName: "sourceB",
        timestamp: 2000,
        forwardedFrom: "newchan",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, followedChannels, {
      forwardedFilter: "forwarded",
      selectedChannelCount: 2,
    })

    expect(result.candidates).toHaveLength(2)
    expect(result.candidates.map((c) => c.name).sort()).toEqual([
      "known",
      "newchan",
    ])
  })

  test("unfollowed_forwarded only returns unfollowed sources", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "sourceA",
        timestamp: 1000,
        forwardedFrom: "known",
      }),
      makePost({
        id: 2,
        channelName: "sourceB",
        timestamp: 2000,
        forwardedFrom: "newchan",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, followedChannels, {
      forwardedFilter: "unfollowed_forwarded",
      selectedChannelCount: 2,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.name).toBe("newchan")
    expect(result.candidates[0]?.isFollowed).toBe(false)
  })

  test("aggregates forwardedBy breakdown and counts", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "alpha",
        timestamp: 1000,
        forwardedFrom: "target",
      }),
      makePost({
        id: 2,
        channelName: "alpha",
        timestamp: 1100,
        forwardedFrom: "target",
      }),
      makePost({
        id: 3,
        channelName: "beta",
        timestamp: 1200,
        forwardedFrom: "target",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, [], {
      forwardedFilter: "forwarded",
      selectedChannelCount: 2,
    })

    expect(result.candidates).toHaveLength(1)
    const row = result.candidates[0]
    expect(row?.postCount).toBe(3)
    expect(row?.forwardedByCount).toBe(2)
    expect(row?.forwardedBy).toEqual([
      { channelName: "alpha", count: 2 },
      { channelName: "beta", count: 1 },
    ])
    expect(row?.lastSeen).toBe(1200)
    expect(row?.samplePost).toEqual({
      channelName: "beta",
      postId: 3,
      timestamp: 1200,
    })
  })

  test("deduplicates handles case-insensitively", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "alpha",
        timestamp: 1000,
        forwardedFrom: "Target",
      }),
      makePost({
        id: 2,
        channelName: "beta",
        timestamp: 2000,
        forwardedFrom: "@target",
        forwardedFromName: "Target Display",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, [], {
      forwardedFilter: "forwarded",
      selectedChannelCount: 2,
    })

    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0]?.postCount).toBe(2)
    expect(result.candidates[0]?.displayName).toBe("Target Display")
  })

  test("isFollowed reflects channel list membership", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "alpha",
        timestamp: 1000,
        forwardedFrom: "Known",
      }),
      makePost({
        id: 2,
        channelName: "alpha",
        timestamp: 2000,
        forwardedFrom: "fresh",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, followedChannels, {
      forwardedFilter: "all",
      selectedChannelCount: 1,
    })

    const known = result.candidates.find(
      (c) => c.name.toLowerCase() === "known",
    )
    const fresh = result.candidates.find((c) => c.name === "fresh")

    expect(known?.isFollowed).toBe(true)
    expect(fresh?.isFollowed).toBe(false)
  })

  test("no_unfollowed_sources when every forward source is already followed", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "sourceA",
        timestamp: 1000,
        forwardedFrom: "known",
      }),
    ]

    const scopedPosts = posts.filter(
      (post) =>
        post.forwardedFrom &&
        !followedChannels.some(
          (channel) =>
            channel.name.toLowerCase() === post.forwardedFrom?.toLowerCase(),
        ),
    )

    const result = computeForwardSourceDiscovery(
      scopedPosts,
      followedChannels,
      {
        forwardedFilter: "unfollowed_forwarded",
        selectedChannelCount: 1,
      },
    )

    expect(result.candidates).toEqual([])
    expect(result.emptyReason).toBe("no_unfollowed_sources")
  })

  test("sorts by forwardedByCount then postCount then lastSeen", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "a",
        timestamp: 100,
        forwardedFrom: "low",
      }),
      makePost({
        id: 2,
        channelName: "b",
        timestamp: 500,
        forwardedFrom: "high",
      }),
      makePost({
        id: 3,
        channelName: "c",
        timestamp: 400,
        forwardedFrom: "high",
      }),
      makePost({
        id: 4,
        channelName: "d",
        timestamp: 300,
        forwardedFrom: "mid",
      }),
      makePost({
        id: 5,
        channelName: "e",
        timestamp: 200,
        forwardedFrom: "mid",
      }),
    ]

    const result = computeForwardSourceDiscovery(posts, [], {
      forwardedFilter: "forwarded",
      selectedChannelCount: 5,
    })

    expect(result.candidates.map((c) => c.name)).toEqual(["high", "mid", "low"])
  })
})
