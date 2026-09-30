import {
  type ChannelFilter,
  matchesChannelFilter,
} from "@/lib/channels/channel-filter"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import { languageName } from "@/lib/language-name"
import type { Channel } from "@/types"

export type ChannelGridFilters = {
  filter: ChannelFilter
  search: string
}

/**
 * The Shown Channels: those the Channel filter passes, narrowed by the
 * free-text search over name, display name, and tag names.
 *
 * Matches the historical inline behavior exactly: the search query is
 * lowercased but NOT trimmed for matching (trimming only decides whether the
 * search filter applies at all).
 */
export function filterChannelsForGrid(
  channels: Channel[],
  { filter, search }: ChannelGridFilters,
): Channel[] {
  let result =
    filter.children.length > 0
      ? channels.filter((channel) => matchesChannelFilter(filter, channel))
      : channels
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

export type ChannelLanguageOption = { code: string; name: string }

/**
 * Each Language code across all channels once, for the Languages dropdown.
 * The option's value is the code, which is what `filterChannelsForGrid`
 * matches; the options are sorted by the name the reader sees.
 */
export function collectChannelLanguages(
  channels: Channel[],
  locale?: string,
): ChannelLanguageOption[] {
  const codes = new Set<string>()
  for (const c of channels) {
    if (c.language) codes.add(c.language)
  }
  return Array.from(codes, (code) => ({
    code,
    name: languageName(code, locale),
  })).sort((a, b) => a.name.localeCompare(b.name, locale))
}
