/**
 * The Chat tab's display rules, with no React, so they can be tested directly.
 */
import type { ChatMessage, Post } from "@/types"

/** The whole conversation as Markdown, for "Copy Chat History". */
export const chatTranscriptText = (messages: ChatMessage[]): string =>
  messages
    .map((m) => `**${m.role === "user" ? "User" : "AI Analyst"}**:\n${m.text}`)
    .join("\n\n---\n\n")

/**
 * Which parts of the feed show. The empty state is for a tab with nothing in
 * it and nothing on the way. The composer shows once there is a conversation
 * to carry on, and while one is being started, so a first turn that fails has
 * somewhere to be retried.
 */
export const chatViewSections = (
  turnCount: number,
  isChatting: boolean,
): { empty: boolean; composer: boolean } => ({
  empty: turnCount === 0 && !isChatting,
  composer: turnCount > 0 || isChatting,
})

/**
 * The prose classes for one bubble. A user bubble is ink on the page colour,
 * so its text inverts in the light theme; a model bubble follows the theme.
 * Persian gets its own face; other right-to-left languages the serif.
 */
export function turnProseClass(
  role: ChatMessage["role"],
  theme: string,
  isRTL: boolean,
  aiLanguage: string,
): string {
  const invert =
    role === "user"
      ? theme === "light"
        ? "prose-invert"
        : ""
      : "dark:prose-invert"
  const face =
    aiLanguage === "Persian"
      ? "font-persian leading-loose"
      : isRTL
        ? "font-serif leading-loose"
        : ""
  return `prose prose-sm max-w-none ${invert} ${isRTL ? "text-right" : ""} ${face}`
}

/** The source a `[channel:id]` citation in a turn points at, if it has one. */
export const citedSource = (
  sources: Post[] | undefined,
  channelName: string,
  postId: number,
): Post | undefined =>
  sources?.find((s) => s.channelName === channelName && s.id === postId)
