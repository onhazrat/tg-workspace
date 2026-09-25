import { describe, expect, test } from "bun:test"

import type { Post } from "@/types"
import { isSemanticFeed } from "./usePostsView"

const related = { id: 1 } as Post

describe("isSemanticFeed", () => {
  test("takes the client path for a related or semantic search", () => {
    expect(isSemanticFeed(true, related, "")).toBe(true)
    expect(isSemanticFeed(true, null, "rockets")).toBe(true)
  })

  test("stays on the server feed with no search, or a blank one", () => {
    expect(isSemanticFeed(true, null, "")).toBe(false)
    expect(isSemanticFeed(true, null, "   ")).toBe(false)
  })

  test("stays on the server feed with embeddings off, whatever is set", () => {
    expect(isSemanticFeed(false, related, "rockets")).toBe(false)
  })
})
