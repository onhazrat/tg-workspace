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
import { parseMediaFilterValue } from "@/lib/posts/post-media"

export function useApplyArtifactScope(): (scope: FrozenScope) => void {
  const { setSelectedChannels } = useData()
  const { setFixedRange } = useScope()
  const {
    setPostSearch,
    setSemanticSearchQuery,
    setRelatedPostSearch,
    setForwardedFilter,
    setMediaFilter,
    setMaxPostsPerChannel,
    setMaxPostsPerChannelMode,
    setPostSortOrder,
  } = useScraper()

  return useCallback(
    (scope: FrozenScope) => {
      setSelectedChannels(new Set(scope.channels ?? []))
      setFixedRange(scope.start, scope.end)
      setPostSearch(scope.keyword ?? "")
      setForwardedFilter(scope.forwarded ?? "all")
      setMediaFilter(parseMediaFilterValue(scope.media ?? null))
      setMaxPostsPerChannel(scope.maxPerChannel ?? 0)
      setMaxPostsPerChannelMode(scope.maxPerChannelMode ?? "latest")
      setPostSortOrder(scope.sort ?? "time")
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
      setMaxPostsPerChannel,
      setMaxPostsPerChannelMode,
      setPostSortOrder,
      setSemanticSearchQuery,
      setRelatedPostSearch,
    ],
  )
}
