import { describe, expect, it } from "bun:test"

import type { ArtifactListItem } from "@/types"

import {
  ARTIFACT_KIND_LABELS,
  artifactDetail,
  artifactName,
  channelsMatchingFirst,
  failedAttempts,
  isPendingArtifact,
  plainTitle,
} from "./artifact-presentation"

describe("artifactName", () => {
  const item = (over: Record<string, unknown>) =>
    ({ kind: "tag", ...over }) as unknown as ArtifactListItem

  it("is the kind and the title, or the Channels when it has none", () => {
    expect(artifactName(item({ title: "Weekly" }))).toBe("Tag run: Weekly")
    expect(artifactName(item({ title: "", scope: { channels: ["a"] } }))).toBe(
      "Tag run: a",
    )
  })

  it("cuts a long title at 40 characters", () => {
    expect(artifactName(item({ title: "x".repeat(41) }))).toBe(
      `Tag run: ${"x".repeat(40)}…`,
    )
    expect(artifactName(item({ title: "x".repeat(40) }))).toBe(
      `Tag run: ${"x".repeat(40)}`,
    )
  })
})

const base = {
  id: "x",
  title: "t",
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

  it("counts a Failed summary's failed attempts", () => {
    const failed = (n: number) =>
      ({
        ...base,
        kind: "summary",
        status: "failed",
        failedAttempts: n,
      }) as ArtifactListItem
    expect(artifactDetail(failed(1))).toBe("1 failed attempt")
    expect(artifactDetail(failed(3))).toBe("3 failed attempts")
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

describe("failedAttempts", () => {
  it("is the count for a Failed summary, and null for anything else", () => {
    const summary = { ...base, kind: "summary", failedAttempts: 2 }
    expect(
      failedAttempts({ ...summary, status: "failed" } as ArtifactListItem),
    ).toBe(2)
    expect(
      failedAttempts({ ...summary, status: "pending" } as ArtifactListItem),
    ).toBeNull()
    expect(
      failedAttempts({
        ...base,
        kind: "tag",
        status: "failed",
      } as ArtifactListItem),
    ).toBeNull()
  })
})

describe("plainTitle", () => {
  it("drops markdown emphasis, code marks and a leading heading", () => {
    expect(plainTitle("## **Iran** and `oil` __today__")).toBe(
      "Iran and oil today",
    )
  })

  it("drops a leading emoji and the whitespace around it", () => {
    expect(plainTitle("  📰 ️ Morning brief")).toBe("Morning brief")
  })

  it("keeps an emoji that is not leading, and plain text as it is", () => {
    expect(plainTitle("Markets 📈 up")).toBe("Markets 📈 up")
    expect(plainTitle("خلاصه اخبار")).toBe("خلاصه اخبار")
  })
})

describe("channelsMatchingFirst", () => {
  const channels = ["alpha", "bravo_news", "charlie", "news_delta"]

  it("keeps Scope order with no search", () => {
    expect(channelsMatchingFirst(channels, "")).toEqual(channels)
    expect(channelsMatchingFirst(channels, "  ")).toEqual(channels)
  })

  it("moves matches to the front, each part in Scope order", () => {
    expect(channelsMatchingFirst(channels, " NEWS ")).toEqual([
      "bravo_news",
      "news_delta",
      "alpha",
      "charlie",
    ])
  })
})
