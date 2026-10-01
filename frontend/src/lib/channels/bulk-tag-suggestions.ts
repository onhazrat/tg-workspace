import type { Channel } from "@/types"
import { getTagNames } from "./channel-tag-model"

export type TagSuggestion = {
  tag: string
  /** Channels carrying the tag. */
  total: number
  /** Of those, how many are in the action set. */
  inTargets: number
}

const mostFirst =
  (count: (s: TagSuggestion) => number) =>
  (a: TagSuggestion, b: TagSuggestion) =>
    count(b) - count(a) || a.tag.localeCompare(b.tag)

/**
 * What the bulk tag fields complete to (CTB-05). Add: every tag on the
 * Account's Channels, most used first, minus those every Channel in the action
 * set already has. Remove: the tags on the action set, most common there first.
 * `targets` is the action set CTB-04's limit gives, not the whole selection.
 */
export function bulkTagSuggestions(
  channels: Channel[],
  targets: ReadonlySet<string>,
): { add: TagSuggestion[]; remove: TagSuggestion[] } {
  const total = new Map<string, number>()
  const inTargets = new Map<string, number>()
  for (const channel of channels) {
    for (const tag of getTagNames(channel.tags)) {
      total.set(tag, (total.get(tag) ?? 0) + 1)
      if (targets.has(channel.name))
        inTargets.set(tag, (inTargets.get(tag) ?? 0) + 1)
    }
  }
  const rows = (tags: Iterable<string>): TagSuggestion[] =>
    [...tags].map((tag) => ({
      tag,
      total: total.get(tag) ?? 0,
      inTargets: inTargets.get(tag) ?? 0,
    }))
  return {
    add: rows(total.keys())
      .filter((s) => s.inTargets < targets.size)
      .sort(mostFirst((s) => s.total)),
    remove: rows(inTargets.keys()).sort(mostFirst((s) => s.inTargets)),
  }
}

/** The best suggestion starting with `typed`, ignoring case. */
export function completeTag(
  suggestions: TagSuggestion[],
  typed: string,
): TagSuggestion | undefined {
  const prefix = typed.toLowerCase()
  return prefix
    ? suggestions.find((s) => s.tag.toLowerCase().startsWith(prefix))
    : undefined
}
