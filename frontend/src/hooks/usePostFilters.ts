/**
 * The Posts tab's filter and search state (G1).
 *
 * Eleven `useState`s and the effects that persist them, lifted out of
 * `ScraperContext`. This is genuinely UI state — it describes what the operator
 * has asked to see, and nothing here talks to the network.
 *
 * **These keys are deliberately *not* in `lib/settings/schema.ts`.** That
 * schema owns durable *preferences*; these are a transient view state that
 * happens to survive a reload. Folding them in would put every filter tweak
 * through the settings write path and expose them in the settings UI, which is
 * not what they are. The distinction is worth keeping — but the hand-rolled
 * browser-storage round-trip below is the price, and it is why the parse
 * fallbacks (`"random" ? … : "ordered"`) live here rather than in a zod schema.
 *
 * PFB-01 reshaped three of them without moving any: media is a JSON array of
 * kinds, the order is `newest`/`oldest`, and grouping has a key of its own. A
 * value the previous bundle stored is read into the new shape once and
 * written back in it by the effects below; `sort: "channel_time"` is where
 * grouping came from, so a stored `channel_time` with no grouping key yet
 * reads as grouped.
 *
 * PFB-03 added two more, the views measure and the views threshold, the
 * threshold as JSON `{op, value}` and anything unreadable as no threshold.
 */

import { useEffect, useState } from "react"

import { parseMediaFilterValue } from "@/lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
  MediaFilterValue,
  PostSortOrder,
  PostViewOptions,
  ViewMeasure,
  ViewsFilter,
} from "@/lib/posts/post-view"
import { scopedStorage } from "@/lib/storage/scoped"
import type { Post } from "@/types"
import { useDebouncedValue } from "./useDebouncedValue"

/** Storage keys this hook owns, before namespacing. Named once, for tests. */
export const POST_FILTER_STORAGE_KEYS = {
  maxPerChannel: "postFilter_maxPerChannel",
  maxPerChannelMode: "postFilter_maxPerChannelMode",
  sortOrder: "postFilter_sortOrder",
  groupByChannel: "postFilter_groupByChannel",
  media: "postFilter_media",
  languages: "postFilter_languages",
  viewMeasure: "postFilter_viewMeasure",
  views: "postFilter_views",
} as const

/** How long a keystroke waits before it reaches a query key. */
export const POST_SEARCH_DEBOUNCE_MS = 300

export interface PostFilters {
  postSearch: string
  setPostSearch: React.Dispatch<React.SetStateAction<string>>
  semanticSearchQuery: string
  setSemanticSearchQuery: React.Dispatch<React.SetStateAction<string>>
  semanticSearchRespectsChannels: boolean
  setSemanticSearchRespectsChannels: React.Dispatch<
    React.SetStateAction<boolean>
  >
  relatedPostSearch: Post | null
  setRelatedPostSearch: React.Dispatch<React.SetStateAction<Post | null>>
  forwardedFilter: ForwardedFilterValue
  setForwardedFilter: React.Dispatch<React.SetStateAction<ForwardedFilterValue>>
  mediaFilter: MediaFilterValue
  setMediaFilter: React.Dispatch<React.SetStateAction<MediaFilterValue>>
  /** The Post's own Language, any of these; empty for any (PFB-02). */
  languageFilter: string[]
  setLanguageFilter: React.Dispatch<React.SetStateAction<string[]>>
  maxPostsPerChannel: number
  setMaxPostsPerChannel: React.Dispatch<React.SetStateAction<number>>
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: React.Dispatch<
    React.SetStateAction<MaxPostsPerChannelMode>
  >
  postSortOrder: PostSortOrder
  setPostSortOrder: React.Dispatch<React.SetStateAction<PostSortOrder>>
  groupByChannel: boolean
  setGroupByChannel: React.Dispatch<React.SetStateAction<boolean>>
  /** What the views threshold and the views orders read (PFB-03). */
  viewMeasure: ViewMeasure
  setViewMeasure: React.Dispatch<React.SetStateAction<ViewMeasure>>
  viewsFilter: ViewsFilter | null
  setViewsFilter: React.Dispatch<React.SetStateAction<ViewsFilter | null>>
  postViewOptions: PostViewOptions
  /** Debounced, so a keystroke does not become a query key. */
  debouncedPostSearch: string
  debouncedSemanticSearchQuery: string
}

export function readStoredMaxPerChannel(): number {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.maxPerChannel)
  const parsed = saved ? Number.parseInt(saved, 10) : 0
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
}

export function readStoredMaxPerChannelMode(): MaxPostsPerChannelMode {
  const saved = scopedStorage.getItem(
    POST_FILTER_STORAGE_KEYS.maxPerChannelMode,
  )
  // `"latest"`, the previous bundle's spelling, is `"ordered"` like anything
  // else that is not `"random"`.
  return saved === "random" ? "random" : "ordered"
}

const SORT_ORDERS: readonly PostSortOrder[] = [
  "newest",
  "oldest",
  "most_views",
  "fewest_views",
]

