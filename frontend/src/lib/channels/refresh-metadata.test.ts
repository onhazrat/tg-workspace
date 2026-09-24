import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { toast } from "sonner"

import type { ChannelInfoResponse } from "@/client"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel, ChannelSettingGroup, NetworkLog } from "@/types"
import type { ChannelInfoDeps } from "./channel-info"
import { refreshChannelMetadata } from "./refresh-metadata"

const settings = {
  proxyEnabled: false,
  defaultProxyUrls: "",
  torEnabled: true,
  torMode: "auto" as const,
  torProxyUrls: "",
  torAutoRotate: true,
  torRotationThreshold: 3,
}

function harness(
  answer: ChannelInfoResponse | Error,
  groups: Partial<ChannelSettingGroup>[] = [],
) {
  const calls = {
    requests: [] as unknown[],
    logs: [] as NetworkLog[],
    upserts: [] as Channel[],
    assigned: [] as unknown[],
    loaded: 0,
    invalidated: 0,
    list: [] as Channel[],
  }
  const deps: ChannelInfoDeps = {
    channelInfo: async (body) => {
      calls.requests.push(body)
      if (answer instanceof Error) throw answer
      return answer
    },
    bulkAssignSettingGroup: async (body) => {
      calls.assigned.push(body)
      return { updated: 1, settingGroupId: body.settingGroupId }
    },
    saveNetworkLog: async (log) => {
      calls.logs.push(log)
    },
    upsertChannel: async (channel) => {
      calls.upserts.push(channel)
    },
  }
  const ctx = {
    settings,
    settingGroups: groups,
    setChannels: (update: (prev: Channel[]) => Channel[]) => {
      calls.list = update(calls.list)
    },
    loadChannels: async () => {
      calls.loaded++
    },
    invalidateSettingGroups: async () => {
      calls.invalidated++
    },
  } as unknown as CommandContext
  return { calls, deps, ctx }
}

const spies: Array<{ mockRestore: () => void }> = []
function spy(method: "success" | "error") {
  const s = spyOn(toast, method)
  spies.push(s)
  return s
}
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore()
})

describe("refreshChannelMetadata", () => {
  test("overlays what the page shows and keeps what it leaves out", async () => {
    const channel: Channel = {
      id: "c1",
      name: "alpha",
      bio: "old bio",
      subscribers: 10,
      photos: 4,
    }
    const { calls, deps, ctx } = harness({
      channelName: "alpha",
      displayName: "Alpha",
      bio: "",
      subscribers: 12,
      photos: null,
      telemetry: { totalDuration: 42, attempts: [{ proxyUrl: "p1" }] },
    })
    calls.list = [channel, { id: "c2", name: "beta" }]
    const success = spy("success")

    await refreshChannelMetadata(channel, ctx, deps)

    expect(calls.requests).toEqual([
      {
        channelName: "alpha",
        proxyEnabled: true,
        torAutoRotate: true,
        torRotationThreshold: 3,
      },
    ])
    const updated = calls.upserts[0]
    expect(updated).toMatchObject({
      id: "c1",
      displayName: "Alpha",
      bio: "old bio",
      subscribers: 12,
      photos: 4,
    })
    expect(calls.list).toEqual([updated, { id: "c2", name: "beta" }])
    expect(calls.logs[0]).toMatchObject({
      source: "RefreshChannelMetadata",
      status: "success",
      statusCode: 200,
      duration: 42,
      proxyUsed: "p1",
      attempts: 1,
    })
    expect(calls.assigned).toEqual([])
    expect(success).toHaveBeenCalledWith("Refreshed metadata for @alpha")
  })

  test("falls back to the handle when neither side has a display name", async () => {
    const { calls, deps, ctx } = harness({ channelName: "alpha" })
    spy("success")
    await refreshChannelMetadata({ id: "c1", name: "alpha" }, ctx, deps)
    expect(calls.upserts[0]?.displayName).toBe("alpha")
  })

  test("a failed fetch changes nothing, toasts and files a failed log", async () => {
    const { calls, deps, ctx } = harness(new Error("proxy down"))
    const error = spy("error")
    const consoleError = spyOn(console, "error").mockImplementation(() => {})
    spies.push(consoleError)

    await refreshChannelMetadata({ id: "c1", name: "alpha" }, ctx, deps)

    expect(calls.upserts).toEqual([])
    expect(error).toHaveBeenCalledWith("proxy down")
    expect(calls.logs[0]).toMatchObject({
      status: "failed",
      statusCode: 0,
      error: "proxy down",
      attempts: 1,
    })
  })

  test("a channel reachable again moves to the default group", async () => {
    const { calls, deps, ctx } = harness({ channelName: "alpha" }, [
      { id: "g-other", isDefault: false },
      { id: "g-default", isDefault: true },
    ])
    const success = spy("success")

    await refreshChannelMetadata(
      { id: "c1", name: "alpha", isUnavailableOnWebView: true },
      ctx,
      deps,
    )

    expect(calls.upserts[0]?.isUnavailableOnWebView).toBe(false)
    expect(calls.assigned).toEqual([
      { channelIds: ["c1"], settingGroupId: "g-default" },
    ])
    expect(calls.loaded).toBe(1)
    expect(calls.invalidated).toBe(1)
    expect(success).toHaveBeenCalledWith(
      "@alpha is available again — moved to default group",
    )
  })

  test("a channel still unavailable stays put", async () => {
    const { calls, deps, ctx } = harness(
      { channelName: "alpha", isUnavailableOnWebView: true },
      [{ id: "g-default", isDefault: true }],
    )
    spy("success")

    await refreshChannelMetadata(
      { id: "c1", name: "alpha", isUnavailableOnWebView: true },
      ctx,
      deps,
    )

    expect(calls.upserts[0]?.isUnavailableOnWebView).toBe(true)
    expect(calls.assigned).toEqual([])
  })

  test("with no default group the returning channel is only refreshed", async () => {
    const { calls, deps, ctx } = harness({ channelName: "alpha" })
    const success = spy("success")

    await refreshChannelMetadata(
      { id: "c1", name: "alpha", isUnavailableOnWebView: true },
      ctx,
      deps,
    )

    expect(calls.assigned).toEqual([])
    expect(success).toHaveBeenCalledWith("Refreshed metadata for @alpha")
  })
})
