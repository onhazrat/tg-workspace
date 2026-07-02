import type { Channel } from "@/types"

import { getTagNames } from "./channel-tag-model"

interface FormatChannelsForPromptOptions {
  includeBio: boolean
  includeTags: boolean
}

export function formatChannelsForPrompt(
  channels: Channel[],
  selectedNames: Iterable<string>,
  options: FormatChannelsForPromptOptions,
): string {
  const selectedSet = new Set(selectedNames)
  const selectedChannels = channels.filter((channel) => selectedSet.has(channel.name))

  if (selectedChannels.length === 0) return ""

  if (!options.includeBio && !options.includeTags) {
    return selectedChannels.map((channel) => channel.name).join(", ")
  }

  return selectedChannels
    .map((channel) => {
      const lines = [`### ${channel.name}`]

      if (options.includeBio && channel.bio?.trim()) {
        lines.push(`Bio: ${channel.bio.trim()}`)
      }

      if (options.includeTags) {
        const names = getTagNames(channel.tags)
        if (names.length > 0) {
          lines.push(`Current tags: ${names.join(", ")}`)
        }
      }

      return lines.join("\n")
    })
    .join("\n\n")
}
