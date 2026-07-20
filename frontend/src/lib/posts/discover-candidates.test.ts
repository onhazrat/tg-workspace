import { describe, expect, test } from "bun:test"

import {
  computeDiscoveryCandidates,
  countPostsBySignal,
  type DiscoveryCandidate,
  type DiscoverySignalKind,
  filterDiscoveryCandidates,
  sortDiscoveryCandidates,
} from "@/lib/posts/discover-candidates"
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
] as Channel[]

const ALL_KINDS = new Set<DiscoverySignalKind>(["forward", "mention", "link"])
const FORWARD_ONLY = new Set<DiscoverySignalKind>(["forward"])

function ctx(
  overrides: Partial<Parameters<typeof computeDiscoveryCandidates>[2]> = {},
) {
  return {
    forwardedFilter: "all" as const,
    selectedChannelCount: 2,
    enabledKinds: ALL_KINDS,
    ...overrides,
  }
}

describe("computeDiscoveryCandidates — signal kinds", () => {
  test("counts forwards, mentions, and links separately", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        forwardedFrom: "alpha_news",
        forwardedFromName: "Alpha News",
      }),
      makePost({
        id: 2,
        channelName: "carrier",
        timestamp: 1100,
        text: "shoutout to @alpha_news",
      }),
      makePost({
        id: 3,
        channelName: "carrier",
        timestamp: 1200,
        text: "join https://t.me/alpha_news",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.counts).toEqual({ forward: 1, mention: 1, link: 1 })
    expect(candidates[0]?.total).toBe(3)
    expect(candidates[0]?.displayName).toBe("Alpha News")
  })

  test("a mention and a link in the same post each count once", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "@alpha_news is great, join https://t.me/alpha_news now",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates[0]?.counts).toEqual({ forward: 0, mention: 1, link: 1 })
  })

  test("a repeated mention in one post counts once", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "@alpha_news @alpha_news @alpha_news",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates[0]?.counts.mention).toBe(1)
  })

  test("a link present in both text and post.links counts once", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "join https://t.me/alpha_news",
        links: [{ url: "https://t.me/alpha_news", channel: "alpha_news" }],
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates[0]?.counts.link).toBe(1)
  })

  test("masked links from post.links are discovered", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "Click here to join",
        links: [{ url: "https://t.me/hidden_chan", channel: "hidden_chan" }],
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates.map((c) => c.name)).toEqual(["hidden_chan"])
    expect(candidates[0]?.counts.link).toBe(1)
  })

  test("disabled kinds are not counted", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        forwardedFrom: "alpha_news",
      }),
      makePost({
        id: 2,
        channelName: "carrier",
        timestamp: 1100,
        text: "@beta_wire only mentioned",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1, enabledKinds: FORWARD_ONLY }),
    )

    expect(candidates.map((c) => c.name)).toEqual(["alpha_news"])
  })
})

describe("computeDiscoveryCandidates — scope counts", () => {
  test("scope counts cover all kinds even when signals are disabled", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        forwardedFrom: "alpha_news",
      }),
      makePost({
        id: 2,
        channelName: "carrier",
        timestamp: 1100,
        text: "@beta_wire and https://t.me/gamma_feed",
      }),
    ]

    const result = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1, enabledKinds: FORWARD_ONLY }),
    )

    // Only the forward candidate is listed…
    expect(result.candidates.map((c) => c.name)).toEqual(["alpha_news"])
    // …but the scope summary still reports the mention and link posts.
    expect(result.scopeCounts).toEqual({
      forwardPosts: 1,
      mentionPosts: 1,
      linkPosts: 1,
    })
  })

  test("scope counts are still reported when no signals are enabled", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "@alpha_news",
      }),
    ]

    const result = computeDiscoveryCandidates(
      posts,
      [],
      ctx({
        selectedChannelCount: 1,
        enabledKinds: new Set<DiscoverySignalKind>(),
      }),
    )

    expect(result.emptyReason).toBe("no_signals_enabled")
    expect(result.scopeCounts.mentionPosts).toBe(1)
  })
})

