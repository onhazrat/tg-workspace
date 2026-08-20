import { useMemo } from "react"

import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import type { DiscoverCandidatesParams } from "@/hooks/useDiscover"
import { useCreateDiscoverReportMutation } from "@/hooks/useDiscover"
import { useDiscoverReportParam } from "@/hooks/useDiscoverReportParam"
import { RANDOM_CAP_SEED } from "@/lib/posts/discover-candidates"

/**
 * Generating a Discover report, extracted so the Action tab can do it too.
 *
 * `DiscoverReportBar` mixed two jobs: *which report am I looking at* and *make
 * another*. The first stays on the Discover tab, because it is about the result
 * on screen; the second belongs with the other three create paths. This hook is
 * the seam.
 */
export function useDiscoverGenerate() {
  const { selectedChannels } = useData()
  const {
    getScopedPosts,
    forwardedFilter,
    postSearch,
    semanticSearchQuery,
    maxPostsPerChannel,
    maxPostsPerChannelMode,
    mediaFilter,
  } = useScraper()
  const { startDate, endDate } = useUI()
  const { discoverSignals } = useSettings()
  const { openReport } = useDiscoverReportParam()
  const createReport = useCreateDiscoverReportMutation()

  const debouncedPostSearch = useDebouncedValue(postSearch, 300)
  const selectedChannelNames = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )

  /** Live scope — the *input* to the next report, never a description of one. */
  const liveParams: DiscoverCandidatesParams = useMemo(
    () => ({
      channelNames: selectedChannelNames,
      startDate,
      endDate,
      signals: discoverSignals,
      keyword: debouncedPostSearch,
      forwarded: forwardedFilter,
      media: mediaFilter,
      maxPerChannel: maxPostsPerChannel,
      maxPerChannelMode: maxPostsPerChannelMode,
      seed: RANDOM_CAP_SEED,
    }),
    [
      selectedChannelNames,
      startDate,
      endDate,
      discoverSignals,
      debouncedPostSearch,
      forwardedFilter,
      mediaFilter,
      maxPostsPerChannel,
      maxPostsPerChannelMode,
    ],
  )

  /**
   * Generate and save a report.
   *
   * A semantic query is the one scope whose *post selection* the server cannot
   * derive from the scope alone — the vector search owns that ranking. So the
   * client resolves which posts matched and passes their ids; the aggregation
   * still happens server-side, in the single implementation.
   */
  const generate = async () => {
    const params = { ...liveParams }
    if (semanticSearchQuery.trim()) {
      const posts = await getScopedPosts()
      params.postIds = posts.map((post) => ({
        channelName: post.channelName,
        postId: post.id,
      }))
    }
    const report = await createReport.mutateAsync(params)
    // Pin the new report so it stays on screen even as newer ones appear.
    openReport(report.id)
    return report
  }

  return {
    generate,
    liveParams,
    isGenerating: createReport.isPending,
    channelCount: selectedChannelNames.length,
  }
}
