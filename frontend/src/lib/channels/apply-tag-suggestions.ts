import type { Channel } from "@/types"

import { mergeAiTags, removeAiTags } from "./channel-tag-model"
import type { ParsedTagSuggestions } from "./parse-tag-response"

export type TagApplyMode = "add" | "remove"

export interface TagApplyResult {
  channelsUpdated: number
  tagsAdded: number
  tagsRemoved: number
}

function normalizeChannelKey(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase()
}

export function buildChannelLookup(channels: Channel[]): Map<string, Channel> {
  const lookup = new Map<string, Channel>()
  for (const channel of channels) {
    lookup.set(normalizeChannelKey(channel.name), channel)
    if (channel.displayName?.trim()) {
      lookup.set(normalizeChannelKey(channel.displayName), channel)
    }
  }
  return lookup
}

export function resolveChannelForTagKey(
  lookup: Map<string, Channel>,
  key: string,
): Channel | undefined {
  return lookup.get(normalizeChannelKey(key))
}

export function normalizeParsedTagSuggestions(
  parsed: ParsedTagSuggestions,
  channels: Channel[],
): ParsedTagSuggestions {
  const lookup = buildChannelLookup(channels)
  const out: ParsedTagSuggestions = {}

  for (const [key, tags] of Object.entries(parsed)) {
    const channel = resolveChannelForTagKey(lookup, key)
    if (!channel) continue
    out[channel.name] = tags
  }

  return out
}

export function filterSuggestionsToSelectedChannels(
  suggestions: ParsedTagSuggestions,
  selectedChannelNames: Iterable<string>,
): ParsedTagSuggestions {
  const selected = new Set(
    [...selectedChannelNames].map((name) => normalizeChannelKey(name)),
  )
  if (selected.size === 0) return suggestions

  const out: ParsedTagSuggestions = {}
  for (const [channelName, tags] of Object.entries(suggestions)) {
    if (!selected.has(normalizeChannelKey(channelName))) continue
    out[channelName] = tags
  }
  return out
}

export function applyTagSuggestions({
  suggestions,
  channels,
  mode,
  selectedChannelNames,
}: {
  suggestions: ParsedTagSuggestions
  channels: Channel[]
  mode: TagApplyMode
  selectedChannelNames?: Iterable<string>
}): { result: TagApplyResult; updatedChannels: Channel[] } {
  const scopedSuggestions = selectedChannelNames
    ? filterSuggestionsToSelectedChannels(suggestions, selectedChannelNames)
    : suggestions

  let channelsUpdated = 0
  let tagsAdded = 0
  let tagsRemoved = 0
  const updatedChannels: Channel[] = []

  for (const [channelName, proposedTags] of Object.entries(scopedSuggestions)) {
    const channel = channels.find((entry) => entry.name === channelName)
    if (!channel) continue

    const nextTags =
      mode === "add"
        ? mergeAiTags(channel.tags, proposedTags)
        : removeAiTags(channel.tags, proposedTags)

    if (JSON.stringify(nextTags) === JSON.stringify(channel.tags ?? []))
      continue

    if (mode === "add") {
      tagsAdded += nextTags.length - (channel.tags?.length ?? 0)
    } else {
      tagsRemoved += (channel.tags?.length ?? 0) - nextTags.length
    }

    updatedChannels.push({ ...channel, tags: nextTags })
    channelsUpdated += 1
  }

  return {
    result: { channelsUpdated, tagsAdded, tagsRemoved },
    updatedChannels,
  }
}
