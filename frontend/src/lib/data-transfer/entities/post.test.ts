/**
 * The post export's paging loop (A2).
 *
 * The export used to call the feed **once, with no `limit`**, and treat what
 * came back as the whole corpus. It is not — `PostFeedRequest.limit` defaults to
 * 500 server-side, so the file silently stopped at 500 posts while the
 * IndexedDB branch of the same function wrote every post the browser held. The
 * two branches disagreed by however many posts the operator had, and nothing in
 * either file said which one you got.
 *
 * `backend/tests/api/test_export_paging.py` pins the server behaviour these
 * page against; this file pins the loop itself, including the two conditions
 * that are easy to get wrong: a page that is exactly full is *not* the end, and
 * the loop must terminate rather than growing the browser until it dies.
 */

import { describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import { api } from "@/api"
import type { PostFeedQuery } from "@/api/data"
import type { CommandContext } from "@/lib/commands/types"
import {
  EXPORT_PAGE_SIZE,
  fetchAllPostsFromServer,
  listPostsForFilter,
} from "@/lib/data-transfer/entities/post"
import type { ExportFilter } from "@/lib/data-transfer/types"
import type { Post } from "@/types"

function post(id: number): Post {
  return {
    id,
    channelName: "alpha",
    text: `post ${id}`,
    timestamp: id,
    date: "",
  } as Post
}

/** A fake server holding `total` posts, paging exactly as the real one does. */
function fakeFeed(total: number) {
  const calls: PostFeedQuery[] = []
  const all = Array.from({ length: total }, (_, i) => post(i + 1))
  const fetchPage = async (query: PostFeedQuery) => {
    calls.push(query)
    const offset = query.offset ?? 0
    const limit = query.limit ?? all.length
    return all.slice(offset, offset + limit)
  }
  return { calls, fetchPage, all }
}

describe("fetchAllPostsFromServer", () => {
  test("pages past the server's default page size", async () => {
    // The bug, stated directly: one un-limited call would have returned 500.
    const { fetchPage } = fakeFeed(EXPORT_PAGE_SIZE + 750)

    const result = await fetchAllPostsFromServer(
      ["alpha"],
      0,
      999,
      () => {},
      fetchPage,
    )

    expect(result.length).toBe(EXPORT_PAGE_SIZE + 750)
  })

  test("asks for the largest page the server allows", async () => {
    const { calls, fetchPage } = fakeFeed(10)

    await fetchAllPostsFromServer(["alpha"], 100, 200, () => {}, fetchPage)

    expect(calls.length).toBe(1)
    expect(calls[0].limit).toBe(EXPORT_PAGE_SIZE)
    expect(calls[0].offset).toBe(0)
    expect(calls[0].channelNames).toEqual(["alpha"])
    expect(calls[0].startDate).toBe(100)
    expect(calls[0].endDate).toBe(200)
  })

  test("advances the offset by a whole page each time", async () => {
    const { calls, fetchPage } = fakeFeed(EXPORT_PAGE_SIZE * 2 + 1)

    await fetchAllPostsFromServer(undefined, 0, 999, () => {}, fetchPage)

    expect(calls.map((c) => c.offset)).toEqual([
      0,
      EXPORT_PAGE_SIZE,
      EXPORT_PAGE_SIZE * 2,
    ])
  })

  test("returns every post exactly once, in order", async () => {
    const { fetchPage, all } = fakeFeed(EXPORT_PAGE_SIZE + 3)

    const result = await fetchAllPostsFromServer(
      undefined,
      0,
      999,
      () => {},
      fetchPage,
    )

    expect(result.map((p) => p.id)).toEqual(all.map((p) => p.id))
    expect(new Set(result.map((p) => p.id)).size).toBe(all.length)
  })

  test("a short page ends the loop", async () => {
    const { calls, fetchPage } = fakeFeed(3)

    const result = await fetchAllPostsFromServer(
      undefined,
      0,
      999,
      () => {},
      fetchPage,
    )

    expect(result.length).toBe(3)
    expect(calls.length).toBe(1)
  })

  test("an exactly-full page is not the end", async () => {
    // The off-by-one. Stopping on a full page loses nothing when the corpus is
    // an exact multiple *and* the caller is lucky; it loses everything after
    // the first page otherwise. One extra empty request is the correct cost.
    const { calls, fetchPage } = fakeFeed(EXPORT_PAGE_SIZE)

    const result = await fetchAllPostsFromServer(
      undefined,
      0,
      999,
      () => {},
      fetchPage,
    )

    expect(result.length).toBe(EXPORT_PAGE_SIZE)
    expect(calls.length).toBe(2)
  })

  test("an empty corpus makes one request and returns nothing", async () => {
    const { calls, fetchPage } = fakeFeed(0)

    expect(
      await fetchAllPostsFromServer(undefined, 0, 999, () => {}, fetchPage),
    ).toEqual([])
    expect(calls.length).toBe(1)
  })

  test("a server that never returns a short page raises rather than looping", async () => {
    // Guards the failure mode this whole workstream exists to prevent: a
    // browser that grows until it dies. A bounded loop turns it into an error.
    const fetchPage = async (query: PostFeedQuery) =>
      Array.from({ length: query.limit ?? EXPORT_PAGE_SIZE }, (_, i) => post(i))

    await expect(
      fetchAllPostsFromServer(undefined, 0, 999, () => {}, fetchPage),
    ).rejects.toThrow(/exceeded .* pages/)
  })

  test("reports cumulative progress, not per-page counts", async () => {
    const { fetchPage } = fakeFeed(EXPORT_PAGE_SIZE + 7)
    const progress: number[] = []

    await fetchAllPostsFromServer(
      undefined,
      0,
      999,
      (fetched) => progress.push(fetched),
      fetchPage,
    )

    expect(progress).toEqual([EXPORT_PAGE_SIZE, EXPORT_PAGE_SIZE + 7])
  })
})

/**
 * Which posts an export asks for. `selected` is the selection inside the
 * Posts-tab window; `all` is every channel over all time, whatever window the
 * tab has; an empty selection asks for nothing rather than for everything.
 */
describe("listPostsForFilter", () => {
  async function list(
    filter: ExportFilter,
    ctx: Partial<CommandContext>,
    answer: Post[] | Error = [post(1)],
  ) {
    const original = api.getPostsFeed
    const dismiss = spyOn(toast, "dismiss")
    const info = spyOn(toast, "info")
    const calls: PostFeedQuery[] = []
    api.getPostsFeed = (async (query: PostFeedQuery) => {
      calls.push(query)
      if (answer instanceof Error) throw answer
      return answer
    }) as never
    try {
      const result = await listPostsForFilter(
        filter,
        ctx as CommandContext,
      ).catch((err: Error) => err)
      return { result, calls, dismissed: dismiss.mock.calls.length }
    } finally {
      api.getPostsFeed = original
      dismiss.mockRestore()
      info.mockRestore()
    }
  }
  const window = { startDate: 100, endDate: 200 }

  test("selected asks for the selection inside the Posts-tab window", async () => {
    const { result, calls } = await list("selected", {
      selectedChannels: new Set(["alpha"]),
      postDateRange: window,
    })
    expect(result).toEqual([post(1)])
    expect(calls[0]).toMatchObject({ channelNames: ["alpha"], ...window })
  })

  test("all ignores the selection and the window", async () => {
    const { calls } = await list("all", {
      selectedChannels: new Set(["alpha"]),
      postDateRange: window,
    })
    expect(calls[0].channelNames).toBeUndefined()
    expect(calls[0].startDate).toBe(0)
    expect(calls[0].endDate).toBeGreaterThan(Date.now())
  })

  test("an empty selection asks for nothing", async () => {
    const { result, calls } = await list("selected", {
      selectedChannels: new Set(),
    })
    expect(result).toEqual([])
    expect(calls).toEqual([])
  })

  test("the progress toast is dismissed even when the fetch fails", async () => {
    const { result, dismissed } = await list(
      "selected",
      { selectedChannels: new Set(["alpha"]) },
      new Error("offline"),
    )
    expect(result).toBeInstanceOf(Error)
    expect(dismissed).toBe(1)
  })
})
