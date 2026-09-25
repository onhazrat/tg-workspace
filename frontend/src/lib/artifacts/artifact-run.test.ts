import { describe, expect, it } from "bun:test"
import type { PostScopeQuery } from "@/api/data"
import type { Post } from "@/types"
import {
  errorText,
  frozenScope,
  promptPosts,
  readStream,
  searchFilterExtra,
  withProvisionalRow,
} from "./artifact-run"

/**
 * The rules the Summary, Chat and Tag runs share. `withProvisionalRow` is the
 * one with teeth: each context used to hand-roll it, and a run that opens a row
 * and then fails must not leave an empty Artifact in History.
 */

describe("withProvisionalRow", () => {
  const recorder = () => {
    const removed: string[] = []
    return {
      removed,
      remove: async (id: string) => {
        removed.push(id)
      },
    }
  }

  it("deletes the row a failed run opened, and rethrows", async () => {
    const r = recorder()
    const run = withProvisionalRow(r.remove, async (row) => {
      row.opened("s1")
      throw new Error("model down")
    })
    await expect(run).rejects.toThrow("model down")
    expect(r.removed).toEqual(["s1"])
  })

  it("keeps the row once the run says so", async () => {
    const r = recorder()
    const value = await withProvisionalRow(r.remove, async (row) => {
      row.opened("s1")
      row.keep()
      return 42
    })
    expect(value).toBe(42)
    expect(r.removed).toEqual([])
  })

  it("deletes nothing when the run failed before opening a row", async () => {
    const r = recorder()
    await expect(
      withProvisionalRow(r.remove, async () => {
        throw new Error("offline")
      }),
    ).rejects.toThrow("offline")
    expect(r.removed).toEqual([])
  })

  it("deletes a row a run opened but returned early from", async () => {
    const r = recorder()
    await withProvisionalRow(r.remove, async (row) => {
      row.opened("s1")
    })
    expect(r.removed).toEqual(["s1"])
  })

  it("reports the run's failure, not the delete's", async () => {
    const run = withProvisionalRow(
      async () => {
        throw new Error("delete failed")
      },
      async (row) => {
        row.opened("s1")
        throw new Error("model down")
      },
    )
    await expect(run).rejects.toThrow("model down")
  })
})

describe("frozenScope", () => {
  const scope = { startDate: 1, endDate: 2 }

  it("selects by the frozen window, keeping the filters", () => {
    expect(
      frozenScope({ ...scope, keyword: "x" }, { start: 10, end: 20 }),
    ).toEqual({
      startDate: 1,
      endDate: 2,
      keyword: "x",
      window: { mode: "fixed", start: 10, end: 20 },
    })
  })

  it("leaves the scope alone with nothing frozen, and the semantic path alone always", () => {
    expect(frozenScope(scope, null)).toBe(scope)
    expect(frozenScope(undefined, { start: 10, end: 20 })).toBeUndefined()
  })
})

it("searchFilterExtra drops empty filters but keeps the channel switch", () => {
  expect(
    searchFilterExtra({
      postSearch: "",
      semanticSearchQuery: "war",
      semanticSearchRespectsChannels: false,
    }),
  ).toEqual({
    postSearch: undefined,
    semanticSearchQuery: "war",
    semanticSearchRespectsChannels: false,
  })
})

it("errorText uses an Error's message, else the fallback", () => {
  expect(errorText(new Error("boom"), "fallback")).toBe("boom")
  expect(errorText("boom", "fallback")).toBe("fallback")
})

it("readStream accumulates the text, reports it per chunk, and keeps the last chunk", async () => {
  async function* chunks() {
    yield { text: "Good" }
    yield { text: " day" }
  }
  const seen: string[] = []
  const result = await readStream(chunks(), (t) => seen.push(t))
  expect(result).toEqual({ text: "Good day", lastChunk: { text: " day" } })
  expect(seen).toEqual(["Good", "Good day"])
})

describe("promptPosts", () => {
  const post = { channelName: "chan", id: 1, date: "d", text: "hi" } as Post
  const noCounts = async (): Promise<Record<string, number>> => {
    throw new Error("the semantic path must not ask the server to count")
  }

  it("formats the posts this browser holds on the semantic path", async () => {
    const result = await promptPosts({ posts: [post] }, ["chan"], noCounts)
    expect(result.posts).toEqual([post])
    expect(result.postCount).toBe(1)
    expect(result.postsText).toContain("[chan] ID: 1")
    expect(result.scope).toBeUndefined()
  })

  it("sends the scope and sums the server's per-channel counts", async () => {
    const asked: PostScopeQuery[] = []
    const result = await promptPosts(
      { scope: { startDate: 1, endDate: 2 } },
      ["a", "b"],
      async (q) => {
        asked.push(q)
        return { a: 3, b: 4 }
      },
    )
    expect(result).toEqual({
      scope: { startDate: 1, endDate: 2 },
      postsText: "",
      postCount: 7,
    })
    expect(asked).toEqual([
      { channelNames: ["a", "b"], startDate: 1, endDate: 2 },
    ])
  })

  it("counts inside the frozen window when there is one", async () => {
    const asked: PostScopeQuery[] = []
    const result = await promptPosts(
      { scope: { startDate: 1, endDate: 2 } },
      ["a"],
      async (q) => {
        asked.push(q)
        return {}
      },
      { start: 10, end: 20 },
    )
    const window = { mode: "fixed" as const, start: 10, end: 20 }
    expect(result.scope?.window).toEqual(window)
    expect(result.postCount).toBe(0)
    expect(asked[0]).toMatchObject({ window })
  })
})
