import { toast } from "sonner"
import type { ChannelInfoResponse } from "@/client"
import { parseApiError, unavailableChannelToastMessage } from "@/lib/api-errors"
import type { CommandContext } from "@/lib/commands/types"
import type { Channel } from "@/types"
import {
  type ChannelInfoDeps,
  type ChannelInfoNetworkSettings,
  type ChannelInfoResult,
  channelInfoDeps,
  channelInfoRequest,
  fetchChannelInfo,
  mergeChannelInfo,
} from "./channel-info"

export function normalizeChannelHandle(input: string): string {
  return input.trim().replace(/^@/, "").split("/").pop() || ""
}

export function findChannelByTelegramChatId(
  channels: Channel[],
  telegramChatId: number,
): Channel | undefined {
  return channels.find((channel) => channel.telegramChatId === telegramChatId)
}

export interface AddChannelContext {
  channels: Channel[]
  setSelectedChannels: CommandContext["setSelectedChannels"]
  loadChannels: () => Promise<void>
  addToSyncQueue: CommandContext["addToSyncQueue"]
  getEffectiveGlobalStartTime: () => number
  settings: ChannelInfoNetworkSettings
}

export function toAddChannelContext(ctx: CommandContext): AddChannelContext {
  return {
    channels: ctx.channels,
    setSelectedChannels: ctx.setSelectedChannels,
    loadChannels: ctx.loadChannels,
    addToSyncQueue: ctx.addToSyncQueue,
    getEffectiveGlobalStartTime: ctx.getEffectiveGlobalStartTime,
    settings: {
      proxyEnabled: ctx.settings.proxyEnabled,
      defaultProxyUrls: ctx.settings.defaultProxyUrls,
      torEnabled: ctx.settings.torEnabled,
      torMode: ctx.settings.torMode,
      torProxyUrls: ctx.settings.torProxyUrls,
      torAutoRotate: ctx.settings.torAutoRotate,
      torRotationThreshold: ctx.settings.torRotationThreshold,
    },
  }
}

function hasChannelNamed(channels: Channel[], channelName: string): boolean {
  const wanted = channelName.toLowerCase()
  return channels.some((channel) => channel.name.toLowerCase() === wanted)
}

/** Why `channelName` cannot be added, or undefined when it can. */
function addChannelRefusal(
  channelName: string,
  channels: Channel[],
): string | undefined {
  if (!channelName) return "Enter a channel handle"
  return hasChannelNamed(channels, channelName)
    ? `@${channelName} is already in your channel list`
    : undefined
}

/**
 * The channel already followed under another handle, going by the chat id the
 * page showed. Telegram's web view only exposes one when at least one message
 * widget exists.
 */
function alreadyFollowedAs(
  info: ChannelInfoResult,
  channels: Channel[],
): Channel | undefined {
  if (!("data" in info) || typeof info.data.telegramChatId !== "number") {
    return undefined
  }
  return findChannelByTelegramChatId(channels, info.data.telegramChatId)
}

/** The row a new follow writes, from whatever the page fetch returned. */
export function newChannelRecord(
  channelName: string,
  info: ChannelInfoResult,
  startTime: number,
  now: number,
): Channel {
  const data = "data" in info ? info.data : undefined
  const metadata = data
    ? mergeChannelInfo({ displayName: channelName }, data)
    : { displayName: channelName }
  return {
    id: channelName,
    name: channelName,
    ...metadata,
    startTime,
    lastUpdated: now,
    followedAt: now,
    tags: [],
    nextRegularSyncAt: null,
    nextDynamicSyncAt: null,
    isUnavailableOnWebView:
      "error" in info
        ? parseApiError(info.error).isUnavailableOnWebView
        : info.data.isUnavailableOnWebView === true,
    telegramChatId:
      typeof data?.telegramChatId === "number"
        ? data.telegramChatId
        : undefined,
  }
}

