/**
 * Render post body text as React nodes, turning its Links into anchors while
 * preserving the search-term highlight applied elsewhere (LINK-01, ADR-022).
 *
 * A Post scraped since LINK-01 carries `linkSpans`, every Link Telegram
 * marked, positioned in UTF-16 units, which is what `String.slice` counts. A
 * Post stored before it carries `null`, and so does translated text, which has
 * no positions; both fall back to finding mentions and addresses in the words.
 *
 * Handle shape and validity match `telegram-handles.ts` so the Posts tab, the
 * Discover mention signal, and the backend stay in sync.
 */

import { Fragment, type MouseEvent, type ReactNode } from "react"
import {
  channelFromTelegramPath,
  escapeRegExp,
  isValidChannelHandle,
  telegramHosts,
} from "@/lib/posts/telegram-handles"
import {
  telegramWebBaseUrl,
  telegramWebViewChannelUrl,
  telegramWebViewPostUrl,
} from "@/lib/telegram-web"
import { highlightText } from "@/lib/utils"
import type { PostLinkSpan } from "@/types"

// Same guard/shape as extractMentions: reject email locals (`user@x`) and
// `foo/@bar` by requiring the `@` not to follow a word char, `@`, or `/`.
const MENTION_RE = /(^|[^\w@/])@([A-Za-z][A-Za-z0-9_]{4,31})(?![\w])/g

/** `tg:` and friends only work with an app installed, and a relative or
 * `javascript:` href is never one Telegram wrote for a reader (ADR-022). */
const CLICKABLE_PROTOCOLS: ReadonlySet<string> = new Set([
  "http:",
  "https:",
  "mailto:",
])

/**
 * Where a Link opens, or null to leave its words plain.
 *
 * The stored href is what Telegram wrote; sending it through the configured
 * web view or mirror happens here, so no row bakes in a deployment setting. A
 * Channel or one of its Posts opens the web view, as mentions always have;
 * any other Telegram path keeps its path on the configured domain.
 */
function linkHref(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!CLICKABLE_PROTOCOLS.has(parsed.protocol)) return null
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "")
  if (!telegramHosts().includes(host)) return url

  const handle = channelFromTelegramPath(parsed.pathname)
  if (handle) {
    const segments = parsed.pathname.split("/").filter(Boolean)
    const postId = segments[segments[0]?.toLowerCase() === "s" ? 2 : 1] ?? ""
    return /^\d+$/.test(postId)
      ? telegramWebViewPostUrl(handle, Number(postId))
      : telegramWebViewChannelUrl(handle)
  }
  return `${telegramWebBaseUrl()}${parsed.pathname}${parsed.search}${parsed.hash}`
}

// ponytail: trims a closing bracket that belongs to the address too
// (`wiki/Foo_(bar)`); balance the brackets if that ever matters.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}]+$/

/**
 * `http(s)://` addresses, and scheme-less paths on a Telegram host. A bare
 * domain is never guessed at, because `file.txt` and `e.g.` read as one.
 */
function addressRe(): RegExp {
  const hosts = telegramHosts().map(escapeRegExp).join("|")
  return new RegExp(
    `https?://[^\\s<>"]+|(?<![\\w@./])(?:www\\.)?(?:${hosts})/[^\\s<>"]+`,
    "gi",
  )
}

/** Links found in words that carry no stored positions. */
function fallbackSpans(text: string): PostLinkSpan[] {
  const spans: PostLinkSpan[] = []
  for (const match of text.matchAll(addressRe())) {
    const words = match[0].replace(TRAILING_PUNCTUATION, "")
    if (!words) continue
    spans.push({
      offset: match.index,
      length: words.length,
      url: /^https?:/i.test(words) ? words : `https://${words}`,
    })
  }
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = match[2]
    if (!isValidChannelHandle(handle)) continue
    spans.push({
      offset: match.index + (match[1] ?? "").length,
      length: handle.length + 1,
      url: `https://t.me/${handle}`,
    })
  }
  return spans.sort((a, b) => a.offset - b.offset)
}

const keepClickInLink = (e: MouseEvent) => e.stopPropagation()

export function renderPostText(
  text: string,
  highlight: string,
  linkSpans?: PostLinkSpan[] | null,
): ReactNode {
  if (!text) return text

  const spans = linkSpans ?? fallbackSpans(text)
  const nodes: ReactNode[] = []
  let cursor = 0
  let key = 0

  for (const span of spans) {
    const end = span.offset + span.length
    if (span.offset < cursor || span.length <= 0 || end > text.length) continue
    const href = linkHref(span.url)
    if (href === null) continue
    const words = text.slice(span.offset, end)
    const mention = /^@/.test(words) && isValidChannelHandle(words)

    if (span.offset > cursor) {
      nodes.push(
        <Fragment key={key++}>
          {highlightText(text.slice(cursor, span.offset), highlight)}
        </Fragment>,
      )
    }
    nodes.push(
      <a
        key={key++}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        data-testid={
          mention ? `post-mention-link-${words.slice(1)}` : "post-body-link"
        }
        title={words === span.url ? undefined : href}
        onClick={keepClickInLink}
        className="text-blue-600 underline-offset-2 hover:underline dark:text-blue-400"
      >
        {highlightText(words, highlight)}
      </a>,
    )
    cursor = end
  }

  if (cursor < text.length) {
    nodes.push(
      <Fragment key={key++}>
        {highlightText(text.slice(cursor), highlight)}
      </Fragment>,
    )
  }
  return nodes
}
