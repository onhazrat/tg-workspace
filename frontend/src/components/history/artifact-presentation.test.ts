import { describe, expect, it } from "bun:test"

import type { ArtifactListItem } from "@/types"

import {
  ARTIFACT_KIND_LABELS,
  artifactDetail,
  isPendingArtifact,
} from "./artifact-presentation"

const base = {
  id: "x",
  title: "t",
  channels: ["a"],
  startDate: 0,
  endDate: 0,
  timestamp: 1,
  isStarred: false,
}

describe("artifactDetail", () => {
  it("reports a pending summary as awaiting rather than as zero posts", () => {
    const pending = {
      ...base,
      kind: "summary",
      status: "pending",
    } as ArtifactListItem
    expect(artifactDetail(pending)).toBe("Awaiting response")
  })

  it("names the chat mode, not the stored value", () => {
    const chat = {
      ...base,
      kind: "chat",
      messageCount: 4,
      mode: "semantic",
    } as ArtifactListItem
    // `full_scope`/`semantic` are wire values; the glossary labels are what a
    // person reads.
    expect(artifactDetail(chat)).toBe("4 messages · Semantic")
  })

  it("covers every kind", () => {
    const kinds = Object.keys(ARTIFACT_KIND_LABELS)
    for (const kind of kinds) {
      const row = { ...base, kind } as ArtifactListItem
      expect(artifactDetail(row)).toBeString()
    }
  })
})

describe("isPendingArtifact", () => {
  it("is false for kinds that have no pending state", () => {
    const chat = { ...base, kind: "chat", messageCount: 0 } as ArtifactListItem
    const discovery = {
      ...base,
      kind: "discovery",
      candidateCount: 0,
    } as ArtifactListItem
    expect(isPendingArtifact(chat)).toBe(false)
    expect(isPendingArtifact(discovery)).toBe(false)
  })
})
