import { describe, expect, test } from "bun:test"
import {
  type DiscoverFollowState,
  type DiscoverProbeKind,
  type DiscoverProbeStatus,
  type DiscoveryCandidate,
  filterDiscoveryCandidates,
  isProbedUnavailable,
} from "./discover-candidates"

function candidate(
  name: string,
  flags: {
    isFollowed?: boolean
    isIgnored?: boolean
    probe?: { status: DiscoverProbeStatus; kind?: DiscoverProbeKind } | null
  } = {},
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
    probe:
      flags.probe === undefined || flags.probe === null
        ? flags.probe
        : {
            handle: name,
            status: flags.probe.status,
            kind: flags.probe.kind ?? "unknown",
            displayName: null,
            bio: null,
            subscribers: null,
            photoUrl: null,
            attempts: 0,
            lastError: null,
            checkedAt: 1000,
          },
    samplePost: { channelName: "carrier", postId: 1, timestamp: 100 },
  }
}

const unprobed = candidate("unprobed")
const followable = candidate("followable", { probe: { status: "ok" } })
const bot = candidate("bot", { probe: { status: "unavailable", kind: "bot" } })
const inconclusive = candidate("inconclusive", { probe: { status: "unknown" } })
const dismissed = candidate("dismissed", { isIgnored: true })
const dismissedAndBot = candidate("both", {
  isIgnored: true,
  probe: { status: "unavailable", kind: "bot" },
})

const ALL = [
  unprobed,
  followable,
  bot,
  inconclusive,
  dismissed,
  dismissedAndBot,
]

function names(followState: Parameters<typeof filter>[0]): string[] {
  return filter(followState).map((c) => c.name)
}

function filter(followState: DiscoverFollowState): DiscoveryCandidate[] {
  return filterDiscoveryCandidates(ALL, {
    followState,
    minTotal: 1,
    nameQuery: "",
  })
}

describe("probe verdicts hide rows from the ordinary views", () => {
  test("a confirmed-unfollowable handle is hidden from All", () => {
    expect(names("all")).not.toContain("bot")
  })

  test("an unprobed handle stays visible", () => {
    // The sweep is asynchronous, so most of a fresh report is unprobed.
    expect(names("all")).toContain("unprobed")
  })

  test("an inconclusive probe does not hide a row", () => {
    // Absence of evidence is not evidence: a timeout must not hide a channel.
    expect(names("all")).toContain("inconclusive")
  })

  test("a handle confirmed followable stays visible", () => {
    expect(names("all")).toContain("followable")
  })

  test("the unfollowed view also excludes unfollowable handles", () => {
    expect(names("unfollowed")).toEqual([
      "unprobed",
      "followable",
      "inconclusive",
    ])
  })
})

describe("the Not followable view is its own home", () => {
  test("it shows only concluded-unavailable rows", () => {
    expect(names("unavailable")).toEqual(["bot"])
  })

  test("it excludes unprobed and inconclusive rows", () => {
    expect(names("unavailable")).not.toContain("unprobed")
    expect(names("unavailable")).not.toContain("inconclusive")
  })
})

describe("probe verdicts and dismissals stay separate", () => {
  test("a dismissal does not appear under Not followable", () => {
    expect(names("unavailable")).not.toContain("dismissed")
  })

  test("a probe verdict does not appear under Ignored", () => {
    expect(names("ignored")).not.toContain("bot")
  })

  test("a row that is both appears only under Ignored", () => {
    // The deliberate act wins, so the two lists stay disjoint and neither
    // count is partly explained by the other.
    expect(names("ignored")).toContain("both")
    expect(names("unavailable")).not.toContain("both")
  })
})

describe("isProbedUnavailable", () => {
  test("only a concluded verdict counts", () => {
    expect(isProbedUnavailable(bot)).toBe(true)
    expect(isProbedUnavailable(followable)).toBe(false)
    expect(isProbedUnavailable(inconclusive)).toBe(false)
    expect(isProbedUnavailable(unprobed)).toBe(false)
  })
})
