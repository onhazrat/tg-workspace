import { describe, expect, it } from "bun:test"
import type { PostScopeQuery } from "@/api/data"
import { DEFAULT_SELECTION } from "@/lib/posts/post-selection"
import {
  errorText,
  promptPosts,
  readStream,
  searchFilterExtra,
  withMissingPosts,
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

it("withMissingPosts stores a count above zero and never a zero", () => {
  expect(withMissingPosts(3)).toEqual({ missingPosts: 3 })
  expect(withMissingPosts(0)).toEqual({})
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
  it("counts what the Posts tab selects, summing the server's per-channel counts", async () => {
    const asked: PostScopeQuery[] = []
    const result = await promptPosts(
      { scope: { startDate: 1, endDate: 2, selection: DEFAULT_SELECTION } },
      ["a", "b"],
      async (q) => {
        asked.push(q)
        return { a: 3, b: 4 }
      },
    )
    expect(result).toEqual({ postCount: 7 })
    expect(asked).toEqual([
      {
        channelNames: ["a", "b"],
        startDate: 1,
        endDate: 2,
        selection: DEFAULT_SELECTION,
      },
    ])
  })
})
