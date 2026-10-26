import { describe, expect, test } from "bun:test"

import { NO_RANKING, type PostsRanking } from "@/lib/posts/posts-view"
import type { Post } from "@/types"
import { isSemanticFeed } from "./usePostsView"

const related = { id: 1 } as Post

const meaning = (query: string): PostsRanking => ({
  kind: "meaning",
  query,
})

describe("isSemanticFeed", () => {
  test("takes the client path for a related or semantic search", () => {
    expect(isSemanticFeed(true, { kind: "related", post: related })).toBe(true)
    expect(isSemanticFeed(true, meaning("rockets"))).toBe(true)
  })

  test("stays on the server feed with no search, or a blank one", () => {
    expect(isSemanticFeed(true, NO_RANKING)).toBe(false)
    expect(isSemanticFeed(true, meaning("   "))).toBe(false)
  })

  test("stays on the server feed with embeddings off, whatever is set", () => {
    expect(isSemanticFeed(false, meaning("rockets"))).toBe(false)
  })
})
