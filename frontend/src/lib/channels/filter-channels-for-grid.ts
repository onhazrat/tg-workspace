import {
  type ChannelFilter,
  matchesChannelFilter,
} from "@/lib/channels/channel-filter"
import type { MetricInputs } from "@/lib/channels/channel-metrics"
import { getTagNames } from "@/lib/channels/channel-tag-model"
import {
  languageLabel,
  languageValue,
  sortLanguages,
} from "@/lib/language-name"
import type { Channel } from "@/types"

export type ChannelGridFilters = {
  filter: ChannelFilter
  search: string
  /** What the filter's number Conditions read. */
  metrics: MetricInputs
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
  { filter, search, metrics }: ChannelGridFilters,
): Channel[] {
  let result =
    filter.children.length > 0
      ? channels.filter((channel) =>
          matchesChannelFilter(filter, channel, metrics),
        )
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
 * Each Language value across all channels once, for the Languages dropdown,
 * `null` for a Channel not read yet. The option's value is what
 * `filterChannelsForGrid` matches; the order is every Language menu's.
 */
export function collectChannelLanguages(
  channels: Channel[],
  locale?: string,
): ChannelLanguageOption[] {
  const counts = new Map<string, number>()
  for (const c of channels) {
    const value = languageValue(c.language)
    counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return sortLanguages(
    Array.from(counts, ([value, count]) => ({ value, count })),
    locale,
  ).map(({ value }) => ({ code: value, name: languageLabel(value, locale) }))
}
