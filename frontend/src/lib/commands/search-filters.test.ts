import { describe, expect, test } from "bun:test"

import { api } from "@/api"
import {
  filterPostsByTextQuery,
  SEARCH_RESULTS_CAP,
  searchPostsForPalette,
  semanticSearchPostsForPalette,
} from "@/lib/commands/search-filters"
import type { CommandContext } from "@/lib/commands/types"
import { filterSummariesByTextQuery } from "@/lib/summary-projection"
import type { Post, Summary } from "@/types"

const posts: Post[] = [
  {
    id: 10,
    channelName: "news",
    text: "Markets closed higher",
    date: "2024-03-01",
    timestamp: 100,
  },
  {
    id: 11,
    channelName: "weather",
    text: "Rain expected tomorrow",
    date: "2024-03-02",
    timestamp: 200,
  },
]

const summaries: Summary[] = [
  {
    id: "h1",
    text: "Daily market wrap",
    scope: { channels: ["news"], start: 1, end: 2 },
    language: "en",
    model: "gpt",
    timestamp: 1,
    promptText: "Summarize markets",
  },
  {
    id: "h2",
    text: "Chat: follow-up",
    scope: { channels: ["news"], start: 1, end: 2 },
    language: "en",
    timestamp: 2,
    chatMessages: [{ role: "user", text: "hello" }],
  },
]

describe("search-filters parity", () => {
  test("post text filter matches PostFilter behavior", () => {
    expect(filterPostsByTextQuery(posts, "markets")).toEqual([posts[0]])
    expect(filterPostsByTextQuery(posts, "news")).toEqual([posts[0]])
    expect(filterPostsByTextQuery(posts, "")).toEqual(posts)
  })

  test("summary text filter matches HistoryView search fields", () => {
    expect(filterSummariesByTextQuery(summaries, "markets")).toEqual([
      summaries[0],
    ])
    expect(filterSummariesByTextQuery(summaries, "news")).toEqual(summaries)
    expect(filterSummariesByTextQuery(summaries, "gpt")).toEqual([summaries[0]])
    expect(filterSummariesByTextQuery(summaries, "summarize")).toEqual([
      summaries[0],
    ])
    expect(filterSummariesByTextQuery(summaries, "")).toEqual(summaries)
  })
})

/**
 * Swap one `api` method for the run, recording its arguments and answering
 * with `answer`, then restore it.
 */
async function withApi<T>(
  method: "getPostsFeed" | "ragSearch",
  answer: unknown,
  run: () => Promise<T>,
): Promise<{ result: T; calls: unknown[] }> {
  const target = api as unknown as Record<string, unknown>
  const original = target[method]
  const calls: unknown[] = []
  target[method] = async (arg: unknown) => {
    calls.push(arg)
    return answer
  }
  try {
    return { result: await run(), calls }
  } finally {
    target[method] = original
  }
}

const paletteCtx = (selected: string[]) =>
  ({
    selectedChannels: new Set(selected),
    postDateRange: { startDate: 1_000, endDate: 2_000 },
  }) as CommandContext

describe("searchPostsForPalette", () => {
  test("asks the feed for the trimmed keyword inside the selection and range", async () => {
    const { result, calls } = await withApi("getPostsFeed", posts, () =>
      searchPostsForPalette(paletteCtx(["news"]), "  markets "),
    )
    expect(result).toBe(posts)
    expect(calls).toEqual([
      {
        channelNames: ["news"],
        startDate: 1_000,
        endDate: 2_000,
        keyword: "markets",
        sort: "time",
        limit: SEARCH_RESULTS_CAP,
      },
    ])
  })

  test("searches nothing for a blank query or an empty selection", async () => {
    const { calls } = await withApi("getPostsFeed", posts, async () => [
      await searchPostsForPalette(paletteCtx(["news"]), "   "),
      await searchPostsForPalette(paletteCtx([]), "markets"),
    ])
    expect(calls).toEqual([])
  })
})

describe("semanticSearchPostsForPalette", () => {
  const hits = Array.from({ length: SEARCH_RESULTS_CAP + 5 }, (_, i) => ({
    score: 1,
    channelName: "news",
    postId: i,
    text: "",
    post: { ...posts[0], id: i },
  }))

  test("scopes to the selection and caps the results", async () => {
    const { result, calls } = await withApi(
      "ragSearch",
      { results: hits },
      () => semanticSearchPostsForPalette(paletteCtx(["news"]), "markets"),
    )
    expect(result).toHaveLength(SEARCH_RESULTS_CAP)
    expect(calls).toMatchObject([
      { query: "markets", channels: ["news"], limit: SEARCH_RESULTS_CAP },
    ])
  })

  test("searches every channel when none is selected", async () => {
    const { calls } = await withApi("ragSearch", { results: [] }, () =>
      semanticSearchPostsForPalette(paletteCtx([]), "markets"),
    )
    expect((calls[0] as { channels?: string[] }).channels).toBeUndefined()
  })

  test("sends nothing for a blank query", async () => {
    const { result, calls } = await withApi("ragSearch", { results: [] }, () =>
      semanticSearchPostsForPalette(paletteCtx(["news"]), "  "),
    )
    expect(result).toEqual([])
    expect(calls).toEqual([])
  })
})
