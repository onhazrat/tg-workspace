import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { resetInFlight } from "@/lib/singleFlight"
import type { Post } from "@/types"
import { bulkUpsertPosts, getPost, lookupPosts, type PostsApi } from "./store"

/**
 * The narrow-lookup path that survived A1.
 *
 * Bulk post reading left the browser in A1; what remains is resolving specific
 * posts by natural key, which citations and RAG context assembly need. Two
 * things are load-bearing: **batching at 200** (the server rejects more —
 * `MAX_POST_LOOKUP_BATCH`), and **de-duplication keyed on the sorted ref list**,
 * because a rendered summary hovers the same citations repeatedly and in no
 * particular order.
 */

let lookupCalls: Array<{ channelName: string; postId: number }[]> = []
let upserted: Post[][] = []
let known = new Set<string>()

const post = (channelName: string, postId: number): Post =>
  ({ id: `${channelName}#${postId}`, channelName, postId }) as unknown as Post

const fakeApi = {
  lookupPosts: async (refs: { channelName: string; postId: number }[]) => {
    lookupCalls.push(refs)
    return refs
      .filter((r) => known.has(`${r.channelName}#${r.postId}`))
      .map((r) => post(r.channelName, r.postId))
  },
  bulkUpsertPosts: async (posts: Post[]) => {
    upserted.push(posts)
    return { upserted: posts.length }
  },
} as unknown as PostsApi

const refs = (n: number, channel = "alpha") =>
  Array.from({ length: n }, (_, i) => ({ channelName: channel, postId: i }))

beforeEach(() => {
  lookupCalls = []
  upserted = []
  known = new Set(refs(600).map((r) => `${r.channelName}#${r.postId}`))
  resetInFlight()
})

afterEach(() => {
  resetInFlight()
})

describe("lookupPosts", () => {
  /**
   * Mutation testing showed the `refs.length === 0` early return is **not** what
   * makes this true: the batching loop runs zero times for zero refs, so
   * deleting the guard still issues no request. The guard's only job is to skip
   * registering a de-dup key on a component that renders empty often. Asserting
   * the observable behaviour rather than pretending to test the guard.
   */
  it("makes no request for an empty ref list", async () => {
    expect(await lookupPosts([], fakeApi)).toEqual([])
    expect(lookupCalls).toHaveLength(0)
  })

  it("sends one request for a batch at the limit", async () => {
    await lookupPosts(refs(200), fakeApi)

    expect(lookupCalls).toHaveLength(1)
    expect(lookupCalls[0]).toHaveLength(200)
  })

  it("splits past the limit rather than sending an oversized batch", async () => {
    await lookupPosts(refs(450), fakeApi)

    // The server rejects a batch over MAX_POST_LOOKUP_BATCH outright.
    expect(lookupCalls.map((c) => c.length)).toEqual([200, 200, 50])
  })

  it("returns every batch flattened, in order", async () => {
    const found = await lookupPosts(refs(450), fakeApi)

    expect(found).toHaveLength(450)
    expect(found[0].channelName).toBe("alpha")
  })

  it("omits refs the server does not know about", async () => {
    known = new Set(["alpha#1"])

    const found = await lookupPosts(
      [
        { channelName: "alpha", postId: 1 },
        { channelName: "alpha", postId: 2 },
      ],
      fakeApi,
    )

    expect(found.map((p) => p.postId)).toEqual([1])
  })

  it("de-duplicates concurrent lookups of the same refs", async () => {
    await Promise.all([
      lookupPosts(refs(3), fakeApi),
      lookupPosts(refs(3), fakeApi),
    ])

    expect(lookupCalls).toHaveLength(1)
  })

  it("de-duplicates the same refs given in a different order", async () => {
    const a = [
      { channelName: "alpha", postId: 1 },
      { channelName: "alpha", postId: 2 },
    ]
    const b = [...a].reverse()

    await Promise.all([lookupPosts(a, fakeApi), lookupPosts(b, fakeApi)])

    // The key sorts, because a rendered summary hovers the same citations in
    // whatever order the reader happens to move.
    expect(lookupCalls).toHaveLength(1)
  })

  it("does NOT merge lookups of different refs", async () => {
    await Promise.all([
      lookupPosts([{ channelName: "alpha", postId: 1 }], fakeApi),
      lookupPosts([{ channelName: "alpha", postId: 2 }], fakeApi),
    ])

    expect(lookupCalls).toHaveLength(2)
  })
})

describe("getPost", () => {
  it("resolves one post through the batched lookup", async () => {
    const found = await getPost("alpha", 1, fakeApi)

    expect(found?.postId).toBe(1)
    expect(lookupCalls).toEqual([[{ channelName: "alpha", postId: 1 }]])
  })

  it("returns undefined for a post the server does not have", async () => {
    known = new Set()

    // `CitationHover` renders this as "unavailable"; there is no mirror to
    // fall back to any more.
    expect(await getPost("alpha", 999, fakeApi)).toBeUndefined()
  })
})

describe("bulkUpsertPosts", () => {
  it("passes the batch straight through", async () => {
    const batch = [post("alpha", 1), post("alpha", 2)]

    await bulkUpsertPosts(batch, fakeApi)

    expect(upserted).toEqual([batch])
  })
})
