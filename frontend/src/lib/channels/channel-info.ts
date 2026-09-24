import { api } from "@/api"
import type { ChannelInfoRequest, ChannelInfoResponse } from "@/client"
import { saveNetworkLog } from "@/lib/logs/write"
import { isNetworkRoutingActive, type ProxySettings } from "@/lib/syncSettings"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import type { Channel, NetworkLog } from "@/types"
import { upsertChannel } from "./store"

/** The settings a channel-info fetch routes by. */
export interface ChannelInfoNetworkSettings extends ProxySettings {
  torAutoRotate: boolean
  torRotationThreshold: number
}

/**
 * The calls adding and refreshing a channel make, injectable as a test seam.
 * Injected rather than `mock.module("@/api", …)` for the reason `ChannelsApi`
 * in `store.ts` gives. Production callers never pass it.
 */
export interface ChannelInfoDeps {
  channelInfo: typeof api.channelInfo
  bulkAssignSettingGroup: typeof api.bulkAssignSettingGroup
  saveNetworkLog: (log: NetworkLog) => Promise<unknown>
  upsertChannel: (channel: Channel) => Promise<unknown>
}

export const channelInfoDeps: ChannelInfoDeps = {
  channelInfo: (body) => api.channelInfo(body),
  bulkAssignSettingGroup: (body) => api.bulkAssignSettingGroup(body),
  saveNetworkLog: (log) => saveNetworkLog(log),
  upsertChannel: (channel) => upsertChannel(channel),
}

export function channelInfoRequest(
  channelName: string,
  settings: ChannelInfoNetworkSettings,
): ChannelInfoRequest {
  return {
    channelName,
    proxyEnabled: isNetworkRoutingActive(settings),
    torAutoRotate: settings.torAutoRotate,
    torRotationThreshold: settings.torRotationThreshold,
  }
}

export type ChannelMetadata = Pick<
  Channel,
  | "displayName"
  | "photoUrl"
  | "bio"
  | "subscribers"
  | "photos"
  | "videos"
  | "files"
  | "links"
>

/** Overlay what the page showed onto `base`; an empty field keeps `base`'s value. */
export function mergeChannelInfo(
  base: ChannelMetadata,
  data: ChannelInfoResponse,
): ChannelMetadata {
  return {
    displayName: data.displayName || base.displayName,
    photoUrl: data.photoUrl || base.photoUrl,
    bio: data.bio || base.bio,
    subscribers: data.subscribers ?? base.subscribers,
    photos: data.photos ?? base.photos,
    videos: data.videos ?? base.videos,
    files: data.files ?? base.files,
    links: data.links ?? base.links,
  }
}

/** The Network log row one channel-info fetch leaves behind. */
export function channelInfoNetworkLog(fetch: {
  channelName: string
  source: string
  ok: boolean
  error?: string
  telemetry?: Record<string, unknown>
  elapsed: number
}): NetworkLog {
  const attempts = fetch.telemetry?.attempts as
    | Array<{ proxyUrl?: string }>
    | undefined
  return {
    id: crypto.randomUUID(),
    url: telegramWebViewChannelUrl(fetch.channelName),
    method: "GET",
    status: fetch.ok ? "success" : "failed",
    statusCode: fetch.ok ? 200 : 0,
    duration:
      (fetch.telemetry?.totalDuration as number | undefined) || fetch.elapsed,
    source: fetch.source,
    timestamp: Date.now(),
    error: fetch.error,
    proxyUsed: attempts?.[attempts.length - 1]?.proxyUrl,
    attempts: attempts?.length || 1,
    telemetry: fetch.telemetry,
  }
}

export type ChannelInfoResult =
  | { data: ChannelInfoResponse }
  | { error: unknown; message: string }

/**
 * Fetch a channel's public page and file a Network log for it, whichever way
 * it went. A failed log write is reported and otherwise ignored.
 */
export async function fetchChannelInfo(
  channelName: string,
  settings: ChannelInfoNetworkSettings,
  source: string,
  describeError: (err: unknown) => string,
  deps: ChannelInfoDeps,
): Promise<ChannelInfoResult> {
  const startTime = Date.now()
  let result: ChannelInfoResult
  let telemetry: Record<string, unknown> | undefined
  try {
    const data = await deps.channelInfo(
      channelInfoRequest(channelName, settings),
    )
    // `Telemetry` is `Any` on the backend by design, so it generates as
    // `unknown` and this one cast survives.
    telemetry = data.telemetry as Record<string, unknown> | undefined
    result = { data }
  } catch (err: unknown) {
    result = { error: err, message: describeError(err) }
  }
  const log = channelInfoNetworkLog({
    channelName,
    source,
    ok: "data" in result,
    error: "message" in result ? result.message : undefined,
    telemetry,
    elapsed: Date.now() - startTime,
  })
  deps
    .saveNetworkLog(log)
    .catch((e) => console.error("Failed to save network log:", e))
  return result
}
