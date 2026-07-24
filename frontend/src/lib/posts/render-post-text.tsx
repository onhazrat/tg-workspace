/**
 * Render post body text as React nodes, turning valid `@handle` mentions into
 * links to the channel's Telegram web view (same target as Discover's mention
 * links) while preserving the search-term highlight applied elsewhere.
 *
 * Handle shape and validity match `telegram-handles.ts` so the Posts tab, the
 * Discover mention signal, and the backend stay in sync.
 */

import { Fragment, type ReactNode } from "react"
import { isValidChannelHandle } from "@/lib/posts/telegram-handles"
import { telegramWebViewChannelUrl } from "@/lib/telegram-web"
import { highlightText } from "@/lib/utils"

// Same guard/shape as extractMentions: reject email locals (`user@x`) and
// `foo/@bar` by requiring the `@` not to follow a word char, `@`, or `/`.
const MENTION_RE = /(^|[^\w@/])@([A-Za-z][A-Za-z0-9_]{4,31})(?![\w])/g

export function renderPostText(text: string, highlight: string): ReactNode {
  if (!text) return text

  const nodes: ReactNode[] = []
  let lastIndex = 0
  let key = 0
  MENTION_RE.lastIndex = 0
  let match = MENTION_RE.exec(text)

  while (match !== null) {
    const handle = match[2]
    if (isValidChannelHandle(handle)) {
      const guard = match[1] ?? ""
      const mentionStart = match.index + guard.length
      const mentionEnd = mentionStart + 1 + handle.length

      const before = text.slice(lastIndex, mentionStart)
      if (before) {
        nodes.push(
          <Fragment key={key++}>{highlightText(before, highlight)}</Fragment>,
        )
      }

      nodes.push(
        <a
          key={key++}
          href={telegramWebViewChannelUrl(handle)}
          target="_blank"
          rel="noopener noreferrer"
          data-testid={`post-mention-link-${handle}`}
          className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
        >
          {highlightText(text.slice(mentionStart, mentionEnd), highlight)}
        </a>,
      )

      lastIndex = mentionEnd
    }
    match = MENTION_RE.exec(text)
  }

  const rest = text.slice(lastIndex)
  if (rest) {
    nodes.push(
      <Fragment key={key++}>{highlightText(rest, highlight)}</Fragment>,
    )
  }

  return nodes
}
