import { getTagNames } from "@/lib/channels/channel-tag-model"
import type { Channel } from "@/types"

export type ChannelSearchMode = "all" | "tag-only"

export function parseChannelSearchQuery(query: string): {
  mode: ChannelSearchMode
  term: string
} {
  const trimmed = query.trim()
  if (!trimmed) return { mode: "all", term: "" }

  const tagPrefixMatch = trimmed.match(/^(?:tag:|#)\s*(.+)$/i)
  if (tagPrefixMatch) {
    const rawTerm = tagPrefixMatch[1].trim()
    const term = rawTerm.startsWith("#") ? rawTerm.slice(1).trim() : rawTerm
    return { mode: "tag-only", term: term.toLowerCase() }
  }

  return { mode: "all", term: trimmed.toLowerCase() }
}

export function channelMatchesSearch(
  channel: Channel,
  mode: ChannelSearchMode,
  term: string,
): boolean {
  if (!term) return true

  if (mode === "tag-only") {
    return getTagNames(channel.tags).some((tag) =>
      tag.toLowerCase().includes(term),
    )
  }

  return (
    channel.name.toLowerCase().includes(term) ||
    channel.displayName?.toLowerCase().includes(term) ||
    getTagNames(channel.tags).some((tag) => tag.toLowerCase().includes(term))
  )
}

export function filterChannelsByQuery(
  channels: Channel[],
  query: string,
): Channel[] {
  const { mode, term } = parseChannelSearchQuery(query)
  if (!term) return channels

  return channels.filter((channel) => channelMatchesSearch(channel, mode, term))
}

/**
 * A channel whose stored posts do not reach the scrape retention cutoff.
 * Undefined means "not yet determined", which is not the same as incomplete.
 */
export function isPartialHistoryChannel(channel: Channel): boolean {
  return channel.historyCompleteToCutoff === false
}

/** Channels whose stored posts do not reach the scrape retention cutoff. */
export function filterPartialHistoryChannels(channels: Channel[]): Channel[] {
  return channels.filter(isPartialHistoryChannel)
}
