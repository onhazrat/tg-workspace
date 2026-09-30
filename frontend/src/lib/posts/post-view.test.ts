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
      viewMeasure: "estimated" as const,
      viewsFilter: null,
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
      viewMeasure: "estimated" as const,
      viewsFilter: null,
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
      viewMeasure: "estimated" as const,
      viewsFilter: null,
    }

    const first = applyMaxPostsPerChannel(posts, view, seedContext)
    const second = applyMaxPostsPerChannel(posts, view, seedContext)
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id))
    expect(first).toHaveLength(2)
  })

  test("grouped newest places each block by its newest Post", () => {
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
      viewMeasure: "estimated" as const,
      viewsFilter: null,
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
      viewMeasure: "estimated" as const,
      viewsFilter: null,
    }

    // zebra kept its 500, so its block leads (PFB-02).
    expect(applyPostViewPipeline(posts, view, seedContext)).toEqual([
      makePost("zebra", 1, 500),
      makePost("alpha", 3, 300),
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
      languageFilter: [],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
        viewMeasure: "estimated" as const,
        viewsFilter: null,
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
      languageFilter: [],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
        viewMeasure: "estimated" as const,
        viewsFilter: null,
      },
      startDate: 0,
      endDate: 9999,
    })
    expect(photoOnly.map((p) => p.id)).toEqual([2])

    const textOnly = buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: ["text_only"],
      languageFilter: [],
      channels: [],
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
        viewMeasure: "estimated" as const,
        viewsFilter: null,
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
        languageFilter: [],
        channels: [],
        view: {
          maxPostsPerChannel: 0,
          maxPostsPerChannelMode: "ordered",
          postSortOrder: "newest",
          groupByChannel: false,
          viewMeasure: "estimated" as const,
          viewsFilter: null,
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
    viewMeasure: "estimated" as const,
    viewsFilter: null,
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
        viewMeasure: "estimated" as const,
        viewsFilter: null,
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
        languageFilter: [],
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

/**
 * Semantic parity (PFB-02): a meaning search filters its ranked Posts in the
 * browser, so the browser pipeline over a fixed set of Posts must give what
 * the server gives for the same filters. The fixtures and expected rows are
 * `backend/tests/api/test_post_filter_bar_feed.py`'s, as the Operator sees
 * them (`pfb_a` and `pfb_b`); the random cap is left out because the two
 * seeded orders were never byte-identical (see `scoped-posts.ts`).
 */
describe("post-view pipeline: parity with the server feed", () => {
  const BASE = 1_000_000
  const at = (
    channel: string,
    id: number,
    ts: number,
    overrides: Partial<Post> = {},
  ) => makePost(channel, id, BASE + ts, overrides)
  type Context = Parameters<typeof buildFilteredPostsFromRaw>[1]
  const run = (
    posts: Post[],
    over: Partial<Omit<Context, "view">> & {
      view?: Partial<Context["view"]>
    } = {},
  ) =>
    buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: [],
      languageFilter: [],
      channels: [],
      startDate: 0,
      endDate: 0,
      ...over,
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
        viewMeasure: "estimated" as const,
        viewsFilter: null,
        ...over.view,
      },
    }).map((p) => `${p.channelName}/${p.id}`)

  const languages = [
    at("pfb_a", 1, 1, { language: "fa" }),
    at("pfb_a", 2, 2, { language: "en" }),
    at("pfb_a", 3, 3, { language: null }),
    at("pfb_b", 4, 4, { language: "fa" }),
    at("pfb_b", 5, 5, { language: "zxx" }),
  ]
  // `_seed_blocks`: alphabetical order is neither block order.
  const blocks = [
    at("pfb_a", 1, 30),
    at("pfb_a", 2, 40),
    at("pfb_b", 3, 5),
    at("pfb_b", 4, 90),
  ]

  test("a Language set keeps the ticked; an unread Post never matches", () => {
    expect(run(languages, { languageFilter: ["fa"] })).toEqual([
      "pfb_b/4",
      "pfb_a/1",
    ])
    expect(run(languages, { languageFilter: ["fa", "en"] })).toEqual([
      "pfb_b/4",
      "pfb_a/2",
      "pfb_a/1",
    ])
  })

  test("a block sits where its first Post falls, under both orders", () => {
    expect(run(blocks, { view: { groupByChannel: true } })).toEqual([
      "pfb_b/4",
      "pfb_b/3",
      "pfb_a/2",
      "pfb_a/1",
    ])
    expect(
      run(blocks, { view: { groupByChannel: true, postSortOrder: "oldest" } }),
    ).toEqual(["pfb_b/3", "pfb_b/4", "pfb_a/1", "pfb_a/2"])
  })

  test("the cap keeps the first N in the order before grouping places it", () => {
    const capped = (postSortOrder: "newest" | "oldest") =>
      run(blocks, {
        view: { groupByChannel: true, maxPostsPerChannel: 1, postSortOrder },
      })
    expect(capped("newest")).toEqual(["pfb_b/4", "pfb_a/2"])
    expect(capped("oldest")).toEqual(["pfb_b/3", "pfb_a/1"])
  })

  test("a tie breaks on the channel name, then the post id", () => {
    const tied = [at("pfb_b", 2, 7), at("pfb_a", 9, 7), at("pfb_a", 3, 7)]
    expect(run(tied)).toEqual(["pfb_a/9", "pfb_a/3", "pfb_b/2"])
    expect(run(tied, { view: { postSortOrder: "oldest" } })).toEqual([
      "pfb_a/3",
      "pfb_a/9",
      "pfb_b/2",
    ])
  })
})

