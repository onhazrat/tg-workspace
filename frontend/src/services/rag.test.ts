import { describe, expect, it } from "bun:test"

import type { Post } from "@/types"

import { embeddingProgress, type RagSearchResult, resolveRagPosts } from "./rag"

const post = (channelName: string, id: number): Post =>
  ({ channelName, id, text: `${channelName}#${id}`, timestamp: 0 }) as Post

const hit = (channelName: string, postId: number, inline?: Post) =>
  ({ channelName, postId, post: inline }) as RagSearchResult

describe("resolveRagPosts", () => {
  it("makes no request when every hit came back inline", async () => {
    let calls = 0
    const a = post("alpha", 1)
    const posts = await resolveRagPosts([hit("alpha", 1, a)], async () => {
      calls++
      return []
    })
    expect(posts).toEqual([a])
    expect(calls).toBe(0)
  })

  it("fetches only the misses, in one batch, and keeps the ranking order", async () => {
    const requested: unknown[] = []
    const inline = post("alpha", 1)
    const posts = await resolveRagPosts(
      [hit("beta", 7), hit("alpha", 1, inline), hit("beta", 3)],
      async (refs) => {
        requested.push(refs)
        // The server answers in its own order; the result must not follow it.
        return [post("beta", 3), post("beta", 7)]
      },
    )
    expect(requested).toEqual([
      [
        { channelName: "beta", postId: 7 },
        { channelName: "beta", postId: 3 },
      ],
    ])
    expect(posts.map((p) => `${p.channelName}#${p.id}`)).toEqual([
      "beta#7",
      "alpha#1",
      "beta#3",
    ])
  })

  it("drops a hit the lookup could not resolve, matching on channel and id", async () => {
    // Same id in another channel must not stand in for the missing post.
    const posts = await resolveRagPosts(
      [hit("alpha", 5), hit("beta", 6)],
      async () => [post("gamma", 5), post("beta", 6)],
    )
    expect(posts.map((p) => `${p.channelName}#${p.id}`)).toEqual(["beta#6"])
  })
})

describe("embeddingProgress", () => {
  it("counts the embedded rows as done and syncs while any are pending", () => {
    expect(embeddingProgress({ pending: 30, total: 100 })).toEqual({
      isSyncing: true,
      progress: { current: 70, total: 100 },
    })
  })

  it("is idle and complete once nothing is pending", () => {
    expect(embeddingProgress({ pending: 0, total: 100 })).toEqual({
      isSyncing: false,
      progress: { current: 100, total: 100 },
    })
  })

  it("reads absent counts as zero", () => {
    expect(embeddingProgress({})).toEqual({
      isSyncing: false,
      progress: { current: 0, total: 0 },
    })
  })

  it("never reports a negative count when pending exceeds total", () => {
    expect(embeddingProgress({ pending: 12, total: 10 }).progress.current).toBe(
      0,
    )
  })
})
