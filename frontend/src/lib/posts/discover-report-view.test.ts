import { describe, expect, test } from "bun:test"
import type { DiscoverReport, DiscoverReportScope } from "@/api/data"
import {
  DISCOVERY_SIGNAL_KINDS,
  type DiscoveryCandidate,
} from "./discover-candidates"
import { reportSignalKinds, savedReportToView } from "./discover-report-view"

const scope: DiscoverReportScope = {
  channels: ["carrier"],
  startDate: 1000,
  endDate: 2000,
  signals: ["forward"],
  keyword: null,
  forwarded: "all",
  media: "all",
  maxPerChannel: 0,
}

const candidate: DiscoveryCandidate = {
  name: "alpha_news",
  displayName: "Alpha News",
  counts: { forward: 2, mention: 0, link: 0 },
  total: 2,
  seenIn: [
    {
      channelName: "carrier",
      counts: { forward: 2, mention: 0, link: 0 },
      total: 2,
    },
  ],
  seenInCount: 1,
  lastSeen: 1500,
  isFollowed: false,
  samplePost: { channelName: "carrier", postId: 7, timestamp: 1500 },
}

const report: DiscoverReport = {
  id: "report-1",
  scope,
  scopeCounts: { forwardPosts: 2, mentionPosts: 0, linkPosts: 0 },
  postsInScope: 5,
  timestamp: 9000,
  candidateCount: 1,
  candidates: [candidate],
}

describe("savedReportToView", () => {
  test("carries the id and timestamp so the UI can identify the report", () => {
    const view = savedReportToView(report)
    expect(view.id).toBe("report-1")
    expect(view.timestamp).toBe(9000)
    expect(view.candidates).toEqual([candidate])
    expect(view.postsInScope).toBe(5)
  })
})

describe("reportSignalKinds", () => {
  test("reads the kinds the report was generated with, not live settings", () => {
    const view = savedReportToView(report)
    expect([...reportSignalKinds(view, DISCOVERY_SIGNAL_KINDS)]).toEqual([
      "forward",
    ])
  })

  test("an empty stored list means all kinds, matching the server default", () => {
    const view = savedReportToView({
      ...report,
      scope: { ...scope, signals: [] },
    })
    expect(reportSignalKinds(view, DISCOVERY_SIGNAL_KINDS).size).toBe(
      DISCOVERY_SIGNAL_KINDS.length,
    )
  })

  test("ignores unknown stored kinds rather than trusting them", () => {
    const view = savedReportToView({
      ...report,
      scope: { ...scope, signals: ["forward", "telepathy"] },
    })
    expect([...reportSignalKinds(view, DISCOVERY_SIGNAL_KINDS)]).toEqual([
      "forward",
    ])
  })
})
