/**
 * The rules a Summary is written and published by, with no React and no I/O,
 * so they can be tested directly. `AIContext` and `SummaryView` both call these.
 * What a Publication sends is the server's plan (SUMTAB-09), not a rule here.
 */
import type {
  BotCredential,
  Channel,
  ChatDestination,
  Post,
  Summary,
} from "@/types"

const CITATION = /\[([^\]]+?)\s*#(\d+)\]/g

/** The distinct `[channelName #id]` references in a summary body, in order of first appearance. */
export function parseCitationRefs(
  text: string,
): { channelName: string; postId: number }[] {
  const refs = new Map<string, { channelName: string; postId: number }>()
  for (const match of text.matchAll(CITATION)) {
    const channelName = match[1].trim()
    const postId = parseInt(match[2], 10)
    const key = `${channelName}-${postId}`
    if (!refs.has(key)) refs.set(key, { channelName, postId })
  }
  return [...refs.values()]
}

/** The cited posts found in `availablePosts`, keyed `channel-id`; a citation with no post is left out. */
export function extractCitedPosts(
  text: string,
  availablePosts: Post[],
): Record<string, Post> {
  const cited: Record<string, Post> = {}
  for (const { channelName, postId } of parseCitationRefs(text)) {
    const post = availablePosts.find(
      (p) => p.channelName === channelName && p.id === postId,
    )
    if (post) cited[`${channelName}-${postId}`] = post
  }
  return cited
}

/** Channels in the summary that have not been synced up to `endMs`. */
export function channelsNeedingSync(
  channels: Channel[],
  summaryChannels: string[],
  endMs: number,
): Channel[] {
  return channels.filter(
    (c) => summaryChannels.includes(c.name) && (c.lastUpdated || 0) < endMs,
  )
}

export const noPostsText = (startMs: number, endMs: number): string =>
  `No new posts found in the selected channels between ${new Date(startMs).toLocaleString()} and ${new Date(endMs).toLocaleString()}.`

/**
 * The Summary a regeneration writes: what the run produced plus the settings
 * carried over from `previous`. The frozen Scope is not here, because the
 * submission already wrote it and this write cannot touch it (AW-07).
 */
export function successorSummary(
  previous: Summary,
  run: {
    id: string
    text: string
    postCount: number
    citedPosts: Record<string, Post>
    /** The Key the run actually paid with, i.e. the live selection (BYOK-03). */
    selectedAiKeyId: string | null
    now: number
  },
): Summary {
  return {
    id: run.id,
    text: run.text,
    language: previous.language,
    model: previous.model,
    postCount: run.postCount,
    timestamp: run.now,
    autoRegenerate: true,
    // `previous.aiKeyId` is only the fallback for a Summary scheduled before
    // the field existed, where nothing is selected and the server picked. See
    // `generateBackgroundSummary` for why the live selection wins.
    aiKeyId: run.selectedAiKeyId ?? previous.aiKeyId ?? undefined,
    autoPublish: previous.autoPublish,
    publishBotId: previous.publishBotId,
    publishChatId: previous.publishChatId,
    // Off unless it was set on explicitly (SUMTAB-09).
    sendMetadata: previous.sendMetadata === true,
    metadataInFirstPart: previous.metadataInFirstPart,
    postSearch: previous.postSearch,
    semanticSearchQuery: previous.semanticSearchQuery,
    semanticSearchRespectsChannels: previous.semanticSearchRespectsChannels,
    citedPosts: run.citedPosts,
  }
}

/** Where a regenerated summary auto-publishes, or null when it should not. */
export function autoPublishTarget(
  previous: Summary,
  postCount: number,
  bots: BotCredential[],
  destinations: ChatDestination[],
): { bot: BotCredential; dest: ChatDestination } | null {
  if (!previous.autoPublish || postCount === 0) return null
  const bot = bots.find((b) => b.id === previous.publishBotId)
  const dest = destinations.find((d) => d.id === previous.publishChatId)
  return bot && dest ? { bot, dest } : null
}

const QUOTA_MARKERS = ["429", "RESOURCE_EXHAUSTED", "quota", "rate limit"]

/**
 * A readable message for a failed generation, and whether it was a quota
 * refusal, which is what stops auto-regeneration from retrying into the same
 * wall. A JSON body is the provider's own error; only its `code` decides quota
 * then, because its message can mention "quota" for other reasons.
 */
export function classifyAiError(err: unknown): {
  message: string
  quotaExceeded: boolean
} {
  const message = err instanceof Error ? err.message : "Unknown error"
  if (message.startsWith("{") && message.endsWith("}")) {
    try {
      const inner = JSON.parse(message).error
      if (inner?.message)
        return { message: inner.message, quotaExceeded: inner.code === 429 }
    } catch {
      // Not JSON after all; fall through and report it as it is.
    }
    return { message, quotaExceeded: false }
  }
  const lower = message.toLowerCase()
  return {
    message,
    quotaExceeded: QUOTA_MARKERS.some((m) => lower.includes(m.toLowerCase())),
  }
}
