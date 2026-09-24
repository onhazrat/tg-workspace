/**
 * The decisions `BotManagement` and its panels make, kept free of React so
 * they can be tested without the hooks, the store or the network.
 *
 * Nothing here sees a bot token except `looksLikeBotToken`, which only reads
 * its shape. The network log a Bot API call files names the method, never the
 * token (`bot.../<method>`).
 */
import type { PublishResult } from "@/services/telegram"
import type { NetworkLog, PublishLog } from "@/types"
import type { BotValidationState } from "./BotCredentialsPanel"
import type { DestValidationState } from "./DestinationsPanel"

type BotValidation = BotValidationState[string]
type DestValidation = DestValidationState[string]

/** The Bot API as `BotManagement` calls it: through the backend, with logging. */
export type BotApiCall = (
  credentialId: string | undefined,
  token: string | undefined,
  method: string,
  params?: Record<string, string | number>,
) => Promise<any>

type Named = { title?: string; username?: string; first_name?: string }

/** Worth a `getMe` while the user is still typing: `<id>:<secret>` and long. */
export const looksLikeBotToken = (token: string): boolean =>
  token.includes(":") && token.length > 20

/** Worth a `getChat`: long enough to be a handle or id, and a bot to ask with. */
export const canLookUpChat = (chatId: string, botCount: number): boolean =>
  chatId.length >= 4 && botCount > 0

export const botDisplayName = (me: Named): string =>
  me.first_name || me.username || ""

export const chatDisplayName = (chat: Named): string =>
  chat.title || chat.username || chat.first_name || ""

/**
 * The name a lookup fills in, or null to leave the field alone: only a
 * successful lookup, and only while the user has not typed a name of their own.
 */
export function autofillName(
  data: { ok?: boolean; result?: Named },
  current: string,
  pick: (named: Named) => string,
): string | null {
  if (!data.ok || current) return null
  return pick(data.result ?? {})
}

/** What a `getChat` answer says about a saved destination. */
export function destinationValidation(data: {
  ok?: boolean
  description?: string
  result?: Named & { type?: string }
}): DestValidation {
  if (!data.ok)
    return {
      isValid: false,
      info: data.description || "Invalid Chat ID",
      loading: false,
    }
  const chat = data.result ?? {}
  const name = chatDisplayName(chat) || "Valid Chat"
  const info = chat.type ? `${name} (${chat.type.toUpperCase()})` : name
  return { isValid: true, info, loading: false }
}

export const DEST_NETWORK_ERROR: DestValidation = {
  isValid: false,
  info: "Network Error",
  loading: false,
}

export const BOT_NETWORK_ERROR: BotValidation = {
  isValid: false,
  botInfo: "Network Error",
  loading: false,
}

/** The status row under a destination: its label, colour and detail text. */
export function destinationStatus(v: DestValidation): {
  label: string
  toneClass: string
  details: string
} {
  let label = v.isValid ? "Valid" : "Invalid"
  if (v.loading) label = "Checking..."
  return {
    label,
    toneClass: v.isValid ? "text-green-500" : "text-red-500",
    details: v.info || (v.loading ? "Verifying..." : "Invalid"),
  }
}

/**
 * The bot's profile photo path, or "" when it has none or the lookup failed.
 * Only bots that can join groups are asked, as before; a failure here never
 * fails the validation it is part of.
 */
export async function botPhotoPath(
  call: BotApiCall,
  id: string,
  me: {
    id?: number
    can_join_groups?: boolean
    can_read_all_group_messages?: boolean
  },
): Promise<string> {
  if (!me.can_join_groups || me.can_read_all_group_messages === undefined)
    return ""
  try {
    const photos = await call(id, undefined, "getUserProfilePhotos", {
      user_id: me.id as number,
      limit: 1,
    })
    if (!(photos.ok && photos.result.total_count > 0)) return ""
    const file = await call(id, undefined, "getFile", {
      file_id: photos.result.photos[0][0].file_id,
    })
    return file.ok ? file.result.file_path : ""
  } catch (e) {
    console.error("Error fetching bot photo:", e)
    return ""
  }
}

/**
 * Validate a saved bot with `getMe`. A network failure throws, so the caller
 * can tell it apart from a token Telegram refused.
 */
export async function checkBotToken(
  call: BotApiCall,
  id: string,
): Promise<{
  validation: BotValidation
  profile?: { username: string; photoPath: string }
}> {
  const data = await call(id, undefined, "getMe")
  if (!data.ok)
    return {
      validation: { isValid: false, botInfo: "Invalid Token", loading: false },
    }
  const photoPath = await botPhotoPath(call, id, data.result)
  return {
    validation: {
      isValid: true,
      botInfo: `@${data.result.username} (${data.result.first_name})`,
      loading: false,
    },
    profile: { username: data.result.username, photoPath },
  }
}

/** The network log row one Bot API call files. The token never appears. */
export function botNetworkLog({
  method,
  statusCode,
  error,
  telemetry,
  duration,
}: {
  method: string
  statusCode: number
  error?: string
  telemetry?: any
  duration: number
}): NetworkLog {
  const attempts = telemetry?.attempts
  return {
    id: crypto.randomUUID(),
    url: `https://api.telegram.org/bot.../${method}`,
    method: "POST",
    status: statusCode === 200 ? "success" : "failed",
    statusCode,
    duration: telemetry?.totalDuration || duration,
    source: "BotManagement",
    timestamp: Date.now(),
    error,
    proxyUsed: attempts?.[attempts.length - 1]?.proxyUrl,
    attempts: attempts?.length || 1,
    telemetry,
  }
}

/** The publish log row for a test message (`test`) or a quick message (`quick`). */
export function publishLogFor({
  kind,
  botId,
  botName,
  chatId,
  destName,
  text,
  result,
}: {
  kind: "test" | "quick"
  botId: string
  botName: string
  chatId: string
  destName: string
  text: string
  result: PublishResult
}): PublishLog {
  return {
    id: Date.now().toString() + Math.random().toString(36).substring(2, 7),
    summaryId: `${kind}-${Date.now()}`,
    botId,
    botName,
    chatId,
    chatName: destName,
    status: result.success ? "success" : "failed",
    error: result.error,
    timestamp: Date.now(),
    fullRequest: result.requests,
    fullResponse: result.responses,
    textSent: text,
  }
}

export const errorText = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

/** Which of the three panels a settings focus shows. */
export function visiblePanels(
  focus: "publishing" | "bot-credentials" | "destinations" | "quick-message",
  botCount: number,
  destCount: number,
) {
  const all = focus === "publishing"
  return {
    credentials: all || focus === "bot-credentials",
    destinations: all || focus === "destinations",
    quickMessage:
      (all || focus === "quick-message") && botCount > 0 && destCount > 0,
  }
}
