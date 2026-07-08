import { describe, expect, it } from "bun:test"

import { channelWritePayload } from "./data"

describe("channelWritePayload", () => {
  it("strips inherited setting-group fields from channel PUT payloads", () => {
    const payload = channelWritePayload({
      id: "ch-a",
      name: "ch-a",
      tags: ["news"],
      autoFollowForwarded: true,
      autoSyncIntervalMinutes: 90,
      settingGroupId: "group-1",
      settingGroupName: "default",
      telegramChatId: -1001234567890,
      displayName: "Channel A",
    })

    expect(payload).toEqual({
      id: "ch-a",
      name: "ch-a",
      tags: ["news"],
      displayName: "Channel A",
    })
  })
})
