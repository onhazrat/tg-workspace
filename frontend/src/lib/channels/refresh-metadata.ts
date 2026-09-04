import { toast } from "sonner"

import { api } from "@/api"
import type { CommandContext } from "@/lib/commands/types"
import { saveNetworkLog } from "@/lib/logs/write"
import { isNetworkRoutingActive } from "@/lib/syncSettings"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel, NetworkLog } from "@/types"
import { upsertChannel } from "./store"

export async function refreshChannelMetadata(
  channel: Channel,
  ctx: CommandContext,
): Promise<void> {
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

  let displayName = channel.displayName || channel.name
  let photoUrl = channel.photoUrl
  let bio = channel.bio
  let subscribers = channel.subscribers
  let photos = channel.photos
  let videos = channel.videos
  let files = channel.files
  let links = channel.links
  let isUnavailableOnWebView = channel.isUnavailableOnWebView
  const wasUnavailable = channel.isUnavailableOnWebView === true

  try {
    const data = await api.channelInfo({
      channelName: channel.name,
      proxyEnabled: isNetworkRoutingActive(proxySettings),
      torAutoRotate: ctx.settings.torAutoRotate,
      torRotationThreshold: ctx.settings.torRotationThreshold,
    })

    status = 200
    // `Telemetry` is `Any` on the backend, so it generates as `unknown` and
    // keeps its cast; the field casts below are gone with F2.
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
    } else if (wasUnavailable) {
      isUnavailableOnWebView = false
    }
    // The `if (data.error)` branch that stood here was unreachable — see the
    // same removal in `ScraperContext`.
  } catch (err: unknown) {
    console.error("Failed to refresh channel metadata:", err)
    errorMsg =
      err instanceof Error ? err.message : "Failed to refresh channel metadata"
    toast.error(errorMsg)
    return
  } finally {
    const duration = Date.now() - startTime
    const attempts = telemetryData?.attempts as
      | Array<{ proxyUrl?: string }>
      | undefined
    const proxyUsed = attempts?.[attempts.length - 1]?.proxyUrl

    const logEntry: NetworkLog = {
      id: crypto.randomUUID(),
      url: telegramWebViewChannelUrl(channel.name),
      method: "GET",
      status: status === 200 ? "success" : "failed",
      statusCode: status,
      duration:
        (telemetryData?.totalDuration as number | undefined) || duration,
      source: "RefreshChannelMetadata",
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

  const updated: Channel = {
    ...channel,
    displayName,
    photoUrl,
    bio,
    subscribers,
    photos,
    videos,
    files,
    links,
    isUnavailableOnWebView,
    lastUpdated: Date.now(),
  }

  await upsertChannel(updated)
  ctx.setChannels((prev) =>
    prev.map((entry) => (entry.id === channel.id ? updated : entry)),
  )

  if (wasUnavailable && !isUnavailableOnWebView) {
    const defaultGroup = ctx.settingGroups.find((group) => group.isDefault)
    if (defaultGroup) {
      await api.bulkAssignSettingGroup({
        channelIds: [channel.id],
        settingGroupId: defaultGroup.id,
      })
      await ctx.loadChannels()
      await ctx.invalidateSettingGroups()
      toast.success(
        `@${channel.name} is available again — moved to default group`,
      )
      return
    }
  }

  toast.success(`Refreshed metadata for @${channel.name}`)
}