describe("computeDiscoveryCandidates — self references", () => {
  test("a channel forwarding, mentioning, or linking itself is excluded", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        forwardedFrom: "carrier",
      }),
      makePost({
        id: 2,
        channelName: "carrier",
        timestamp: 1100,
        text: "follow us @carrier at https://t.me/carrier",
      }),
    ]

    const { candidates, emptyReason } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates).toEqual([])
    expect(emptyReason).toBe("no_candidates")
  })

  test("self reference is case-insensitive and does not inflate counts", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "Carrier",
        timestamp: 1000,
        text: "@CARRIER and @alpha_news",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ selectedChannelCount: 1 }),
    )

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.name).toBe("alpha_news")
  })
})

describe("computeDiscoveryCandidates — aggregation", () => {
  test("seenIn breaks down counts per carrier channel", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "alpha",
        timestamp: 1000,
        forwardedFrom: "target_chan",
      }),
      makePost({
        id: 2,
        channelName: "alpha",
        timestamp: 1100,
        text: "@target_chan",
      }),
      makePost({
        id: 3,
        channelName: "beta",
        timestamp: 1200,
        text: "https://t.me/target_chan",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(posts, [], ctx())
    const row = candidates[0]

    expect(row?.total).toBe(3)
    expect(row?.seenInCount).toBe(2)
    expect(row?.seenIn).toEqual([
      {
        channelName: "alpha",
        counts: { forward: 1, mention: 1, link: 0 },
        total: 2,
      },
      {
        channelName: "beta",
        counts: { forward: 0, mention: 0, link: 1 },
        total: 1,
      },
    ])
    expect(row?.lastSeen).toBe(1200)
    expect(row?.samplePost).toEqual({
      channelName: "beta",
      postId: 3,
      timestamp: 1200,
    })
  })

  test("deduplicates handles case-insensitively across kinds", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "alpha",
        timestamp: 1000,
        forwardedFrom: "Target_Chan",
      }),
      makePost({
        id: 2,
        channelName: "beta",
        timestamp: 2000,
        text: "@target_chan",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(posts, [], ctx())

    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.total).toBe(2)
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
        text: "@fresh_chan",
      }),
    ]

    const { candidates } = computeDiscoveryCandidates(
      posts,
      followedChannels,
      ctx({ selectedChannelCount: 1 }),
    )

    expect(
      candidates.find((c) => c.name.toLowerCase() === "known")?.isFollowed,
    ).toBe(true)
    expect(candidates.find((c) => c.name === "fresh_chan")?.isFollowed).toBe(
      false,
    )
  })
})

describe("computeDiscoveryCandidates — empty reasons", () => {
  test("no_signals_enabled when every kind is off", () => {
    const result = computeDiscoveryCandidates(
      [makePost({ id: 1, channelName: "a", timestamp: 1 })],
      [],
      ctx({ enabledKinds: new Set<DiscoverySignalKind>() }),
    )
    expect(result.emptyReason).toBe("no_signals_enabled")
  })

  test("no_channels_selected takes precedence over post scope", () => {
    const result = computeDiscoveryCandidates(
      [],
      [],
      ctx({ selectedChannelCount: 0 }),
    )
    expect(result.emptyReason).toBe("no_channels_selected")
  })

  test("no_posts_in_scope when the filtered corpus is empty", () => {
    const result = computeDiscoveryCandidates([], [], ctx())
    expect(result.emptyReason).toBe("no_posts_in_scope")
  })

  test("original_only only when forwards are the sole enabled signal", () => {
    const posts = [makePost({ id: 1, channelName: "a", timestamp: 1 })]
    const result = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ forwardedFilter: "original", enabledKinds: FORWARD_ONLY }),
    )
    expect(result.emptyReason).toBe("original_only")
  })

  test("mentions still discoverable on original-only posts", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1000,
        text: "check @alpha_news",
      }),
    ]
    const result = computeDiscoveryCandidates(
      posts,
      [],
      ctx({ forwardedFilter: "original", selectedChannelCount: 1 }),
    )
    expect(result.emptyReason).toBeUndefined()
    expect(result.candidates.map((c) => c.name)).toEqual(["alpha_news"])
  })
})

