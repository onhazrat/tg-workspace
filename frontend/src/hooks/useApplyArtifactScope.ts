/**
 * "Use this Scope": deliberately putting an Artifact's frozen Scope back into
 * the workspace (AW-08).
 *
 * Opening an Artifact used to do this on its own, which meant inspecting an old
 * report silently replaced the Channels and the window somebody was working
 * with. The mutation was never wrong — an Artifact only means anything beside
 * the Posts it came from — but doing it unasked was, so it is an action now.
 *
 * The window comes back **Fixed**, never Live. The Artifact records two exact
 * instants and nothing about the mode they were submitted under; reading Live
 * back out of them would be inventing an intent. End gap needs no restoring at
 * all — it is derived against the synchronized current minute, so it is true
 * the moment the Fixed pair lands.
 */

import { useCallback } from "react"

import type { FrozenScope } from "@/client"
import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import type {
  MaxPostsPerChannelMode,
  MediaFilterValue,
  PostSortOrder,
  ViewMeasure,
  ViewsFilter,
} from "@/lib/posts/post-view"

/**
 * The workspace filters a frozen Scope puts back, with each absent field reset.
 *
 * The server reads a Scope stored before PFB-01 into the new shape on the way
 * out, so an old Artifact restores as `[kind]`, `ordered` and `newest` grouped
 * without the browser knowing the old spelling existed.
 */
export function workspaceFromScope(scope: FrozenScope): {
  channels: Set<string>
  keyword: string
  forwarded: NonNullable<FrozenScope["forwarded"]>
  media: MediaFilterValue
  languages: string[]
  viewMeasure: ViewMeasure
  views: ViewsFilter | null
  maxPerChannel: number
  maxPerChannelMode: MaxPostsPerChannelMode
  sort: PostSortOrder
  groupByChannel: boolean
} {
  return {
    channels: new Set(scope.channels ?? []),
    keyword: scope.keyword ?? "",
    forwarded: scope.forwarded ?? "all",
    media: [...new Set(scope.media ?? [])],
    languages: [...new Set(scope.languages ?? [])],
    viewMeasure: scope.viewMeasure ?? "estimated",
    views: scope.views ?? null,
    maxPerChannel: scope.maxPerChannel ?? 0,
    maxPerChannelMode: scope.maxPerChannelMode ?? "ordered",
    sort: scope.sort ?? "newest",
    groupByChannel: scope.groupByChannel ?? false,
  }
}

export function useApplyArtifactScope(): (scope: FrozenScope) => void {
  const { setSelectedChannels } = useData()
  const { setFixedRange } = useScope()
  const {
    setPostSearch,
    setSemanticSearchQuery,
    setRelatedPostSearch,
    setForwardedFilter,
    setMediaFilter,
    setLanguageFilter,
    setViewMeasure,
    setViewsFilter,
    setMaxPostsPerChannel,
    setMaxPostsPerChannelMode,
    setPostSortOrder,
    setGroupByChannel,
  } = useScraper()

  return useCallback(
    (scope: FrozenScope) => {
      const next = workspaceFromScope(scope)
      setSelectedChannels(next.channels)
      setFixedRange(scope.start, scope.end)
      setPostSearch(next.keyword)
      setForwardedFilter(next.forwarded)
      setMediaFilter(next.media)
      setLanguageFilter(next.languages)
      setViewMeasure(next.viewMeasure)
      setViewsFilter(next.views)
      setMaxPostsPerChannel(next.maxPerChannel)
      setMaxPostsPerChannelMode(next.maxPerChannelMode)
      setPostSortOrder(next.sort)
      setGroupByChannel(next.groupByChannel)
      // The ranked Post selection a Semantic or related-Post Artifact froze is
      // not a filter, so there is nothing in the workspace to restore it into.
      // Leaving a live semantic query running instead would mean the restored
      // Scope selected Posts the Artifact's never did, so both are cleared.
      setSemanticSearchQuery("")
      setRelatedPostSearch(null)
    },
    [
      setSelectedChannels,
      setFixedRange,
      setPostSearch,
      setForwardedFilter,
      setMediaFilter,
      setLanguageFilter,
      setViewMeasure,
      setViewsFilter,
      setMaxPostsPerChannel,
      setMaxPostsPerChannelMode,
      setPostSortOrder,
      setGroupByChannel,
      setSemanticSearchQuery,
      setRelatedPostSearch,
    ],
  )
}
