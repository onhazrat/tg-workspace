/**
 * The Channels tab's bulk move into a setting group.
 *
 * The rows are patched locally rather than refetched, so the copy is the only
 * thing standing between a move and a grid that still shows the old group's
 * sync flags. A frozen channel that still reads as syncing is the visible
 * version of that bug.
 */
import { describe, expect, test } from "bun:test"
import type { Channel, ChannelSettingGroup } from "@/types"
import {
  type AssignSettingGroupContext,
  applyGroupFieldsToChannel,
  assignChannelsToSettingGroup,
} from "./assign-setting-group"

const frozen: ChannelSettingGroup = {
  id: "frozen-global",
  name: "Frozen",
  isDefault: false,
  regularSyncEnabled: false,
  dynamicSyncEnabled: false,
  autoSyncIntervalMinutes: 999,
  dynamicSyncExpectedPosts: 3,
  autoFollowForwarded: true,
  isFrozen: true,
  isUnavailableOnWebView: true,
  includeInSyncAll: false,
  includeInBulkSync: false,
  allowIndividualSync: false,
  resetSyncEnabled: false,
  channelCount: 7,
}

const channels: Channel[] = [
  {
    id: "c1",
    name: "alpha",
    tags: ["news"],
    settingGroupId: "default-global",
    regularSyncEnabled: true,
    includeInSyncAll: true,
  },
  { id: "c2", name: "beta", settingGroupId: "default-global" },
]

describe("applyGroupFieldsToChannel", () => {
  test("copies every policy field of the group and keeps the channel's own", () => {
    expect(applyGroupFieldsToChannel(channels[0]!, frozen)).toEqual({
      id: "c1",
      name: "alpha",
      tags: ["news"],
      settingGroupId: "frozen-global",
      settingGroupName: "Frozen",
      regularSyncEnabled: false,
      dynamicSyncEnabled: false,
      autoSyncIntervalMinutes: 999,
      dynamicSyncExpectedPosts: 3,
      autoFollowForwarded: true,
      isFrozen: true,
      isUnavailableOnWebView: true,
      includeInSyncAll: false,
      includeInBulkSync: false,
      allowIndividualSync: false,
      resetSyncEnabled: false,
    })
  })
})

describe("assignChannelsToSettingGroup", () => {
  /** Runs one move and reports what reached the server and the grid. */
  async function move(
    channelIds: string[],
    groupId: string,
    settingGroups = [frozen],
  ) {
    const sent: unknown[] = []
    const calls: string[] = []
    let rows = channels
    const ctx: AssignSettingGroupContext = {
      settingGroups,
      setChannels: (update) => {
        rows = typeof update === "function" ? update(rows) : update
      },
      loadChannels: async () => {
        calls.push("reload")
      },
      invalidateSettingGroups: async () => {
        calls.push("invalidate")
      },
    }
    await assignChannelsToSettingGroup(channelIds, groupId, ctx, async (b) => {
      sent.push(b)
      return { updated: b.channelIds.length, settingGroupId: b.settingGroupId }
    })
    return { sent, calls, rows }
  }

  test("assigns the selected channels and patches only their rows", async () => {
    const { sent, calls, rows } = await move(["c1"], "frozen-global")
    expect(sent).toEqual([
      { channelIds: ["c1"], settingGroupId: "frozen-global" },
    ])
    expect(rows[0]).toMatchObject({
      settingGroupId: "frozen-global",
      isFrozen: true,
    })
    expect(rows[1]).toBe(channels[1]!)
    // The group counts moved, so the group list is stale; the channels are not.
    expect(calls).toEqual(["invalidate"])
  })

  test("a group this browser has not loaded is still assigned, then the list reloads", async () => {
    const { sent, calls, rows } = await move(["c1"], "created-elsewhere", [])
    expect(sent).toHaveLength(1)
    expect(calls).toEqual(["reload"])
    expect(rows).toBe(channels)
  })

  test("no selection, or no group chosen, sends nothing", async () => {
    expect((await move([], "frozen-global")).sent).toEqual([])
    expect((await move(["c1"], "")).sent).toEqual([])
  })
})
