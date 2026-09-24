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
