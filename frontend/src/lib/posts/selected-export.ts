/**
 * Copy links and Export Markdown (PTR-06): the selected Posts the filter
 * shows, taken elsewhere. Both read the feed with `onlySelected`, at most
 * `EXPORT_LIMIT` Posts, the feed's own page bound.
 */
import { telegramWebViewPostUrl } from "@/lib/telegram-web"
import type { Post } from "@/types"

export const EXPORT_LIMIT = 5000

const link = (p: Post) => telegramWebViewPostUrl(p.channelName, p.id)

/** One Telegram link per line, in the feed's order. */
export const postLinks = (posts: Post[]): string => posts.map(link).join("\n")

const stamp = (ms: number) =>
  `${new Date(ms).toISOString().slice(0, 16).replace("T", " ")} UTC`

/** Each Post under a heading naming its Channel and time, then its link. */
export const postsMarkdown = (posts: Post[]): string =>
  posts
    .map((p) =>
      [
        `## @${p.channelName} · ${stamp(p.timestamp)}`,
        p.text.trim(),
        `[Open in Telegram](${link(p)})`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    )
    .join("\n\n---\n\n")

/** What to add when the limit cut the list short, or nothing. */
export const limitNote = (count: number): string =>
  count >= EXPORT_LIMIT
    ? ` Only the first ${EXPORT_LIMIT.toLocaleString("en-US")} selected Posts; narrow the filter for the rest.`
    : ""
