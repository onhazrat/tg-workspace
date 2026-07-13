import { getTagNames } from "@/lib/channels/channel-tag-model"
import type { Channel } from "@/types"

export type ChannelGridFilters = {
  groupFilter: string
  languageFilter: string
  search: string
}

/**
 * Apply the Channels tab filters in order: setting group, language, then
 * free-text search over name, display name, and tag names.
 *
 * Matches the historical inline behavior exactly: the search query is
 * lowercased but NOT trimmed for matching (trimming only decides whether the
 * search filter applies at all).
 */
export function filterChannelsForGrid(
  channels: Channel[],
  { groupFilter, languageFilter, search }: ChannelGridFilters,
): Channel[] {
  let result = channels
  if (groupFilter) {
    result = result.filter((channel) => channel.settingGroupId === groupFilter)
  }
  if (languageFilter) {
    result = result.filter((c) => c.language === languageFilter)
  }
  if (search.trim()) {
    const query = search.toLowerCase()
    result = result.filter(
      (c) =>
        c.name.toLowerCase().includes(query) ||
        c.displayName?.toLowerCase().includes(query) ||
        getTagNames(c.tags).some((t) => t.toLowerCase().includes(query)),
    )
  }
  return result
}

/** Unique languages across all channels, sorted for the Lang filter select. */
export function collectChannelLanguages(channels: Channel[]): string[] {
  const langs = new Set<string>()
  channels.forEach((c) => {
    if (c.language) langs.add(c.language)
  })
  return Array.from(langs).sort()
}
