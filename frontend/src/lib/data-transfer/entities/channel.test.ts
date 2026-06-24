import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import {
  applyChannelFilter,
  channelsToCopyText,
  channelToCopyLine,
  filterChannelImportRecords,
  filterChannelsAll,
  filterChannelsFrozen,
  filterChannelsSelected,
} from "./channel"

const channels: Channel[] = [
  { id: "1", name: "zebra", isFrozen: false },
  { id: "2", name: "alpha", isFrozen: true },
  { id: "3", name: "beta", isFrozen: false },
]

const ctx = {
  selectedChannels: new Set(["alpha", "beta"]),
} as Parameters<typeof applyChannelFilter>[2]

describe("filterChannelsAll", () => {
  test("sorts names A→Z", () => {
    expect(filterChannelsAll(channels).map((c) => c.name)).toEqual([
      "alpha",
      "beta",
      "zebra",
    ])
  })
})

describe("filterChannelsSelected", () => {
  test("returns only selected channels sorted", () => {
    expect(
      filterChannelsSelected(channels, ctx.selectedChannels).map((c) => c.name),
    ).toEqual(["alpha", "beta"])
  })
})

describe("filterChannelsFrozen", () => {
  test("returns only frozen channels", () => {
    expect(filterChannelsFrozen(channels).map((c) => c.name)).toEqual(["alpha"])
  })
})

describe("channelsToCopyText", () => {
  test("joins sorted names with newlines", () => {
    expect(channelsToCopyText(channels)).toBe("alpha\nbeta\nzebra")
  })
})

describe("channelToCopyLine", () => {
  test("uses canonical channel name", () => {
    expect(channelToCopyLine(channels[0])).toBe("zebra")
  })
})

describe("filterChannelImportRecords", () => {
  test("selected import keeps only rows matching selection (B2)", () => {
    const records = [
      { id: "1", name: "alpha" },
      { id: "2", name: "gamma" },
    ] as Channel[]
    const filtered = filterChannelImportRecords(records, "selected", ctx)
    expect(filtered.map((r) => r.name)).toEqual(["alpha"])
  })
})

describe("applyChannelFilter", () => {
  test("applies frozen filter via context", () => {
    expect(
      applyChannelFilter(channels, "frozen", ctx).map((c) => c.name),
    ).toEqual(["alpha"])
  })
})
