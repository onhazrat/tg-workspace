/**
 * The Posts tab's filter and search state (G1).
 *
 * Ten `useState`s and the four effects that persist them, lifted out of
 * `ScraperContext`. This is genuinely UI state — it describes what the operator
 * has asked to see, and nothing here talks to the network.
 *
 * **These four keys are deliberately *not* in `lib/settings/schema.ts`.** That
 * schema owns durable *preferences*; these are a transient view state that
 * happens to survive a reload. Folding them in would put every filter tweak
 * through the settings write path and expose them in the settings UI, which is
 * not what they are. The distinction is worth keeping — but the hand-rolled
 * browser-storage round-trip below is the price, and it is why the parse
 * fallbacks (`"random" ? … : "latest"`) live here rather than in a zod schema.
 */

import { useEffect, useState } from "react"

import { parseMediaFilterValue } from "@/lib/posts/post-media"
import type {
  ForwardedFilterValue,
  MaxPostsPerChannelMode,
  MediaFilterValue,
  PostSortOrder,
  PostViewOptions,
} from "@/lib/posts/post-view"
import { scopedStorage } from "@/lib/storage/scoped"
import type { Post } from "@/types"
import { useDebouncedValue } from "./useDebouncedValue"

/** Storage keys this hook owns, before namespacing. Named once, for tests. */
export const POST_FILTER_STORAGE_KEYS = {
  maxPerChannel: "postFilter_maxPerChannel",
  maxPerChannelMode: "postFilter_maxPerChannelMode",
  sortOrder: "postFilter_sortOrder",
  media: "postFilter_media",
} as const

/** How long a keystroke waits before it reaches a query key. */
export const POST_SEARCH_DEBOUNCE_MS = 300

export interface PostFilters {
  postSearch: string
  setPostSearch: React.Dispatch<React.SetStateAction<string>>
  semanticSearchQuery: string
  setSemanticSearchQuery: React.Dispatch<React.SetStateAction<string>>
  semanticSearchRespectsTimeRange: boolean
  setSemanticSearchRespectsTimeRange: React.Dispatch<
    React.SetStateAction<boolean>
  >
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
  maxPostsPerChannel: number
  setMaxPostsPerChannel: React.Dispatch<React.SetStateAction<number>>
  maxPostsPerChannelMode: MaxPostsPerChannelMode
  setMaxPostsPerChannelMode: React.Dispatch<
    React.SetStateAction<MaxPostsPerChannelMode>
  >
  postSortOrder: PostSortOrder
  setPostSortOrder: React.Dispatch<React.SetStateAction<PostSortOrder>>
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
  return saved === "random" ? "random" : "latest"
}

export function readStoredSortOrder(): PostSortOrder {
  const saved = scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.sortOrder)
  return saved === "channel_time" ? "channel_time" : "time"
}

export function readStoredMediaFilter(): MediaFilterValue {
  return parseMediaFilterValue(
    scopedStorage.getItem(POST_FILTER_STORAGE_KEYS.media),
  )
}

export function usePostFilters(): PostFilters {
  const [postSearch, setPostSearch] = useState("")
  const [semanticSearchQuery, setSemanticSearchQuery] = useState("")
  const [semanticSearchRespectsTimeRange, setSemanticSearchRespectsTimeRange] =
    useState(false)
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
  const [maxPostsPerChannel, setMaxPostsPerChannel] = useState<number>(
    readStoredMaxPerChannel,
  )
  const [maxPostsPerChannelMode, setMaxPostsPerChannelMode] =
    useState<MaxPostsPerChannelMode>(readStoredMaxPerChannelMode)
  const [postSortOrder, setPostSortOrder] =
    useState<PostSortOrder>(readStoredSortOrder)

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
    scopedStorage.setItem(POST_FILTER_STORAGE_KEYS.media, mediaFilter)
  }, [mediaFilter])

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
  }

  return {
    postSearch,
    setPostSearch,
    semanticSearchQuery,
    setSemanticSearchQuery,
    semanticSearchRespectsTimeRange,
    setSemanticSearchRespectsTimeRange,
    semanticSearchRespectsChannels,
    setSemanticSearchRespectsChannels,
    relatedPostSearch,
    setRelatedPostSearch,
    forwardedFilter,
    setForwardedFilter,
    mediaFilter,
    setMediaFilter,
    maxPostsPerChannel,
    setMaxPostsPerChannel,
    maxPostsPerChannelMode,
    setMaxPostsPerChannelMode,
    postSortOrder,
    setPostSortOrder,
    postViewOptions,
    debouncedPostSearch,
    debouncedSemanticSearchQuery,
  }
}
