/**
 * The Posts filter bar's words and the parsing behind its typed numbers
 * (PFB-02). Pure, so the copy the pills and chips print is tested once here
 * rather than read out of rendered components.
 */

import { languageName } from "@/lib/language-name"
import {
  MEDIA_KIND_OPTIONS,
  type MediaFilterValue,
  type MediaKind,
} from "@/lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
  PostSortOrder,
} from "@/lib/posts/post-view"
import type { Post } from "@/types"

export const POST_TYPE_OPTIONS: {
  label: string
  value: ForwardedFilterValue
}[] = [
  { label: "All posts", value: "all" },
  { label: "Original", value: "original" },
  { label: "Forwarded", value: "forwarded" },
  {
    label: "Forwarded from unfollowed channels",
    value: "unfollowed_forwarded",
  },
]

/** The Order pill's choices, in its order. The palette lists the same two. */
export const POST_ORDER_OPTIONS: { label: string; value: PostSortOrder }[] = [
  { label: "Newest first", value: "newest" },
  { label: "Oldest first", value: "oldest" },
]

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
  return `${capCard(order, cap).title} ${cap}`
}

/** The first "Which ones" card, which follows the Order and never says newest under oldest. */
export function capCard(
  order: PostSortOrder,
  cap: number | string,
): { title: string; body: string } {
  return order === "oldest"
    ? { title: "Oldest", body: `The ${cap} earliest` }
    : { title: "Newest", body: `The ${cap} most recent` }
}

export function mediaLabel(kind: MediaKind): string {
  return labelOf(MEDIA_KIND_OPTIONS, kind)
}

export function mediaSummary(media: MediaFilterValue): string {
  if (media.length === 0) return "Any"
  if (media.length === 1) return mediaLabel(media[0])
  return `${media.length} selected`
}

/** `zxx` and `und` are codes the detector writes, not Languages to name. */
export function languageLabel(code: string, locale?: string): string {
  if (code === "zxx") return "No text"
  if (code === "und") return "Undetermined"
  return languageName(code, locale)
}

export function languageSummary(languages: string[]): string {
  if (languages.length === 0) return "Any"
  if (languages.length === 1) return languageLabel(languages[0])
  return `${languages.length} selected`
}

/** What removing one footer chip clears. */
export type ChipClears =
  | "keyword"
  | "meaning"
  | "related"
  | "forwarded"
  | "cap"
  | { media: MediaKind }
  | { language: string }

export interface ActiveFilter {
  key: string
  label: string
  clears: ChipClears
}

export interface FilterBarState {
  keyword: string
  meaning: string
  relatedTo: Post | null
  forwarded: ForwardedFilterValue
  media: MediaFilterValue
  languages: string[]
  cap: number
  capMode: MaxPostsPerChannelMode
  order: PostSortOrder
}

/**
 * Every filter that narrows which Posts are shown, as a footer chip.
 *
 * The order and grouping change how the Posts are laid out rather than which
 * Posts they are, so they fill their pills and are not chips.
 */
export function activeFilters(state: FilterBarState): ActiveFilter[] {
  const chips: ActiveFilter[] = []
  if (state.keyword.trim())
    chips.push({
      key: "keyword",
      label: `"${state.keyword.trim()}"`,
      clears: "keyword",
    })
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
  if (state.forwarded !== "all")
    chips.push({
      key: "forwarded",
      label: labelOf(POST_TYPE_OPTIONS, state.forwarded),
      clears: "forwarded",
    })
  for (const kind of state.media)
    chips.push({
      key: `media-${kind}`,
      label: mediaLabel(kind),
      clears: { media: kind },
    })
  for (const code of state.languages)
    chips.push({
      key: `language-${code}`,
      label: languageLabel(code),
      clears: { language: code },
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
  setPostSearch: (value: string) => void
  setSemanticSearchQuery: (value: string) => void
  setRelatedPostSearch: (value: Post | null) => void
  setForwardedFilter: (value: ForwardedFilterValue) => void
  setMaxPostsPerChannel: (value: number) => void
  setMediaFilter: (
    update: (media: MediaFilterValue) => MediaFilterValue,
  ) => void
  setLanguageFilter: (update: (languages: string[]) => string[]) => void
}

/** Remove what one chip names, and nothing else. */
export function clearChip(what: ChipClears, set: ChipSetters): void {
  if (what === "keyword") set.setPostSearch("")
  else if (what === "meaning") set.setSemanticSearchQuery("")
  else if (what === "related") set.setRelatedPostSearch(null)
  else if (what === "forwarded") set.setForwardedFilter("all")
  else if (what === "cap") set.setMaxPostsPerChannel(0)
  else if ("media" in what)
    set.setMediaFilter((media) => media.filter((kind) => kind !== what.media))
  else
    set.setLanguageFilter((languages) =>
      languages.filter((code) => code !== what.language),
    )
}

/**
 * The Language pill's list. With counts, the Languages present, most frequent
 * first, as the server ordered them. Without (a meaning search, or counts not
 * loaded), the followed Channels' Languages in code order, uncounted. A
 * ticked Language is always listed, so it can be unticked.
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
