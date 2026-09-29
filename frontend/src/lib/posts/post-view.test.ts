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
  test("unlimited + newest matches global timestamp desc sort", () => {
    const posts = [
      makePost("alpha", 1, 100),
      makePost("beta", 2, 300),
      makePost("alpha", 3, 200),
    ]
    const view = {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "ordered" as const,
      postSortOrder: "newest" as const,
      groupByChannel: false,
    }

    expect(applyPostViewPipeline(posts, view)).toEqual([
      makePost("beta", 2, 300),
      makePost("alpha", 3, 200),
      makePost("alpha", 1, 100),
    ])
  })

  test("max ordered keeps top N per channel by timestamp under newest", () => {
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
      maxPostsPerChannelMode: "ordered" as const,
      postSortOrder: "newest" as const,
      groupByChannel: false,
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
      postSortOrder: "newest" as const,
      groupByChannel: false,
    }

    const first = applyMaxPostsPerChannel(posts, view, seedContext)
    const second = applyMaxPostsPerChannel(posts, view, seedContext)
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id))
    expect(first).toHaveLength(2)
  })

  test("grouped newest groups alphabetically with newest first within group", () => {
    const posts = [
      makePost("zebra", 1, 100),
      makePost("alpha", 2, 300),
      makePost("alpha", 3, 200),
      makePost("beta", 4, 150),
    ]
    const view = {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "ordered" as const,
      postSortOrder: "newest" as const,
      groupByChannel: true,
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
      maxPostsPerChannelMode: "ordered" as const,
      postSortOrder: "newest" as const,
      groupByChannel: true,
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
      mediaFilter: [],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
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

  // Byte-identical golden reference for the assembled prompt body. This is the
  // exact string the summary/chat/tag paths feed to the model today; the
  // deferred server-side prompt assembly (parent plan T5.1) must reproduce it
  // verbatim. Update only with an intentional prompt-format change.
  test("formatPostsForPrompt is byte-identical to the golden reference", () => {
    const posts = [
      makePost("alpha", 1, 1704067200000, { text: "First post body" }),
      makePost("durov", 522, 1704067200000, {
        text: "[photo]",
        viewsCount: 2_230_000,
        media: {
          kinds: ["photo"],
          isMediaOnly: true,
          thumbApiPath: "/api/v1/telegram/post-thumb/durov/522",
        },
      }),
    ]
    const expected = [
      `[alpha] ID: 1`,
      `Date: ${posts[0].date}`,
      `Content: First post body`,
      ``,
      `---`,
      ``,
      `[durov] ID: 522`,
      `Date: ${posts[1].date}`,
      `Media: photo | Views: 2.23M`,
      `Content: [photo]`,
    ].join("\n")
    expect(formatPostsForPrompt(posts)).toBe(expected)
  })

  test("formatPostsForPrompt includes media hints when present", () => {
    const posts = [
      makePost("durov", 522, 100, {
        text: "[photo]",
        viewsCount: 2_230_000,
        media: {
          kinds: ["photo"],
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
      mediaFilter: ["photo"],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
      },
      startDate: 0,
      endDate: 9999,
    })
    expect(photoOnly.map((p) => p.id)).toEqual([2])

    const textOnly = buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: ["text_only"],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
      },
      startDate: 0,
      endDate: 9999,
    })
    expect(textOnly.map((p) => p.id)).toEqual([1])
  })

  // Mirrors test_media_text_only_vs_media_only_kinds in
  // backend/tests/services/test_post_filters.py — the two filter
  // implementations must agree on these.
  test("stats-only media keeps a post text_only, stickers do not", () => {
    const posts = [
      makePost("alpha", 1, 100, { text: "Plain text" }),
      makePost("alpha", 2, 200, {
        text: "Text with views",
        media: { kinds: [] },
        viewsCount: 1_200,
      }),
      makePost("alpha", 3, 300, {
        text: "[sticker]",
        media: { kinds: ["sticker"] },
      }),
    ]

    const filterBy = (kind: "text_only" | "media_only") =>
      buildFilteredPostsFromRaw(posts, {
        searchText: "",
        forwardedFilter: "all",
        mediaFilter: [kind],
        channels: [],
        view: {
          maxPostsPerChannel: 0,
          maxPostsPerChannelMode: "ordered",
          postSortOrder: "newest",
          groupByChannel: false,
        },
        startDate: 0,
        endDate: 9999,
      })
        .map((p) => p.id)
        .sort()

    expect(filterBy("text_only")).toEqual([1, 2])
    expect(filterBy("media_only")).toEqual([3])
  })
})

