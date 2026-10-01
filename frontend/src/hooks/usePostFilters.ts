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
 * PFB-03 added the views measure, which the views orders read.
 *
 * The Type, media, Language and views filters left in PTR-03: they are the
 * Post filter now, a tree in the URL (`usePostFilterParam`), so their keys
 * and their readers are gone. A value an earlier bundle stored is left where
 * it lies and read by nothing.
 */

import { useEffect, useState } from "react"

import { POST_ORDER_OPTIONS } from "@/lib/posts/post-filter-bar"
import type {
  MaxPostsPerChannelMode,
  PostSortOrder,
  PostViewOptions,
  ViewMeasure,
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
  viewMeasure: "postFilter_viewMeasure",
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
  /** What the views orders read (PFB-03). */
  viewMeasure: ViewMeasure
  setViewMeasure: React.Dispatch<React.SetStateAction<ViewMeasure>>
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

const SORT_ORDERS = POST_ORDER_OPTIONS.map((option) => option.value)

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

export function readStoredGroupByChannel(): boolean {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.groupByChannel)
  if (saved === "true" || saved === "false") return saved === "true"
  // No key yet: a previous bundle's `channel_time` was "newest, grouped".
  return (
    scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder) === "channel_time"
  )
}

export function usePostFilters(): PostFilters {
  const [postSearch, setPostSearch] = useState("")
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("")
  const [semanticSearchRespectsChannels, setSemanticSearchRespectsChannels] =
    useState(false)
  const [relatedPostSearch, setRelatedPostSearch] = useState<Post | null>(null)

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
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.viewMeasure, viewMeasure)
  }, [viewMeasure])

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
    postViewOptions,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
  }
}
