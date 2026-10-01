/**
 * The Posts filter bar's words and the parsing behind its typed numbers
 * (PFB-02). Pure, so the copy the pills and chips print is tested once here
 * rather than read out of rendered components. The Post filter's own words
 * are `post-filter.ts` (PTR-03).
 */

import { languageName } from "@/lib/language-name"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  ViewMeasure,
} from "@/lib/posts/post-view"
import type { Post } from "@/types"

/** The Order pill's choices, in its order. The palette lists the same four. */
export const POST_ORDER_OPTIONS: { label: string; value: PostSortOrder }[] = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
  { label: "Most views", value: "most_views" },
  { label: "Fewest views", value: "fewest_views" },
]

/** The two measures a views bound and the views orders read, in this order. */
export const VIEW_MEASURE_OPTIONS: { label: string; value: ViewMeasure }[] = [
  { label: "Views", value: "views" },
  { label: "Estimated views", value: "estimated" },
]

/**
 * The one line each measure is explained by. The floor is the deployment's
 * estimation floor, which an Operator can move from its default of 3 hours.
 */
export function viewMeasureDescription(
  measure: ViewMeasure,
  floorHours: number,
): string {
  if (measure === "views")
    return "What Telegram shows now. Young posts read low."
  const under = floorHours === 1 ? "1 hour" : `${floorHours} hours`
  return `What a post's views are expected to settle at. Posts under ${under} are too new to judge.`
}

/** The Per channel pill's one-click caps. */
export const CAP_SHORTCUTS = [1, 3, 5, 10, 20]

export function labelOf<T extends string>(
  options: { label: string; value: T }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value
}

/**
 * A count as a person types it: `12`, `1,000`, `2 500`, `25k`, `1.5M`.
 * `null` for blank or anything that is not a non-negative number.
 */
export function parseCount(raw: string): number | null {
  const match = raw
    .trim()
    .replace(/[,_\s]/g, "")
    .match(/^(\d+(?:\.\d+)?)([km]?)$/i)
  if (!match) return null
  const unit = match[2].toLowerCase()
  const multiplier = unit === "k" ? 1_000 : unit === "m" ? 1_000_000 : 1
  return Math.round(Number(match[1]) * multiplier)
}

/** The Per channel pill's value: the first N named for the order it follows. */
export function capPhrase(
  cap: number,
  mode: MaxPostsPerChannelMode,
  order: PostSortOrder,
): string {
  if (cap <= 0) return "No limit"
  if (mode === "random") return `Random ${cap}`
  if (order === "most_views") return `Top ${cap} by views`
  if (order === "fewest_views") return `Bottom ${cap} by views`
  return `${capCard(order, cap).title} ${cap}`
}

/** The first "Which ones" card, which follows the Order and never says newest under oldest. */
export function capCard(
  order: PostSortOrder,
  cap: number | string,
): { title: string; body: string } {
  if (order === "oldest")
    return { title: "Oldest", body: `The ${cap} earliest` }
  if (order === "most_views")
    return { title: "Top by views", body: `The ${cap} with the most views` }
  if (order === "fewest_views")
    return {
      title: "Bottom by views",
      body: `The ${cap} with the fewest views`,
    }
  return { title: "Newest", body: `The ${cap} most recent` }
}

/** `zxx` and `und` are codes the detector writes, not Languages to name. */
export function languageLabel(code: string, locale?: string): string {
  if (code === "zxx") return "No text"
  if (code === "und") return "Undetermined"
  return languageName(code, locale)
}

/**
 * What removing one footer chip clears. The keyword and the Post filter's
 * Conditions are the filter row's chips now (PTR-03).
 */
export type ChipClears = "meaning" | "related" | "cap"

export interface ActiveFilter {
  key: string
  label: string
  clears: ChipClears
}

export interface FilterBarState {
  meaning: string
  relatedTo: Post | null
  cap: number
  capMode: MaxPostsPerChannelMode
  order: PostSortOrder
}

/**
 * What narrows the feed outside the filter row, as a footer chip: a meaning
 * search, a related-Post search and the per-channel cap.
 *
 * The order and grouping change how the Posts are laid out rather than which
 * Posts they are, so they fill their pills and are not chips.
 */
export function activeFilters(state: FilterBarState): ActiveFilter[] {
  const chips: ActiveFilter[] = []
  if (state.meaning.trim())
    chips.push({
      key: "meaning",
      label: `Meaning: ${state.meaning.trim()}`,
      clears: "meaning",
    })
  if (state.relatedTo)
    chips.push({
      key: "related",
      label: `Related to: ${state.relatedTo.text.slice(0, 40)}`,
      clears: "related",
    })
  if (state.cap > 0)
    chips.push({
      key: "cap",
      label: `${capPhrase(state.cap, state.capMode, state.order)} per channel`,
      clears: "cap",
    })
  return chips
}

export type SearchMode = "keyword" | "meaning"

/** The meaning query Enter runs, or `null` when this key runs nothing. */
export function meaningQueryOnKey(
  meaning: boolean,
  key: string,
  draft: string,
): string | null {
  return meaning && key === "Enter" && draft.trim() ? draft.trim() : null
}

/** The setters a footer chip's removal reaches. */
export interface ChipSetters {
  setSemanticSearchQuery: (value: string) => void
  setRelatedPostSearch: (value: Post | null) => void
  setMaxPostsPerChannel: (value: number) => void
}

/** Remove what one chip names, and nothing else. */
export function clearChip(what: ChipClears, set: ChipSetters): void {
  if (what === "meaning") set.setSemanticSearchQuery("")
  else if (what === "related") set.setRelatedPostSearch(null)
  else set.setMaxPostsPerChannel(0)
}

/**
 * The Language dropdown's list. With counts, the Languages present, most
 * frequent first, as the server ordered them. Without (a meaning search, or
 * counts not loaded), the followed Channels' Languages in code order,
 * uncounted. A funnelled Language is always listed, so it can be unfunnelled.
 */
export function languageOptions(
  counted: { value: string; count: number }[] | undefined,
  channelLanguages: string[],
  ticked: string[],
): { code: string; count?: number }[] {
  const options: { code: string; count?: number }[] = counted
    ? counted.map((facet) => ({ code: facet.value, count: facet.count }))
    : [...new Set(channelLanguages)].sort().map((code) => ({ code }))
  for (const code of ticked)
    if (!options.some((option) => option.code === code))
      options.push(counted ? { code, count: 0 } : { code })
  return options
}
