import { describe, expect, test } from "bun:test"

import {
  type DiscoveryCandidate,
  filterDiscoveryCandidates,
  sortDiscoveryCandidates,
} from "@/lib/posts/discover-candidates"

/*
 * Sorting and result filtering only.
 *
 * The candidate aggregation these used to cover now exists solely in
 * `backend/app/services/discover.py`; its cases live in
 * `backend/tests/services/test_discover_candidates.py` (IDEA-011 D14).
 * `deriveDiscoveryEmptyReason` is covered by `discover-empty-reason.test.ts`.
 */

describe("sortDiscoveryCandidates", () => {
  const candidates: DiscoveryCandidate[] = [
    {
      name: "manyForwards",
      counts: { forward: 5, mention: 0, link: 0 },
      total: 5,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 100,
      isFollowed: false,
      samplePost: { channelName: "only", postId: 1, timestamp: 100 },
    },
    {
      name: "wideSpread",
      counts: { forward: 0, mention: 3, link: 0 },
      total: 3,
      seenIn: [],
      seenInCount: 3,
      lastSeen: 900,
      isFollowed: true,
      samplePost: { channelName: "a", postId: 10, timestamp: 900 },
    },
    {
      name: "linkOnly",
      counts: { forward: 0, mention: 0, link: 4 },
      total: 4,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 50,
      isFollowed: false,
      samplePost: { channelName: "x", postId: 20, timestamp: 50 },
    },
  ]

  test("total desc is the default", () => {
    expect(sortDiscoveryCandidates(candidates).map((c) => c.name)).toEqual([
      "manyForwards",
      "linkOnly",
      "wideSpread",
    ])
  })

  test("sorts by a single signal kind", () => {
    expect(
      sortDiscoveryCandidates(candidates, "mention").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
    expect(
      sortDiscoveryCandidates(candidates, "link").map((c) => c.name),
    ).toEqual(["linkOnly", "manyForwards", "wideSpread"])
  })

  test("sorts by lastSeen and seenInCount", () => {
    expect(
      sortDiscoveryCandidates(candidates, "lastSeen").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
    expect(
      sortDiscoveryCandidates(candidates, "seenInCount").map((c) => c.name),
    ).toEqual(["wideSpread", "manyForwards", "linkOnly"])
  })
})

describe("filterDiscoveryCandidates", () => {
  const candidates: DiscoveryCandidate[] = [
    {
      name: "alpha_news",
      displayName: "Alpha News",
      counts: { forward: 5, mention: 0, link: 0 },
      total: 5,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 100,
      isFollowed: false,
      samplePost: { channelName: "a", postId: 1, timestamp: 100 },
    },
    {
      name: "beta_wire",
      counts: { forward: 0, mention: 1, link: 0 },
      total: 1,
      seenIn: [],
      seenInCount: 1,
      lastSeen: 200,
      isFollowed: true,
      samplePost: { channelName: "b", postId: 2, timestamp: 200 },
    },
  ]

  const base = { followState: "all" as const, minTotal: 1, nameQuery: "" }

  test("minTotal drops low-signal noise", () => {
    expect(
      filterDiscoveryCandidates(candidates, { ...base, minTotal: 2 }).map(
        (c) => c.name,
      ),
    ).toEqual(["alpha_news"])
  })

  test("followState narrows to followed or unfollowed", () => {
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        followState: "unfollowed",
      }).map((c) => c.name),
    ).toEqual(["alpha_news"])
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        followState: "followed",
      }).map((c) => c.name),
    ).toEqual(["beta_wire"])
  })

  test("nameQuery matches handle and display name", () => {
    expect(
      filterDiscoveryCandidates(candidates, { ...base, nameQuery: "beta" }).map(
        (c) => c.name,
      ),
    ).toEqual(["beta_wire"])
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        nameQuery: "nomatch",
      }),
    ).toEqual([])
    // display name matches case-insensitively
    expect(
      filterDiscoveryCandidates(candidates, {
        ...base,
        nameQuery: "Alpha N",
      }).map((c) => c.name),
    ).toEqual(["alpha_news"])
  })
})
