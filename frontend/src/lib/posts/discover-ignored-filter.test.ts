import { describe, expect, test } from "bun:test"
import {
  type DiscoveryCandidate,
  filterDiscoveryCandidates,
} from "./discover-candidates"

function candidate(
  name: string,
  flags: { isFollowed?: boolean; isIgnored?: boolean } = {},
): DiscoveryCandidate {
  return {
    name,
    counts: { forward: 2, mention: 0, link: 0 },
    total: 2,
    seenIn: [],
    seenInCount: 1,
    lastSeen: 100,
    isFollowed: flags.isFollowed ?? false,
    isIgnored: flags.isIgnored,
    samplePost: { channelName: "carrier", postId: 1, timestamp: 100 },
  }
}

const plain = candidate("plain")
const dismissed = candidate("dismissed", { isIgnored: true })
const followedAndDismissed = candidate("followedDismissed", {
  isFollowed: true,
  isIgnored: true,
})

const base = { minTotal: 1, nameQuery: "" }

describe("filterDiscoveryCandidates — dismissed candidates", () => {
  test("dismissed candidates are hidden from All", () => {
    expect(
      filterDiscoveryCandidates([plain, dismissed], {
        ...base,
        followState: "all",
      }).map((c) => c.name),
    ).toEqual(["plain"])
  })

  test("Ignored shows only dismissed candidates", () => {
    expect(
      filterDiscoveryCandidates([plain, dismissed], {
        ...base,
        followState: "ignored",
      }).map((c) => c.name),
    ).toEqual(["dismissed"])
  })

  test("Unfollowed excludes dismissed candidates too", () => {
    // Otherwise dismissing would not reduce the list you actually work from.
    expect(
      filterDiscoveryCandidates([plain, dismissed], {
        ...base,
        followState: "unfollowed",
      }).map((c) => c.name),
    ).toEqual(["plain"])
  })

  test("Followed excludes dismissed candidates too", () => {
    const followed = candidate("followed", { isFollowed: true })
    expect(
      filterDiscoveryCandidates([followed, followedAndDismissed], {
        ...base,
        followState: "followed",
      }).map((c) => c.name),
    ).toEqual(["followed"])
  })

  test("Ignored ignores follow state, showing dismissed followed channels", () => {
    expect(
      filterDiscoveryCandidates([dismissed, followedAndDismissed], {
        ...base,
        followState: "ignored",
      }).map((c) => c.name),
    ).toEqual(["dismissed", "followedDismissed"])
  })

  test("an absent isIgnored is treated as not dismissed", () => {
    // Reports created before D8 have no such field on their candidate rows.
    const legacy = candidate("legacy")
    expect(legacy.isIgnored).toBeUndefined()
    expect(
      filterDiscoveryCandidates([legacy], { ...base, followState: "all" }).map(
        (c) => c.name,
      ),
    ).toEqual(["legacy"])
  })

  test("the other filters still apply within Ignored", () => {
    const lowHits: DiscoveryCandidate = {
      ...candidate("lowHits", { isIgnored: true }),
      counts: { forward: 1, mention: 0, link: 0 },
      total: 1,
    }
    expect(
      filterDiscoveryCandidates([dismissed, lowHits], {
        ...base,
        minTotal: 2,
        followState: "ignored",
      }).map((c) => c.name),
    ).toEqual(["dismissed"])
  })
})