export function readStoredSortOrder(): PostSortOrder {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder)
  // `"time"` and `"channel_time"` were both newest first, like anything else
  // this bundle does not know.
  return SORT_ORDERS.find((order) => order === saved) ?? "newest"
}

export function readStoredViewMeasure(): ViewMeasure {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.viewMeasure)
  return saved === "views" ? "views" : "estimated"
}

/** `{op, value}` as JSON; anything else is no threshold. */
export function readStoredViewsFilter(): ViewsFilter | null {
  try {
    const parsed: unknown = JSON.parse(
      scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.views) ?? "null",
    )
    if (typeof parsed !== "object" || parsed === null) return null
    const { op, value } = parsed as Record<string, unknown>
    if ((op !== "gte" && op !== "lte") || typeof value !== "number") return null
    if (!Number.isInteger(value) || value < 0) return null
    return { op, value }
  } catch {
    return null
  }
}

export function readStoredGroupByChannel(): boolean {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.groupByChannel)
  if (saved === "true" || saved === "false") return saved === "true"
  // No key yet: a previous bundle's `channel_time` was "newest, grouped".
  return (
    scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder) === "channel_time"
  )
}

export function readStoredMediaFilter(): MediaFilterValue {
  return parseMediaFilterValue(
    scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.media),
  )
}

/** A JSON array of Language codes; anything else, or a non-string entry, is dropped. */
export function readStoredLanguageFilter(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.languages) ?? "[]",
    )
    if (!Array.isArray(parsed)) return []
    return parsed.filter((code): code is string => typeof code === "string")
  } catch {
    return []
  }
}

export function usePostFilters(): PostFilters {
  const [postSearch, setPostSearch] = useState("")
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("")
  const [semanticSearchRespectsChannels, setSemanticSearchRespectsChannels] =
    useState(false)
  const [relatedPostSearch, setRelatedPostSearch] = useState<Post | null>(null)

  // Not persisted, unlike the four below — a forwarded filter surviving a
  // reload has surprised people, because nothing on screen says it is on until
  // you notice the post count is wrong. Preserved as-is.
  const [forwardedFilter, setForwardedFilter] =
    useState<ForwardedFilterValue>("all")

  const [mediaFilter, setMediaFilter] = useState<MediaFilterValue>(
    readStoredMediaFilter,
  )
  const [languageFilter, setLanguageFilter] = useState<string[]>(
    readStoredLanguageFilter,
  )
  const [maxPostsPerChannel, setMaxPostsPerChannel] = useState<number>(
    readStoredMaxPerChannel,
  )
  const [maxPostsPerChannelMode, setMaxPostsPerChannelMode] =
    useState<MaxPostsPerChannelMode>(readStoredMaxPerChannelMode)
  const [postSortOrder, setPostSortOrder] =
    useState<PostSortOrder>(readStoredSortOrder)
  const [groupByChannel, setGroupByChannel] = useState<boolean>(
    readStoredGroupByChannel,
  )
  const [viewMeasure, setViewMeasure] = useState<ViewMeasure>(
    readStoredViewMeasure,
  )
  const [viewsFilter, setViewsFilter] = useState<ViewsFilter | null>(
    readStoredViewsFilter,
  )

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.maxPerChannel,
      maxPostsPerChannel.toString(),
    )
  }, [maxPostsPerChannel])

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.maxPerChannelMode,
      maxPostsPerChannelMode,
    )
  }, [maxPostsPerChannelMode])

  useEffect(() => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.sortOrder, postSortOrder)
  }, [postSortOrder])

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.groupByChannel,
      String(groupByChannel),
    )
  }, [groupByChannel])

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.media,
      JSON.stringify(mediaFilter),
    )
  }, [mediaFilter])

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.languages,
      JSON.stringify(languageFilter),
    )
  }, [languageFilter])

  useEffect(() => {
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.viewMeasure, viewMeasure)
  }, [viewMeasure])

  useEffect(() => {
    scopedStorage.setItem(
      POST_FILTER_STORAGE_KEYS.views,
      JSON.stringify(viewsFilter),
    )
  }, [viewsFilter])

  const debouncedPostSearch = useDebouncedValue(
    postSearch,
    POST_SEARCH_DEBOUNCE_MS,
  )
  const debouncedSemanticSearchQuery = useDebouncedValue(
    semanticSearchQuery,
    POST_SEARCH_DEBOUNCE_MS,
  )

  const postViewOptions: PostViewOptions = {
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    postSortOrder,
    groupByChannel,
    viewMeasure,
    viewsFilter,
  }

  return {
    postSearch,
    setPostSearch,
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
    relatedPostSearch,
    setRelatedPostSearch,
    forwardedFilter,
    setForwardedFilter,
    mediaFilter,
    setMediaFilter,
    languageFilter,
    setLanguageFilter,
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    maxPostsPerChannelMode,
    setMaxPostsPerChannelMode,
    postSortOrder,
    setPostSortOrder,
    groupByChannel,
    setGroupByChannel,
    viewMeasure,
    setViewMeasure,
    viewsFilter,
    setViewsFilter,
    postViewOptions,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
  }
}
