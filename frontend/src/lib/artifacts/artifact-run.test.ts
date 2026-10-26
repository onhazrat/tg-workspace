import { describe, expect, it } from "bun:test"
import { QueryClient } from "@tanstack/react-query"
import { emptyPostFilter } from "@/lib/posts/post-filter"
import { DEFAULT_SELECTION } from "@/lib/posts/post-selection"
import { NO_RANKING, type PostsView } from "@/lib/posts/posts-view"
import {
  errorText,
  readStream,
  searchFilterExtra,
  selectedPostCount,
  selectedScopeCounts,
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
      keyword: "",
      ranking: { kind: "meaning", query: "war" },
      respectsChannels: false,
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

describe("selectedPostCount: the no-Posts-selected check (PVM-02)", () => {
  const view: PostsView = {
    scopeChannelNames: ["a", "b"],
    channelNames: ["a"],
    keyword: "",
    ranking: NO_RANKING,
    respectsChannels: false,
    filter: emptyPostFilter(),
    maxPerChannel: 0,
    maxPerChannelMode: "ordered",
    sort: "newest",
    groupByChannel: false,
    viewMeasure: "estimated",
    startDate: 60_000,
    endDate: 120_000,
    windowKey: { mode: "fixed", start: 60_000, end: 120_000 },
    selection: DEFAULT_SELECTION,
    selectionRevision: 3,
  }
  const answer = (selected: Record<string, number>) => ({
    counts: {},
    selected,
    selectedShown: {},
    tooNewToJudge: 0,
  })

  it("sums the selected Posts of the view's Scope counts read", async () => {
    const asked: unknown[] = []
    const count = await selectedPostCount(
      new QueryClient(),
      view,
      async (body) => {
        asked.push(body)
        return answer({ a: 3, b: 4 })
      },
    )
    expect(count).toBe(7)
    expect(asked).toEqual([
      {
        channelNames: ["a", "b"],
        window: { mode: "fixed", start: 60_000, end: 120_000 },
        selection: DEFAULT_SELECTION,
      },
    ])
  })

  it("per Channel, as Trim selection reads them, from the same read", async () => {
    const counts = await selectedScopeCounts(
      new QueryClient(),
      view,
      async () => answer({ a: 3, b: 4 }),
    )
    expect(counts).toEqual({ a: 3, b: 4 })
  })

  it("no Posts selected is zero", async () => {
    const count = await selectedPostCount(new QueryClient(), view, async () =>
      answer({ a: 0, b: 0 }),
    )
    expect(count).toBe(0)
  })

  it("reads fresh: counts cached a moment ago are fetched again", async () => {
    // The Posts reads hold their answers for a while; this check must not,
    // or a selection changed just before a Generate is counted as it was.
    const queryClient = new QueryClient()
    const read = async () => answer({ a: 5 })
    await selectedPostCount(queryClient, view, read)
    const count = await selectedPostCount(queryClient, view, async () =>
      answer({ a: 0 }),
    )
    expect(count).toBe(0)
  })
})
