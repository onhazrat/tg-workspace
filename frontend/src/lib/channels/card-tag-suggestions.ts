import type { Channel } from "@/types"
import { getTagNames } from "./channel-tag-model"
import { isVirtualGroupTag } from "./virtual-group-tags"

export type CardTagSuggestion = {
  tag: string
  /** Channels carrying the tag. */
  total: number
}

/**
 * What a card's tag field offers: the Account's tags this Channel lacks,
 * minus Setting groups' virtual tags. Ranked by how many of the Channels
 * sharing a tag with this one carry the tag, then by how many Channels carry
 * it, then by name. The bulk bar ranks its own way (`bulk-tag-suggestions`).
 */
export function cardTagSuggestions(
  channels: readonly Pick<Channel, "tags">[],
  current: readonly string[],
): CardTagSuggestion[] {
  const mine = new Set(current.map((t) => t.toLowerCase()))
  const total = new Map<string, number>()
  const together = new Map<string, number>()
  for (const channel of channels) {
    const names = getTagNames(channel.tags)
    const near = names.some((t) => mine.has(t.toLowerCase()))
    for (const tag of names) {
      total.set(tag, (total.get(tag) ?? 0) + 1)
      if (near) together.set(tag, (together.get(tag) ?? 0) + 1)
    }
  }
  const pairing = (tag: string) => together.get(tag) ?? 0
  return [...total.keys()]
    .filter((tag) => !mine.has(tag.toLowerCase()) && !isVirtualGroupTag(tag))
    .sort(
      (a, b) =>
        pairing(b) - pairing(a) ||
        (total.get(b) ?? 0) - (total.get(a) ?? 0) ||
        a.localeCompare(b),
    )
    .map((tag) => ({ tag, total: total.get(tag) ?? 0 }))
}

/** The suggestions matching `typed`: prefix matches first, then substrings. */
export function matchCardTags(
  suggestions: CardTagSuggestion[],
  typed: string,
): CardTagSuggestion[] {
  const q = typed.trim().toLowerCase()
  if (!q) return suggestions
  const starts = (s: CardTagSuggestion) => s.tag.toLowerCase().startsWith(q)
  return [
    ...suggestions.filter(starts),
    ...suggestions.filter((s) => !starts(s) && s.tag.toLowerCase().includes(q)),
  ]
}
