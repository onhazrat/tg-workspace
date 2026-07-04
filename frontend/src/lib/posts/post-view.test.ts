import { describe, expect, test } from "bun:test"

import {
  applyMaxPostsPerChannel,
  applyPostViewPipeline,
  buildFilteredPostsFromRaw,
  formatPostsForPrompt,
  getPostEmbeddingText,
  sortPosts,
} from "@/lib/posts/post-view"
import type { Post } from "@/types"

const seedContext = { startDate: 1000, endDate: 9000 }

function makePost(
  channelName: string,
  id: number,
  timestamp: number,
  overrides: Partial<Post> = {},
): Post {
  return {
    id,
    channelName,
    text: `Post ${id} from ${channelName}`,
    date: new Date(timestamp).toISOString(),
    timestamp,
    ...overrides,
  }
}

describe("post-view pipeline", () => {
  test("unlimited + by time matches global timestamp desc sort", () => {
    const posts = [
      makePost("alpha", 1, 100),
      makePost("beta", 2, 300),
      makePost("alpha", 3, 200),
    ]
    const view = {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "latest" as const,
      postSortOrder: "time" as const,
    }

    expect(applyPostViewPipeline(posts, view)).toEqual([
      makePost("beta", 2, 300),
      makePost("alpha", 3, 200),
      makePost("alpha", 1, 100),
    ])
  })

  test("max latest keeps top N per channel by timestamp", () => {
    const posts = [
      makePost("alpha", 1, 100),
      makePost("alpha", 2, 300),
      makePost("alpha", 3, 200),
      makePost("beta", 4, 150),
      makePost("beta", 5, 250),
      makePost("gamma", 6, 400),
      makePost("gamma", 7, 350),
      makePost("gamma", 8, 325),
    ]
    const view = {
      maxPostsPerChannel: 2,
      maxPostsPerChannelMode: "latest" as const,
      postSortOrder: "time" as const,
    }

    const result = applyPostViewPipeline(posts, view, seedContext)
    expect(result).toHaveLength(6)
    expect(
      result.filter((p) => p.channelName === "alpha").map((p) => p.id),
    ).toEqual([2, 3])
    expect(
      result.filter((p) => p.channelName === "beta").map((p) => p.id),
    ).toEqual([5, 4])
    expect(
      result.filter((p) => p.channelName === "gamma").map((p) => p.id),
    ).toEqual([6, 7])
  })

  test("max random is deterministic for same seed context", () => {
    const posts = [
      makePost("alpha", 1, 100),
      makePost("alpha", 2, 200),
      makePost("alpha", 3, 300),
      makePost("alpha", 4, 400),
    ]
    const view = {
      maxPostsPerChannel: 2,
      maxPostsPerChannelMode: "random" as const,
      postSortOrder: "time" as const,
    }

    const first = applyMaxPostsPerChannel(posts, view, seedContext)
    const second = applyMaxPostsPerChannel(posts, view, seedContext)
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id))
    expect(first).toHaveLength(2)
  })

  test("sort channel_time groups alphabetically with newest first within group", () => {
    const posts = [
      makePost("zebra", 1, 100),
      makePost("alpha", 2, 300),
      makePost("alpha", 3, 200),
      makePost("beta", 4, 150),
    ]
    const view = {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "latest" as const,
      postSortOrder: "channel_time" as const,
    }

    expect(sortPosts(posts, view)).toEqual([
      makePost("alpha", 2, 300),
      makePost("alpha", 3, 200),
      makePost("beta", 4, 150),
      makePost("zebra", 1, 100),
    ])
  })

  test("pipeline applies cap before sort", () => {
    const posts = [
      makePost("zebra", 1, 500),
      makePost("zebra", 2, 400),
      makePost("alpha", 3, 300),
      makePost("alpha", 4, 200),
    ]
    const view = {
      maxPostsPerChannel: 1,
      maxPostsPerChannelMode: "latest" as const,
      postSortOrder: "channel_time" as const,
    }

    expect(applyPostViewPipeline(posts, view, seedContext)).toEqual([
      makePost("alpha", 3, 300),
      makePost("zebra", 1, 500),
    ])
  })

  test("buildFilteredPostsFromRaw applies keyword, forwarded, and view pipeline", () => {
    const posts = [
      makePost("alpha", 1, 100),
      { ...makePost("beta", 2, 200), forwardedFrom: "other" },
      makePost("gamma", 3, 300),
    ]

    const result = buildFilteredPostsFromRaw(posts, {
      searchText: "Post",
      forwardedFilter: "original",
      mediaFilter: "all",
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "latest",
        postSortOrder: "time",
      },
      startDate: 0,
      endDate: 9999,
    })

    expect(result.map((p) => p.id)).toEqual([3, 1])
  })

  test("formatPostsForPrompt preserves array order", () => {
    const posts = [makePost("alpha", 1, 100), makePost("beta", 2, 200)]
    const text = formatPostsForPrompt(posts)
    expect(text.indexOf("[alpha]")).toBeLessThan(text.indexOf("[beta]"))
    expect(text).toContain("Content: Post 1 from alpha")
  })

  test("formatPostsForPrompt includes media hints when present", () => {
    const posts = [
      makePost("durov", 522, 100, {
        text: "[photo]",
        media: {
          kinds: ["photo"],
          views: "2.23M",
          isMediaOnly: true,
          thumbApiPath: "/api/v1/telegram/post-thumb/durov/522",
        },
      }),
    ]
    const text = formatPostsForPrompt(posts)
    expect(text).toContain("Media: photo")
    expect(text).toContain("Views: 2.23M")
    expect(text).toContain("Content: [photo]")
    expect(text).not.toContain("reactions")
  })

  test("formatPostsForPrompt includes link preview and album metadata", () => {
    const posts = [
      makePost("durov", 510, 100, {
        text: "Album caption",
        media: {
          kinds: ["photo", "grouped"],
          groupedCount: 4,
          linkPreview: {
            title: "Example",
            description: "Summary text",
            siteName: "example.com",
          },
        },
      }),
    ]
    const text = formatPostsForPrompt(posts)
    expect(text).toContain("Media: photo, grouped")
    expect(text).toContain("Album: 4 items")
    expect(text).toContain("Link preview: Example — Summary text (example.com)")
  })

  test("getPostEmbeddingText prepends media hints", () => {
    const post = makePost("alpha", 1, 100, {
      text: "[video]",
      media: {
        kinds: ["video"],
        durationSec: 83,
        isMediaOnly: true,
      },
    })
    expect(getPostEmbeddingText(post)).toBe(
      "Media: video | Duration: 1:23\n[video]",
    )
  })

  test("buildFilteredPostsFromRaw applies media filter", () => {
    const posts = [
      makePost("alpha", 1, 100, { text: "Plain text" }),
      makePost("alpha", 2, 200, {
        text: "[photo]",
        media: { kinds: ["photo"], isMediaOnly: true },
      }),
      makePost("alpha", 3, 300, {
        text: "News link",
        media: { kinds: ["link_preview"] },
      }),
    ]

    const photoOnly = buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: "photo",
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "latest",
        postSortOrder: "time",
      },
      startDate: 0,
      endDate: 9999,
    })
    expect(photoOnly.map((p) => p.id)).toEqual([2])

    const textOnly = buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: "text_only",
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "latest",
        postSortOrder: "time",
      },
      startDate: 0,
      endDate: 9999,
    })
    expect(textOnly.map((p) => p.id)).toEqual([1])
  })
})
