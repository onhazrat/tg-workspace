import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import type { Post, PostMediaKind } from "@/types"

/** A post this long collapses behind "Show More". */
export function isLongPost(text: string): boolean {
  return text.length > 900 || text.split("\n").length > 14
}

/** " (n)" after the Grouped badge, for an album of more than one. */
export function mediaBadgeSuffix(kind: PostMediaKind, post: Post): string {
  const count = post.media?.groupedCount
  return kind === "grouped" && count != null && count > 1 ? ` (${count})` : ""
}

/** When a post was published; older rows carry only the date string. */
export const postTime = (post: Post): number =>
  post.timestamp || new Date(post.date).getTime()

export type TranslateStep = "ignore" | "hide" | "show" | "fetch"

/** What the Translate button does next, given what the card already has. */
export function nextTranslateStep(state: {
  translating: boolean
  translated: boolean
  showing: boolean
}): TranslateStep {
  if (state.translating) return "ignore"
  if (!state.translated) return "fetch"
  return state.showing ? "hide" : "show"
}

/**
 * Where a reply's parent is stored, if it can be: the Channel Telegram linked
 * to, else the reply's own. A link that names no public Channel is a private
 * parent (`/c/…`), which no lookup can find.
 */
export function replyParentRef(
  post: Post,
): { channelName: string; postId: number } | null {
  if (post.replyToPostId == null) return null
  const { channel, url } = post.replyTo ?? {}
  if (url && !channel) return null
  return {
    channelName: channel || post.channelName,
    postId: post.replyToPostId,
  }
}

/** The parent on Telegram: the link Telegram gave, else the reply's Channel. */
export function replyParentUrl(reply: Post, parentId: number): string {
  return (
    reply.replyTo?.url ?? telegramWebViewPostUrl(reply.channelName, parentId)
  )
}
