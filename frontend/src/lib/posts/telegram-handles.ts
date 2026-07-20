/**
 * Telegram handle / link extraction shared by Discover's mention and link signals.
 *
 * Keep the reserved-path list and handle shape in sync with the backend
 * equivalents in `backend/app/services/telegram_web.py` (`is_channel_handle`).
 */

import { telegramWebDomain } from "@/lib/telegram-web"
import type { Post } from "@/types"

/** `t.me/<segment>` paths that are never a public channel handle. */
export const RESERVED_TELEGRAM_PATHS: ReadonlySet<string> = new Set([
  "addemoji",
  "addstickers",
  "addtheme",
  "boost",
  "c",
  "iv",
  "joinchat",
  "login",
  "proxy",
  "s",
  "setlanguage",
  "share",
  "socks",
])

const HANDLE_RE = /^[A-Za-z][A-Za-z0-9_]{4,31}$/

/** Strip a leading `@` and lowercase. The single normalization point for all signal kinds. */
export function normalizeHandle(name: string): string {
  return name.replace(/^@/, "").trim().toLowerCase()
}

export function isValidChannelHandle(name: string): boolean {
  const clean = name.replace(/^@/, "").trim()
  if (!HANDLE_RE.test(clean)) return false
  return !RESERVED_TELEGRAM_PATHS.has(clean.toLowerCase())
}

function legacyDomains(): string[] {
  return [
    ...new Set([telegramWebDomain().toLowerCase(), "t.me", "telegram.me"]),
  ]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * `@handle` mentions in plain post text.
 *
 * The leading guard rejects email locals (`user@domain.com`) and `foo/@bar`
 * by requiring the `@` not to follow a word character, `@`, or `/`.
 */
export function extractMentions(text: string): string[] {
  if (!text) return []
  const found = new Set<string>()
  const re = /(^|[^\w@/])@([A-Za-z][A-Za-z0-9_]{4,31})(?![\w])/g
  let match = re.exec(text)
  while (match !== null) {
    const handle = match[2]
    if (isValidChannelHandle(handle)) found.add(normalizeHandle(handle))
    match = re.exec(text)
  }
  return [...found]
}

/**
 * Resolve the channel handle a Telegram URL path points at, or null.
 * Handles `/s/<name>` (web view) and `/<name>/<postId>` (permalink).
 */
export function channelFromTelegramPath(path: string): string | null {
  const clean = path.split(/[?#]/)[0] ?? ""
  const segments = clean.split("/").filter(Boolean)
  if (segments.length === 0) return null

  const first = segments[0]
  const candidate =
    first.toLowerCase() === "s" && segments.length > 1 ? segments[1] : first

  if (!candidate || !isValidChannelHandle(candidate)) return null
  return normalizeHandle(candidate)
}

/** Channel handles from plain-text `t.me/...` URLs in post text. */
export function extractTextLinks(text: string): string[] {
  if (!text) return []
  const domains = legacyDomains().map(escapeRegExp).join("|")
  const re = new RegExp(
    `(?:https?://)?(?:www\\.)?(?:${domains})/([^\\s<>"')\\]]+)`,
    "gi",
  )
  const found = new Set<string>()
  let match = re.exec(text)
  while (match !== null) {
    const handle = channelFromTelegramPath(match[1] ?? "")
    if (handle) found.add(handle)
    match = re.exec(text)
  }
  return [...found]
}

/**
 * All link-kind channel handles for a post: masked hrefs captured by the
 * scraper (`post.links`) unioned with plain-text URLs in `post.text`.
 *
 * The union is deduped because a plain `https://t.me/foo` is present in both
 * sources once the backfill has run, and must count as a single occurrence.
 */
export function extractPostLinkChannels(post: Post): string[] {
  const found = new Set<string>(extractTextLinks(post.text))
  for (const link of post.links ?? []) {
    if (link?.channel && isValidChannelHandle(link.channel)) {
      found.add(normalizeHandle(link.channel))
      continue
    }
    // `url` is a full href; reuse the text extractor so domain matching is shared.
    for (const handle of extractTextLinks(link?.url ?? "")) found.add(handle)
  }
  return [...found]
}
