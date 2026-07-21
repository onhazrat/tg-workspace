/**
 * Proves the de-dup and paging behaviour of `getPostsByDateRange` against a
 * mocked API and cache — the acceptance criterion for the posts migration.
 */
import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { Post } from "@/types"

// bun's runtime has no localStorage; repository.ts uses it for sync etags.
const store = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => {
    store.set(k, v)
  },
  removeItem: (k: string) => {
    store.delete(k)
  },
  clear: () => {
    store.clear()
  },
}

let getPostsCalls: {
  limit?: number
  offset?: number
  channelNames?: string[]
}[] = []
let serverPosts: Post[] = []

function post(id: number): Post {
  return {
    id,
    channelName: "ch",
    text: `post ${id}`,
    timestamp: id,
    date: "",
  } as Post
}

mock.module("@/api", () => ({
  api: {
    syncMeta: async () => ({ posts: { etag: "etag-1" } }),
    getPosts: async (params: {
      limit?: number
      offset?: number
      channelNames?: string[]
    }) => {
      getPostsCalls.push(params)
      const offset = params.offset ?? 0
      const limit = params.limit ?? serverPosts.length
      return serverPosts.slice(offset, offset + limit)
    },
  },
}))

mock.module("@/lib/cache", () => ({
  savePosts: async () => {},
  getPostsByDateRange: async () => [],
  getPost: async () => undefined,
}))

const { getPostsByDateRange, resetInFlight } = await import("@/lib/repository")

describe("getPostsByDateRange", () => {
  beforeEach(() => {
    getPostsCalls = []
    serverPosts = []
    resetInFlight()
    localStorage.clear()
  })

  test("two concurrent calls with identical params produce one fetch", async () => {
    serverPosts = [post(1), post(2)]

    const [a, b] = await Promise.all([
      getPostsByDateRange(["ch"], 0, 100),
      getPostsByDateRange(["ch"], 0, 100),
    ])

    expect(getPostsCalls.length).toBe(1)
    expect(a).toEqual(b)
  })

  test("concurrent calls with different ranges are not merged", async () => {
    serverPosts = [post(1)]

    await Promise.all([
      getPostsByDateRange(["ch"], 0, 100),
      getPostsByDateRange(["ch"], 0, 200),
    ])

    expect(getPostsCalls.length).toBe(2)
  })

  test("a bounded read passes limit through and does not page", async () => {
    serverPosts = Array.from({ length: 50 }, (_, i) => post(i))

    const result = await getPostsByDateRange(["ch"], 0, 100, { limit: 20 })

    expect(getPostsCalls.length).toBe(1)
    expect(getPostsCalls[0]?.limit).toBe(20)
    expect(result.length).toBe(20)
  })

  test("an unbounded read pages to exhaustion rather than truncating", async () => {
    // Two full pages plus a short final page.
    serverPosts = Array.from({ length: 10_050 }, (_, i) => post(i))

    const result = await getPostsByDateRange(["ch"], 0, 100)

    expect(result.length).toBe(10_050)
    expect(getPostsCalls.length).toBe(3)
    expect(getPostsCalls.map((c) => c.offset)).toEqual([0, 5000, 10_000])
  })

  test("a single short page ends paging immediately", async () => {
    serverPosts = [post(1), post(2)]

    const result = await getPostsByDateRange(["ch"], 0, 100)

    expect(result.length).toBe(2)
    expect(getPostsCalls.length).toBe(1)
  })
})
