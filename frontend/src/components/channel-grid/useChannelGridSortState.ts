import { useEffect, useState } from "react"
import type { ChannelGridSortOption } from "@/lib/channels/sort-channels-for-grid"
import { scopedStorage } from "@/lib/storage/scoped"

/** Sort option, direction, trim count, and rank visibility for the Channels tab, persisted to scopedStorage. */
export function useChannelGridSortState() {
  const [sortBy, setSortBy] = useState<ChannelGridSortOption>(() => {
    const saved = scopedStorage.getItem("channelGrid_sortBy")
    return (saved as ChannelGridSortOption) || "last_updated"
  })
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => {
    const saved = scopedStorage.getItem("channelGrid_sortDirection")
    return (saved as "asc" | "desc") || "desc"
  })
  const [trimCount, setTrimCount] = useState(() => {
    return scopedStorage.getItem("channelGrid_trimCount") ?? ""
  })
  const [showSortRank, setShowSortRank] = useState(() => {
    return scopedStorage.getItem("channelGrid_showSortRank") === "true"
  })

  useEffect(() => {
    scopedStorage.setItem("channelGrid_sortBy", sortBy)
  }, [sortBy])

  useEffect(() => {
    scopedStorage.setItem("channelGrid_sortDirection", sortDirection)
  }, [sortDirection])

  useEffect(() => {
    if (trimCount.trim()) {
      scopedStorage.setItem("channelGrid_trimCount", trimCount)
    }
  }, [trimCount])

  useEffect(() => {
    scopedStorage.setItem("channelGrid_showSortRank", String(showSortRank))
  }, [showSortRank])

  return {
    sortBy,
    setSortBy,
    sortDirection,
    setSortDirection,
    trimCount,
    setTrimCount,
    showSortRank,
    setShowSortRank,
  }
}
