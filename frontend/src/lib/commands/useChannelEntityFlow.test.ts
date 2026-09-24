import { describe, expect, it } from "bun:test"
import type { SetStateAction } from "react"

import type { ChannelsApi } from "@/lib/channels/store"
import type { Channel } from "@/types"

import type { CommandContext, EntityFlowType } from "./types"
import {
  getEntityCandidates,
  runEntityChannelAction,
} from "./useChannelEntityFlow"

const channels = [
  {
    id: "1",
    name: "zeta",
    tags: ["news"],
    telegramChatId: -100,
  },
  { id: "2", name: "frozen", isFrozen: true },
  {
    id: "3",
    name: "gone",
    isUnavailableOnWebView: true,
    historyCompleteToCutoff: false,
  },
  { id: "4", name: "alpha", telegramChatId: -200 },
] as Channel[]

function fakeContext(selected: string[] = ["zeta", "frozen"]) {
  const state = {
    channels: [...channels],
    selectedChannels: new Set(selected),
    activeTab: "",
    scraped: [] as Array<[string, boolean, string]>,
  }
  const apply = <T>(prev: T, action: SetStateAction<T>): T =>
    typeof action === "function" ? (action as (p: T) => T)(prev) : action
  const ctx = {
    get channels() {
      return state.channels
    },
    get selectedChannels() {
      return state.selectedChannels
    },
    setActiveTab: (tab: string) => {
      state.activeTab = tab
    },
    setChannels: (action: SetStateAction<Channel[]>) => {
      state.channels = apply(state.channels, action)
    },
    setSelectedChannels: (action: SetStateAction<Set<string>>) => {
      state.selectedChannels = apply(state.selectedChannels, action)
    },
    handleScrapeChannel: async (
      channel: Channel,
      manual: boolean,
      reason: string,
    ) => {
      state.scraped.push([channel.name, manual, reason])
    },
  } as unknown as CommandContext
  return { ctx, state }
}

function fakeApi() {
  const upserted: Channel[] = []
  const client = {
    upsertChannel: async (_id: string, body: Channel) => {
      upserted.push(body)
      return body
    },
  } as unknown as ChannelsApi
  return { client, upserted }
}

describe("getEntityCandidates", () => {
  const { ctx } = fakeContext()
  const names = (flow: EntityFlowType) =>
    getEntityCandidates(flow, ctx).map((channel) => channel.name)
  const all = ["zeta", "frozen", "gone", "alpha"]

  it.each<[EntityFlowType, string[]]>([
    ["search-channel", all],
    ["toggle-auto-follow", all],
    ["sync-channel", all],
    ["delete-channel", all],
    ["reset-sync-channel", all],
    ["add-tag-channel", all],
    ["edit-start-id-channel", all],
    ["refresh-metadata-channel", all],
    ["select-channel", ["gone", "alpha"]],
    ["deselect-channel", ["zeta", "frozen"]],
    ["freeze-channel", ["zeta", "alpha"]],
    ["unfreeze-channel", ["frozen"]],
    ["fix-partial-history-channel", ["gone"]],
    ["copy-channel-telegram-chat-id", ["alpha", "zeta"]],
    ["remove-tag-channel", ["zeta"]],
    ["open-post", []],
    ["delete-summary", []],
  ])("%s offers %p", (flow, expected) => {
    expect(names(flow)).toEqual(expected)
  })
})

describe("runEntityChannelAction", () => {
  const [zeta, frozen, , alpha] = channels

  it("select adds the channel and deselect removes it", async () => {
    const { ctx, state } = fakeContext([])
    await runEntityChannelAction("select-channel", alpha, ctx)
    expect([...state.selectedChannels]).toEqual(["alpha"])
    await runEntityChannelAction("deselect-channel", alpha, ctx)
    expect([...state.selectedChannels]).toEqual([])
  })

  it("freeze saves the channel frozen and drops it from the selection", async () => {
    const { ctx, state } = fakeContext()
    const { client, upserted } = fakeApi()
    await runEntityChannelAction("freeze-channel", zeta, ctx, client)
    expect(upserted).toEqual([{ ...zeta, isFrozen: true }])
    expect(state.channels[0]).toEqual({ ...zeta, isFrozen: true })
    expect(state.channels.slice(1)).toEqual(channels.slice(1))
    expect([...state.selectedChannels]).toEqual(["frozen"])
  })

  it("unfreeze saves the channel unfrozen and leaves the selection", async () => {
    const { ctx, state } = fakeContext()
    const { client, upserted } = fakeApi()
    await runEntityChannelAction("unfreeze-channel", frozen, ctx, client)
    expect(upserted).toEqual([{ ...frozen, isFrozen: false }])
    expect(state.channels[1].isFrozen).toBe(false)
    expect([...state.selectedChannels]).toEqual(["zeta", "frozen"])
  })

  it("toggle-auto-follow flips the flag both ways", async () => {
    const { ctx, state } = fakeContext()
    const { client, upserted } = fakeApi()
    await runEntityChannelAction("toggle-auto-follow", alpha, ctx, client)
    expect(state.channels[3].autoFollowForwarded).toBe(true)
    await runEntityChannelAction(
      "toggle-auto-follow",
      state.channels[3],
      ctx,
      client,
    )
    expect(state.channels[3].autoFollowForwarded).toBe(false)
    expect(upserted).toHaveLength(2)
  })

  it("sync scrapes the channel as a manual palette run", async () => {
    const { ctx, state } = fakeContext()
    await runEntityChannelAction("sync-channel", alpha, ctx)
    expect(state.scraped).toEqual([["alpha", true, "Manual (Palette)"]])
  })

  it("search opens the channels tab and scrolls to the card", async () => {
    const { ctx, state } = fakeContext()
    const card = document.createElement("div")
    card.dataset.channelName = "alpha"
    let scrolled = false
    card.scrollIntoView = () => {
      scrolled = true
    }
    document.body.append(card)
    try {
      await runEntityChannelAction("search-channel", alpha, ctx)
      expect(state.activeTab).toBe("channels")
      await new Promise((resolve) => requestAnimationFrame(resolve))
      expect(scrolled).toBe(true)
    } finally {
      card.remove()
    }
  })

  it("does nothing for a flow it does not own", async () => {
    const { ctx, state } = fakeContext()
    const { client, upserted } = fakeApi()
    await runEntityChannelAction("delete-channel", alpha, ctx, client)
    expect(upserted).toEqual([])
    expect(state.channels).toEqual(channels)
    expect(state.scraped).toEqual([])
  })
})
