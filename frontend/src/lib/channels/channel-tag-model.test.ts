import { describe, expect, it } from "bun:test"

import {
  addManualTag,
  getTagNames,
  mergeAiTags,
  normalizeChannelTags,
  removeAiTags,
} from "@/lib/channels/channel-tag-model"

describe("normalizeChannelTags", () => {
  it("normalizes legacy string tags to manual metadata", () => {
    expect(normalizeChannelTags(["Tech"])).toEqual([
      { name: "Tech", source: "manual", assignedAt: 0 },
    ])
  })

  it("accepts object tags and deduplicates by case-insensitive name", () => {
    expect(
      normalizeChannelTags([
        { name: "Tech", source: "ai", assignedAt: 7 },
        { name: "tech", source: "manual", assignedAt: 11 },
      ]),
    ).toEqual([{ name: "Tech", source: "ai", assignedAt: 7 }])
  })
})

describe("tag mutation helpers", () => {
  it("adds manual tags without duplicating existing names", () => {
    expect(
      addManualTag([{ name: "Tech", source: "ai", assignedAt: 1 }], "tech", 10),
    ).toEqual([{ name: "Tech", source: "ai", assignedAt: 1 }])
  })

  it("merges new AI tags while preserving existing metadata", () => {
    expect(
      mergeAiTags(
        [{ name: "Tech", source: "manual", assignedAt: 2 }],
        ["tech", "AI"],
        3,
      ),
    ).toEqual([
      { name: "Tech", source: "manual", assignedAt: 2 },
      { name: "AI", source: "ai", assignedAt: 3 },
    ])
  })

  it("removes tags case-insensitively", () => {
    expect(removeAiTags(["Tech", "Finance"], ["tech"])).toEqual([
      { name: "Finance", source: "manual", assignedAt: 0 },
    ])
  })
})

describe("getTagNames", () => {
  it("returns plain names from mixed raw tags", () => {
    expect(
      getTagNames(["one", { name: "two", source: "ai", assignedAt: 1 }]),
    ).toEqual(["one", "two"])
  })
})
