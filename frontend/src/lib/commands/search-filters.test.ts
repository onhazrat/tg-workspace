import { describe, expect, test } from "bun:test"

import { filterPostsByTextQuery } from "@/lib/commands/search-filters"
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
    channels: ["news"],
    startDate: 1,
    endDate: 2,
    language: "en",
    model: "gpt",
    timestamp: 1,
    promptText: "Summarize markets",
  },
  {
    id: "h2",
    text: "Chat: follow-up",
    channels: ["news"],
    startDate: 1,
    endDate: 2,
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
    expect(filterSummariesByTextQuery(summaries, "gpt")).toEqual([summaries[0]])
    expect(filterSummariesByTextQuery(summaries, "summarize")).toEqual([
      summaries[0],
    ])
    expect(filterSummariesByTextQuery(summaries, "")).toEqual(summaries)
  })
})
