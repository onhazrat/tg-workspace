import { useMemo } from "react"

import { useData } from "@/contexts/DataContext"
import { useScope } from "@/contexts/ScopeContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useSettings } from "@/contexts/SettingsContext"
import { useUI } from "@/contexts/UIContext"
import { useCreateDiscoverReportMutation } from "@/hooks/useDiscover"

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
  const { postSelection, postSortOrder, groupByChannel, viewMeasure } =
    useScraper()
  const { startDate, endDate } = useScope()
  const { discoverSignals } = useSettings()
  const { workspaceTabs } = useUI()
  const createReport = useCreateDiscoverReportMutation()

  const selectedChannelNames = useMemo(
    () => [...selectedChannels].sort(),
    [selectedChannels],
  )

  /**
   * Generate and save a report over the Post selection, which the server
   * resolves like every other Action's (PTR-05). A meaning search reaches it
   * as the Picks "Select all" recorded, never as a ranking sent here.
   */
  const generate = async () => {
    const report = await createReport.mutateAsync({
      channelNames: selectedChannelNames,
      startDate,
      endDate,
      signals: discoverSignals,
      viewMeasure,
      sort: postSortOrder,
      groupByChannel,
      selection: postSelection,
    })
    // Its own tab, shown when this was started from Action (TABS-01).
    workspaceTabs.createTab("discover", report.id)
    return report
  }

  return {
    generate,
    isGenerating: createReport.isPending,
    channelCount: selectedChannelNames.length,
  }
}