describe("sortDiscoveryCandidates", () => {
  const candidates: DiscoveryCandidate[] = [
    {
      name: "manyForwards",
      counts: { forward: 5, mention: 0, link: 0 },
      total: 5,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 100,
      isFollowed: false,
      samplePost: { channelName: "only", postId: 1, timestamp: 100 },
    },
    {
      name: "wideSpread",
      counts: { forward: 0, mention: 3, link: 0 },
      total: 3,
      seenIn: [],
      seenInCount: 3,
      lastSeen: 900,
      isFollowed: true,
      samplePost: { channelName: "a", postId: 10, timestamp: 900 },
    },
    {
      name: "linkOnly",
      counts: { forward: 0, mention: 0, link: 4 },
      total: 4,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 50,
      isFollowed: false,
      samplePost: { channelName: "x", postId: 20, timestamp: 50 },
    },
  ]

  test("total desc is the default", () => {
    expect(sortDiscoveryCandidates(candidates).map((c) => c.name)).toEqual([
      "manyForwards",
      "linkOnly",
      "wideSpread",
    ])
  })

  test("sorts by a single signal kind", () => {
    expect(
      sortDiscoveryCandidates(candidates, "mention").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
    expect(
      sortDiscoveryCandidates(candidates, "link").map((c) => c.name),
    ).toEqual(["linkOnly", "manyForwards", "wideSpread"])
  })

  test("sorts by lastSeen and seenInCount", () => {
    expect(
      sortDiscoveryCandidates(candidates, "lastSeen").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
    expect(
      sortDiscoveryCandidates(candidates, "seenInCount").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
  })
})

describe("filterDiscoveryCandidates", () => {
  const candidates: DiscoveryCandidate[] = [
    {
      name: "alpha_news",
      displayName: "Alpha News",
      counts: { forward: 5, mention: 0, link: 0 },
      total: 5,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 100,
      isFollowed: false,
      samplePost: { channelName: "a", postId: 1, timestamp: 100 },
    },
    {
      name: "beta_wire",
      counts: { forward: 0, mention: 1, link: 0 },
      total: 1,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 200,
      isFollowed: true,
      samplePost: { channelName: "b", postId: 2, timestamp: 200 },
    },
  ]

  const base = { followState: "all" as const, minTotal: 1, nameQuery: "" }

  test("minTotal drops low-signal noise", () => {
    expect(
      filterDiscoveryCandidates(candidates, { ...base, minTotal: 2 }).map(
        (c) => c.name,
      ),
    ).toEqual(["alpha_news"])
  })

  test("followState narrows to followed or unfollowed", () => {
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        followState: "unfollowed",
      }).map((c) => c.name),
    ).toEqual(["alpha_news"])
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        followState: "followed",
      }).map((c) => c.name),
    ).toEqual(["beta_wire"])
  })

  test("nameQuery matches handle and display name", () => {
    expect(
      filterDiscoveryCandidates(candidates, { ...base, nameQuery: "beta" }).map(
        (c) => c.name,
      ),
    ).toEqual(["beta_wire"])
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        nameQuery: "nomatch",
      }),
    ).toEqual([])
    // display name matches case-insensitively
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        nameQuery: "Alpha N",
      }).map((c) => c.name),
    ).toEqual(["alpha_news"])
  })
})

describe("countPostsBySignal", () => {
  test("counts posts carrying each signal, ignoring self references", () => {
    const posts = [
      makePost({
        id: 1,
        channelName: "carrier",
        timestamp: 1,
        forwardedFrom: "alpha_news",
      }),
      makePost({
        id: 2,
        channelName: "carrier",
        timestamp: 2,
        text: "@beta_wire and https://t.me/gamma_feed",
      }),
      makePost({
        id: 3,
        channelName: "carrier",
        timestamp: 3,
        text: "@carrier",
      }),
      makePost({
        id: 4,
        channelName: "carrier",
        timestamp: 4,
        text: "nothing",
      }),
    ]

    expect(countPostsBySignal(posts)).toEqual({
      forwardPosts: 1,
      mentionPosts: 1,
      linkPosts: 1,
    })
  })
})