function showExistingChannel(existing: Channel, ctx: AddChannelContext): void {
  toast.info(`Already following this channel as @${existing.name}`)
  ctx.setSelectedChannels((prev) => new Set(prev).add(existing.name))
  setTimeout(() => {
    const element = document.querySelector(
      `[data-channel-name="${existing.name}"]`,
    )
    element?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, 0)
}

export async function addChannelByName(
  rawInput: string,
  ctx: AddChannelContext,
  deps: ChannelInfoDeps = channelInfoDeps,
): Promise<{ ok: boolean; channelName?: string }> {
  const channelName = normalizeChannelHandle(rawInput)
  const refusal = addChannelRefusal(channelName, ctx.channels)
  if (refusal) {
    toast.error(refusal)
    return { ok: false }
  }

  const startTime = ctx.getEffectiveGlobalStartTime()
  const info = await fetchChannelInfo(
    channelName,
    ctx.settings,
    "AddChannel",
    (err) => parseApiError(err).message,
    deps,
  )
  if ("error" in info) {
    console.error("Failed to fetch initial channel info:", info.error)
  }

  const existing = alreadyFollowedAs(info, ctx.channels)
  if (existing) {
    showExistingChannel(existing, ctx)
    return { ok: true, channelName: existing.name }
  }

  const newChannel = newChannelRecord(channelName, info, startTime, Date.now())
  await deps.upsertChannel(newChannel)
  await ctx.loadChannels()
  ctx.setSelectedChannels((prev) => new Set(prev).add(channelName))

  if (newChannel.isUnavailableOnWebView) {
    toast.warning(unavailableChannelToastMessage(channelName), {
      duration: 8000,
    })
  } else {
    ctx.addToSyncQueue(newChannel, "Initial Sync", () => {})
    toast.success(`Added @${channelName}`)
  }
  return { ok: true, channelName }
}

export type ForwardedChannelContext = Omit<
  AddChannelContext,
  "setSelectedChannels"
> & { isOffline: boolean }

interface ForwardedChannelInfo {
  data?: ChannelInfoResponse
  isUnavailableOnWebView: boolean
}

/** A failed fetch still adds the channel; only a non-Unavailable failure is shown. */
async function fetchForwardedChannelInfo(
  channelName: string,
  settings: ChannelInfoNetworkSettings,
  deps: ChannelInfoDeps,
): Promise<ForwardedChannelInfo> {
  try {
    const data = await deps.channelInfo(
      channelInfoRequest(channelName, settings),
    )
    return {
      data,
      isUnavailableOnWebView: data.isUnavailableOnWebView === true,
    }
  } catch (err: unknown) {
    console.error("Failed to fetch initial channel info:", err)
    const parsed = parseApiError(err)
    if (!parsed.isUnavailableOnWebView && parsed.message) {
      toast.error(parsed.message)
    }
    return { isUnavailableOnWebView: parsed.isUnavailableOnWebView }
  }
}

/** The row following a channel from a forwarded post writes; an Unavailable one starts frozen. */
export function forwardedChannelRecord(
  channelName: string,
  info: ForwardedChannelInfo,
  startTime: number,
  discoveredVia: Channel["discoveredVia"],
  now: number,
): Channel {
  const unavailable = info.isUnavailableOnWebView
  return {
    id: channelName,
    name: channelName,
    displayName: info.data?.displayName || channelName,
    photoUrl: info.data?.photoUrl || undefined,
    startTime,
    lastUpdated: now,
    followedAt: now,
    tags: [],
    isFrozen: unavailable,
    isUnavailableOnWebView: unavailable,
    autoFollowForwarded: false,
    regularSyncEnabled: !unavailable,
    dynamicSyncEnabled: false,
    discoveredVia,
  }
}

/**
 * Follow a channel named by a forwarded post. Unlike `addChannelByName` it
 * files no Network log and leaves the selection alone.
 */
export async function addForwardedChannel(
  rawName: string,
  discoveredVia: Channel["discoveredVia"],
  ctx: ForwardedChannelContext,
  deps: ChannelInfoDeps = channelInfoDeps,
): Promise<void> {
  if (ctx.isOffline) {
    toast.warning("Server offline — cannot add channels while offline.")
    return
  }
  const channelName = normalizeChannelHandle(rawName)
  if (!channelName) return
  if (hasChannelNamed(ctx.channels, channelName)) {
    toast.info(`Channel @${channelName} is already in your workspace`)
    return
  }

  const startTime = ctx.getEffectiveGlobalStartTime()
  const info = await fetchForwardedChannelInfo(channelName, ctx.settings, deps)
  const newChannel = forwardedChannelRecord(
    channelName,
    info,
    startTime,
    discoveredVia,
    Date.now(),
  )
  await deps.upsertChannel(newChannel)
  await ctx.loadChannels()

  if (info.isUnavailableOnWebView) {
    toast.warning(unavailableChannelToastMessage(channelName), {
      duration: 8000,
    })
  } else {
    toast.success(`Added @${channelName} to workspace`)
    ctx.addToSyncQueue(newChannel, "Manual (Added from Forward)", () => {})
  }
}
