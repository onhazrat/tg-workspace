import { describe, expect, it } from "bun:test"

import {
  channelAllows,
  disabledReason,
  filterChannelsForOperation,
} from "@/lib/channels/sync-permissions"
import type { Channel } from "@/types"

const baseChannel = (overrides: Partial<Channel> = {}): Channel => ({
  id: "ch-1",
  name: "alpha",
  includeInSyncAll: true,
  includeInBulkSync: true,
  allowIndividualSync: true,
  resetSyncEnabled: true,
  settingGroupName: "default",
  ...overrides,
})

describe("channelAllows", () => {
  it("defaults missing flags to allowed", () => {
    const channel = baseChannel({
      includeInSyncAll: undefined,
      includeInBulkSync: undefined,
      allowIndividualSync: undefined,
      resetSyncEnabled: undefined,
    })
    expect(channelAllows(channel, "sync_all")).toBe(true)
    expect(channelAllows(channel, "bulk")).toBe(true)
    expect(channelAllows(channel, "individual")).toBe(true)
    expect(channelAllows(channel, "reset")).toBe(true)
    expect(channelAllows(channel, "bulk_reset")).toBe(true)
  })

  it("matches Restricted preset", () => {
    const channel = baseChannel({
      settingGroupName: "Restricted",
      includeInSyncAll: false,
      includeInBulkSync: true,
      allowIndividualSync: true,
      resetSyncEnabled: false,
    })
    expect(channelAllows(channel, "sync_all")).toBe(false)
    expect(channelAllows(channel, "bulk")).toBe(true)
    expect(channelAllows(channel, "individual")).toBe(true)
    expect(channelAllows(channel, "reset")).toBe(false)
    expect(channelAllows(channel, "bulk_reset")).toBe(false)
  })

  it("matches Frozen preset", () => {
    const channel = baseChannel({
      settingGroupName: "Frozen",
      includeInSyncAll: false,
      includeInBulkSync: false,
      allowIndividualSync: true,
      resetSyncEnabled: true,
    })
    expect(channelAllows(channel, "sync_all")).toBe(false)
    expect(channelAllows(channel, "bulk")).toBe(false)
    expect(channelAllows(channel, "individual")).toBe(true)
    expect(channelAllows(channel, "reset")).toBe(true)
    expect(channelAllows(channel, "bulk_reset")).toBe(false)
  })
})

describe("disabledReason", () => {
  it("returns null when allowed", () => {
    expect(disabledReason(baseChannel(), "individual")).toBeNull()
  })

  it("cites group name when denied", () => {
    const reason = disabledReason(
      baseChannel({
        settingGroupName: "Restricted",
        allowIndividualSync: false,
      }),
      "individual",
    )
    expect(reason).toContain("Restricted")
    expect(reason).toContain("Allow individual sync")
  })
})

describe("filterChannelsForOperation", () => {
  it("filters by sync_all flag", () => {
    const channels = [
      baseChannel({ name: "a" }),
      baseChannel({ name: "b", includeInSyncAll: false }),
    ]
    expect(
      filterChannelsForOperation(channels, "sync_all").map((c) => c.name),
    ).toEqual(["a"])
  })
})
