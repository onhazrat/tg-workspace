import { describe, expect, it } from "bun:test"

import {
  areAllNamesSelected,
  collectGridTags,
  getChannelNamesInGroup,
  getChannelNamesWithTag,
  getChipSelectionState,
  toggleNamesInSelection,
} from "@/lib/channels/channel-grid-chips"
import type { Channel } from "@/types"

const sampleChannels: Channel[] = [
  {
    id: "a",
    name: "a",
    tags: ["shared", "alpha"],
    settingGroupId: "group-1",
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "b",
    name: "b",
    tags: [{ name: "shared", source: "manual", assignedAt: 1 }],
    settingGroupId: "group-1",
    isFrozen: true,
    lastUpdated: 0,
    followedAt: 0,
  },
  {
    id: "c",
    name: "c",
    tags: [],
    settingGroupId: "group-2",
    lastUpdated: 0,
    followedAt: 0,
  },
]

describe("getChipSelectionState", () => {
  it("reports fully selected chips", () => {
    expect(getChipSelectionState(["a", "b"], new Set(["a", "b"]))).toEqual({
      selectedCount: 2,
      totalCount: 2,
      isAllSelected: true,
      isPartial: false,
    })
  })

  it("reports partial selection", () => {
    expect(getChipSelectionState(["a", "b"], new Set(["a"]))).toEqual({
      selectedCount: 1,
      totalCount: 2,
      isAllSelected: false,
      isPartial: true,
    })
  })

  it("reports no selection", () => {
    expect(getChipSelectionState(["a", "b"], new Set())).toEqual({
      selectedCount: 0,
      totalCount: 2,
      isAllSelected: false,
      isPartial: false,
    })
  })

  it("never marks an empty chip as fully selected", () => {
    expect(getChipSelectionState([], new Set(["a"]))).toEqual({
      selectedCount: 0,
      totalCount: 0,
      isAllSelected: false,
      isPartial: false,
    })
  })
})

describe("areAllNamesSelected", () => {
  it("is true when every name is selected", () => {
    expect(areAllNamesSelected(["a", "b"], new Set(["a", "b", "c"]))).toBe(true)
    expect(areAllNamesSelected(["a", "b"], new Set(["a"]))).toBe(false)
  })

  it("is true for an empty list (historical toggle no-op)", () => {
    expect(areAllNamesSelected([], new Set())).toBe(true)
  })
})

describe("toggleNamesInSelection", () => {
  it("adds all names when not all were selected", () => {
    const next = toggleNamesInSelection(new Set(["a"]), ["a", "b"], false)
    expect(Array.from(next).sort()).toEqual(["a", "b"])
  })

  it("removes all names when all were selected", () => {
    const next = toggleNamesInSelection(
      new Set(["a", "b", "c"]),
      ["a", "b"],
      true,
    )
    expect(Array.from(next)).toEqual(["c"])
  })

  it("does not mutate the previous set", () => {
    const prev = new Set(["a"])
    toggleNamesInSelection(prev, ["b"], false)
    expect(Array.from(prev)).toEqual(["a"])
  })
})

describe("getChannelNamesWithTag", () => {
  it("includes frozen channels by default", () => {
    expect(getChannelNamesWithTag(sampleChannels, "shared")).toEqual(["a", "b"])
  })

  it("excludes frozen channels when requested", () => {
    expect(
      getChannelNamesWithTag(sampleChannels, "shared", {
        excludeFrozen: true,
      }),
    ).toEqual(["a"])
  })

  it("matches tag names exactly (case-sensitive)", () => {
    expect(getChannelNamesWithTag(sampleChannels, "SHARED")).toEqual([])
  })
})

describe("getChannelNamesInGroup", () => {
  it("includes frozen channels by default", () => {
    expect(getChannelNamesInGroup(sampleChannels, "group-1")).toEqual([
      "a",
      "b",
    ])
  })

  it("excludes frozen channels when requested", () => {
    expect(
      getChannelNamesInGroup(sampleChannels, "group-1", {
        excludeFrozen: true,
      }),
    ).toEqual(["a"])
  })

  it("returns empty for unknown group", () => {
    expect(getChannelNamesInGroup(sampleChannels, "missing")).toEqual([])
  })
})

describe("collectGridTags", () => {
  it("returns unique tags ordered by selection state and channel count", () => {
    expect(collectGridTags(sampleChannels, new Set(["a"]))).toEqual([
      "alpha",
      "shared",
    ])
    expect(collectGridTags(sampleChannels, new Set())).toEqual([
      "shared",
      "alpha",
    ])
  })

  it("returns empty when no channel has tags", () => {
    expect(collectGridTags([sampleChannels[2]], new Set())).toEqual([])
  })
})
