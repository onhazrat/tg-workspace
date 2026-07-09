import { describe, expect, test } from "bun:test"
import type { Channel } from "@/types"
import {
  applyChannelFilter,
  channelsToCopyText,
  channelsToNameAndTelegramChatIdTsvText,
  channelsToTelegramChatIdsCopyText,
  channelToCopyLine,
  channelToNameAndTelegramChatIdTsvLine,
  channelToTelegramChatIdCopyLine,
  filterChannelImportRecords,
  filterChannelsAll,
  filterChannelsFrozen,
  filterChannelsSelected,
  filterChannelsWithTelegramChatId,
} from "./channel"

const channels: Channel[] = [
  { id: "1", name: "zebra", isFrozen: false, telegramChatId: -1003 },
  { id: "2", name: "alpha", isFrozen: true, telegramChatId: -1001 },
  { id: "3", name: "beta", isFrozen: false },
  { id: "4", name: "gamma", isFrozen: false, telegramChatId: -1002 },
]

const ctx = {
  selectedChannels: new Set(["alpha", "beta", "gamma"]),
} as Parameters<typeof applyChannelFilter>[2]

describe("filterChannelsAll", () => {
  test("sorts names A→Z", () => {
    expect(filterChannelsAll(channels).map((c) => c.name)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "zebra",
    ])
  })
})

describe("filterChannelsSelected", () => {
  test("returns only selected channels sorted", () => {
    expect(
      filterChannelsSelected(channels, ctx.selectedChannels).map((c) => c.name),
    ).toEqual(["alpha", "beta", "gamma"])
  })
})

describe("filterChannelsFrozen", () => {
  test("returns only frozen channels", () => {
    expect(filterChannelsFrozen(channels).map((c) => c.name)).toEqual(["alpha"])
  })
})

describe("channelsToCopyText", () => {
  test("joins sorted names with newlines", () => {
    expect(channelsToCopyText(channels)).toBe("alpha\nbeta\ngamma\nzebra")
  })
})

describe("filterChannelsWithTelegramChatId", () => {
  test("returns only channels with telegramChatId sorted by name", () => {
    expect(
      filterChannelsWithTelegramChatId(channels).map((channel) => channel.name),
    ).toEqual(["alpha", "gamma", "zebra"])
  })
})

describe("channelsToTelegramChatIdsCopyText", () => {
  test("joins sorted telegram chat ids with newlines", () => {
    expect(channelsToTelegramChatIdsCopyText(channels)).toBe(
      "-1001\n-1002\n-1003",
    )
  })
})

describe("channelToTelegramChatIdCopyLine", () => {
  test("stringifies telegram chat id", () => {
    expect(channelToTelegramChatIdCopyLine(channels[0])).toBe("-1003")
  })
})

describe("channelsToNameAndTelegramChatIdTsvText", () => {
  test("joins sorted name and id pairs as TSV", () => {
    expect(channelsToNameAndTelegramChatIdTsvText(channels)).toBe(
      "alpha\t-1001\ngamma\t-1002\nzebra\t-1003",
    )
  })
})

describe("channelToNameAndTelegramChatIdTsvLine", () => {
  test("formats name and telegram chat id as TSV", () => {
    expect(channelToNameAndTelegramChatIdTsvLine(channels[0])).toBe(
      "zebra\t-1003",
    )
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
    expect(filtered.map((r) => r.name)).toEqual(["alpha", "gamma"])
  })
})

describe("applyChannelFilter", () => {
  test("applies frozen filter via context", () => {
    expect(
      applyChannelFilter(channels, "frozen", ctx).map((c) => c.name),
    ).toEqual(["alpha"])
  })
})
