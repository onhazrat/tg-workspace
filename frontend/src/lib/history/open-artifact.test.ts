import { describe, expect, it } from "bun:test"

import type { ArtifactListItem } from "@/types"

import { artifactDestination } from "./open-artifact"

describe("artifactDestination", () => {
  const kinds = ["summary", "chat", "tag", "discovery"] as const

  it("sends every kind to a distinct tab and param", () => {
    const seen = kinds.map((kind) =>
      artifactDestination({ id: "x", kind } as ArtifactListItem),
    )

    expect(seen.map((d) => d.tab)).toEqual([
      "summary",
      "chat",
      "tag",
      "discover",
    ])
    // Distinct params, so two kinds cannot deep-link over each other.
    expect(new Set(seen.map((d) => d.param)).size).toBe(kinds.length)
  })

  it("keeps Discover on the `report` param it already had", () => {
    const discovery = artifactDestination({
      id: "x",
      kind: "discovery",
    } as ArtifactListItem)
    expect(discovery.param).toBe("report")
  })
})