/**
 * Semantic parity for Views (PFB-03): the corpus and the answers are
 * `backend/tests/api/test_post_views_feed.py`'s, as the Operator sees them
 * (`pv_a` and `pv_b`), read through the seed curve at the default settings.
 * a2 is too new to judge (observed at 1h) and a3 has no View count.
 */
describe("post-view pipeline: parity with the server's views feed", () => {
  const HOUR = 3_600_000
  const SEED = {
    curve: {
      kind: "steps" as const,
      points: [
        [0, 0.2],
        [3, 0.59],
        [6, 0.7],
        [12, 0.86],
        [24, 0.89],
      ],
    },
    settlingAgeHours: 24,
    estimationFloorHours: 3,
  }
  const corpus: [string, number, number | null, number | null][] = [
    ["pv_a", 1, 5000, 48],
    ["pv_a", 2, 1000, 1],
    ["pv_a", 3, null, null],
    ["pv_a", 4, 2000, 6],
    ["pv_b", 5, 3000, 30],
    ["pv_b", 6, 800, 12],
  ]
  const posts = corpus.map(([channel, id, views, age]) => {
    const timestamp = 1_000_000 + id * 60_000
    return makePost(channel, id, timestamp, {
      viewsCount: views,
      viewsObservedAt: age == null ? null : timestamp + age * HOUR,
    })
  })
  const run = (view: Partial<Parameters<typeof sortPosts>[1]>) =>
    buildFilteredPostsFromRaw(posts, {
      searchText: "",
      forwardedFilter: "all",
      mediaFilter: [],
      languageFilter: [],
      channels: [],
      startDate: 0,
      endDate: 0,
      view: {
        maxPostsPerChannel: 0,
        maxPostsPerChannelMode: "ordered",
        postSortOrder: "newest",
        groupByChannel: false,
        viewMeasure: "estimated",
        viewsFilter: null,
        viewEstimate: SEED,
        ...view,
      },
    }).map((p) => p.id)

  test.each([
    ["estimated", "gte", 2500, [5, 4, 1]],
    ["views", "gte", 2500, [5, 1]],
    ["estimated", "lte", 900, [6]],
    ["views", "lte", 900, [6]],
  ] as const)(
    "%s %s %d keeps what the server keeps",
    (measure, op, value, expected) => {
      expect(run({ viewMeasure: measure, viewsFilter: { op, value } })).toEqual(
        [...expected],
      )
    },
  )

  test.each([
    ["estimated", "most_views", [1, 5, 4, 6, 3, 2]],
    ["estimated", "fewest_views", [6, 4, 5, 1, 3, 2]],
    ["views", "most_views", [1, 5, 4, 2, 6, 3]],
    ["views", "fewest_views", [6, 2, 4, 5, 1, 3]],
  ] as const)(
    "%s %s orders as the server does, nulls last",
    (measure, sort, expected) => {
      expect(run({ viewMeasure: measure, postSortOrder: sort })).toEqual([
        ...expected,
      ])
    },
  )

  test("the cap keeps each channel's top N and grouping places blocks by their best", () => {
    expect(run({ postSortOrder: "most_views", maxPostsPerChannel: 1 })).toEqual(
      [1, 5],
    )
    expect(run({ postSortOrder: "most_views", groupByChannel: true })).toEqual([
      1, 4, 3, 2, 5, 6,
    ])
  })

  test("two blocks with an equal best value fall to the channel name, as on the server", () => {
    // pv_z's Post is the newer, so ordering the Posts alone would lead with
    // its block; the server breaks a tie between blocks by channel name.
    const tied = [
      makePost("pv_z", 1, 2_000_000, {
        viewsCount: 100,
        viewsObservedAt: 2_000_000 + 48 * HOUR,
      }),
      makePost("pv_y", 2, 1_000_000, {
        viewsCount: 100,
        viewsObservedAt: 1_000_000 + 48 * HOUR,
      }),
    ]
    const grouped = sortPosts(tied, {
      maxPostsPerChannel: 0,
      maxPostsPerChannelMode: "ordered",
      postSortOrder: "most_views",
      groupByChannel: true,
      viewMeasure: "estimated",
      viewsFilter: null,
      viewEstimate: SEED,
    })
    expect(grouped.map((p) => p.channelName)).toEqual(["pv_y", "pv_z"])
  })

  test("with no curve loaded an estimate is none, never a guess", () => {
    expect(
      run({ viewsFilter: { op: "gte", value: 0 }, viewEstimate: null }),
    ).toEqual([])
  })
})