// PFB-01: the Scope's new shape through the browser pipeline, which is the
// path a semantic result takes. Each case mirrors one in
// backend/tests/api/test_posts_feed.py, so the two halves answer the same
// question the same way; the server's fixture has no timestamp ties inside a
// channel, which is the one place their tiebreaks could differ.
describe("post-view pipeline — the PFB-01 shape", () => {
  const view = (overrides: Partial<Parameters<typeof sortPosts>[1]> = {}) => ({
    maxPostsPerChannel: 0,
    maxPostsPerChannelMode: "ordered" as const,
    postSortOrder: "newest" as const,
    groupByChannel: false,
    ...overrides,
  })
  const keys = (posts: Post[]) => posts.map((p) => `${p.channelName}/${p.id}`)
  // `_seed_interleaved` in test_posts_feed.py, minus its cross-channel tie.
  const interleaved = [
    makePost("feed_a", 1, 1),
    makePost("feed_b", 2, 2),
    makePost("feed_a", 3, 3),
    makePost("feed_b", 4, 4),
    makePost("feed_a", 5, 5),
  ]

  test("oldest orders oldest first", () => {
    expect(
      keys(
        applyPostViewPipeline(interleaved, view({ postSortOrder: "oldest" })),
      ),
    ).toEqual(["feed_a/1", "feed_b/2", "feed_a/3", "feed_b/4", "feed_a/5"])
  })

  test("grouped keeps the chosen order inside each channel", () => {
    expect(
      keys(
        applyPostViewPipeline(
          interleaved,
          view({ postSortOrder: "oldest", groupByChannel: true }),
        ),
      ),
    ).toEqual(["feed_a/1", "feed_a/3", "feed_a/5", "feed_b/2", "feed_b/4"])
  })

  test("the ordered cap keeps each channel's first N in the chosen order", () => {
    // `test_ordered_cap_follows_the_order`: under oldest, the earliest N.
    const oldest = applyPostViewPipeline(
      interleaved,
      view({
        maxPostsPerChannel: 1,
        postSortOrder: "oldest",
        groupByChannel: true,
      }),
      seedContext,
    )
    const newest = applyPostViewPipeline(
      interleaved,
      view({ maxPostsPerChannel: 1, groupByChannel: true }),
      seedContext,
    )

    expect(keys(oldest)).toEqual(["feed_a/1", "feed_b/2"])
    expect(keys(newest)).toEqual(["feed_a/5", "feed_b/4"])
  })

  test("a media set keeps a Post matching any kind; empty keeps all", () => {
    const posts = [
      makePost("ms", 1, 1, { text: "plain" }),
      makePost("ms", 2, 2, { text: "photo", media: { kinds: ["photo"] } }),
      makePost("ms", 3, 3, { text: "video", media: { kinds: ["video"] } }),
    ]
    const filtered = (mediaFilter: ("photo" | "video")[]) =>
      buildFilteredPostsFromRaw(posts, {
        searchText: "",
        forwardedFilter: "all",
        mediaFilter,
        channels: [],
        view: view(),
        startDate: 0,
        endDate: 9999,
      }).map((p) => p.id)

    expect(filtered(["photo", "video"])).toEqual([3, 2])
    expect(filtered(["photo"])).toEqual([2])
    expect(filtered([])).toEqual([3, 2, 1])
  })
})
