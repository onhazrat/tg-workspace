import { toast } from "sonner"

import { api } from "@/api"
import { parseApiError, unavailableChannelToastMessage } from "@/lib/api-errors"
import type { CommandContext } from "@/lib/commands/types"
import { saveNetworkLog } from "@/lib/logs/write"
import { isNetworkRoutingActive } from "@/lib/syncSettings"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel, NetworkLog } from "@/types"
import { upsertChannel } from "./store"

export function normalizeChannelHandle(input: string): string {
  return input.trim().replace(/^@/, "").split("/").pop() || ""
}

export function findChannelByTelegramChatId(
  channels: Channel[],
  telegramChatId: number,
): Channel | undefined {
  return channels.find((channel) => channel.telegramChatId === telegramChatId)
}

export interface AddChannelNetworkSettings {
  proxyEnabled: boolean
  defaultProxyUrls: string
  torEnabled: boolean
  torMode: "auto" | "custom"
  torProxyUrls: string
  torAutoRotate: boolean
  torRotationThreshold: number
}

export interface AddChannelContext {
  channels: Channel[]
  setSelectedChannels: CommandContext["setSelectedChannels"]
  loadChannels: () => Promise<void>
  addToSyncQueue: CommandContext["addToSyncQueue"]
  getEffectiveGlobalStartTime: () => number
  settings: AddChannelNetworkSettings
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

export async function addChannelByName(
  rawInput: string,
  ctx: AddChannelContext,
): Promise<{ ok: boolean; channelName?: string }> {
  const channelName = normalizeChannelHandle(rawInput)
  if (!channelName) {
    toast.error("Enter a channel handle")
    return { ok: false }
  }

  const duplicate = ctx.channels.some(
    (channel) => channel.name.toLowerCase() === channelName.toLowerCase(),
  )
  if (duplicate) {
    toast.error(`@${channelName} is already in your channel list`)
    return { ok: false }
  }

  let displayName = channelName
  let photoUrl: string | undefined
  const effectiveStartTime = ctx.getEffectiveGlobalStartTime()

  const proxySettings = {
    proxyEnabled: ctx.settings.proxyEnabled,
    defaultProxyUrls: ctx.settings.defaultProxyUrls,
    torEnabled: ctx.settings.torEnabled,
    torMode: ctx.settings.torMode,
    torProxyUrls: ctx.settings.torProxyUrls,
  }

  const startTime = Date.now()
  let status = 0
  let errorMsg: string | undefined
  let telemetryData: Record<string, unknown> | undefined

  let bio: string | undefined
  let subscribers: string | undefined
  let photos: string | undefined
  let videos: string | undefined
  let files: string | undefined
  let links: string | undefined
  let isUnavailableOnWebView = false
  let telegramChatId: number | undefined

  try {
    const data = await api.channelInfo({
      channelName,
      proxyEnabled: isNetworkRoutingActive(proxySettings),
      torAutoRotate: ctx.settings.torAutoRotate,
      torRotationThreshold: ctx.settings.torRotationThreshold,
    })

    status = 200
    // `Telemetry` is `Any` on the backend by design, so it generates as
    // `unknown` and this one cast survives. Every other field below used to
    // need one too, until F2 moved this call onto the generated client.
    telemetryData = data.telemetry as Record<string, unknown> | undefined

    if (data.displayName) displayName = data.displayName
    if (data.photoUrl) photoUrl = data.photoUrl
    if (data.bio) bio = data.bio
    if (data.subscribers) subscribers = data.subscribers
    if (data.photos) photos = data.photos
    if (data.videos) videos = data.videos
    if (data.files) files = data.files
    if (data.links) links = data.links
    if (data.isUnavailableOnWebView) {
      isUnavailableOnWebView = true
    }
    if (typeof data.telegramChatId === "number") {
      telegramChatId = data.telegramChatId
      // Telegram web view only exposes chat IDs when at least one message widget exists.
      const existingChannel = findChannelByTelegramChatId(
        ctx.channels,
        telegramChatId,
      )
      if (existingChannel) {
        toast.info(`Already following this channel as @${existingChannel.name}`)
        ctx.setSelectedChannels((prev) =>
          new Set(prev).add(existingChannel.name),
        )
        setTimeout(() => {
          const element = document.querySelector(
            `[data-channel-name="${existingChannel.name}"]`,
          )
          element?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 0)
        return { ok: true, channelName: existingChannel.name }
      }
    }
  } catch (err: unknown) {
    console.error("Failed to fetch initial channel info:", err)
    const parsed = parseApiError(err)
    errorMsg = parsed.message
    if (parsed.isUnavailableOnWebView) {
      isUnavailableOnWebView = true
    }
  } finally {
    const duration = Date.now() - startTime
    const attempts = telemetryData?.attempts as
      | Array<{ proxyUrl?: string }>
      | undefined
    const proxyUsed = attempts?.[attempts.length - 1]?.proxyUrl

    const logEntry: NetworkLog = {
      id: crypto.randomUUID(),
      url: telegramWebViewChannelUrl(channelName),
      method: "GET",
      status: status === 200 ? "success" : "failed",
      statusCode: status,
      duration:
        (telemetryData?.totalDuration as number | undefined) || duration,
      source: "AddChannel",
      timestamp: Date.now(),
      error: errorMsg,
      proxyUsed,
      attempts: attempts?.length || 1,
      telemetry: telemetryData,
    }
    saveNetworkLog(logEntry).catch((e) =>
      console.error("Failed to save network log:", e),
    )
  }

  const newChannel: Channel = {
    id: channelName,
    name: channelName,
    displayName,
    photoUrl,
    bio,
    subscribers,
    photos,
    videos,
    files,
    links,
    startTime: effectiveStartTime,
    lastUpdated: Date.now(),
    followedAt: Date.now(),
    tags: [],
    nextRegularSyncAt: null,
    nextDynamicSyncAt: null,
    isUnavailableOnWebView,
    telegramChatId,
  }

  await upsertChannel(newChannel)
  await ctx.loadChannels()
  ctx.setSelectedChannels((prev) => new Set(prev).add(channelName))

  if (isUnavailableOnWebView) {
    toast.warning(unavailableChannelToastMessage(channelName), {
      duration: 8000,
    })
  } else {
    ctx.addToSyncQueue(newChannel, "Initial Sync", () => {})
    toast.success(`Added @${channelName}`)
  }
  return { ok: true, channelName }
}
