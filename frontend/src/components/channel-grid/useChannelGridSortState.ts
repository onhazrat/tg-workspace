import { useEffect, useState } from "react"
import type { ChannelGridSortOption } from "@/lib/channels/sort-channels-for-grid"

/** Sort option, direction, trim count, and rank visibility for the Channels tab, persisted to localStorage. */
export function useChannelGridSortState() {
  const [sortBy, setSortBy] = useState<ChannelGridSortOption>(() => {
    const saved = localStorage.getItem("channelGrid_sortBy")
    return (saved as ChannelGridSortOption) || "last_updated"
  })
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">(() => {
    const saved = localStorage.getItem("channelGrid_sortDirection")
    return (saved as "asc" | "desc") || "desc"
  })
  const [trimCount, setTrimCount] = useState(() => {
    return localStorage.getItem("channelGrid_trimCount") ?? ""
  })
  const [showSortRank, setShowSortRank] = useState(() => {
    return localStorage.getItem("channelGrid_showSortRank") === "true"
  })

  useEffect(() => {
    localStorage.setItem("channelGrid_sortBy", sortBy)
  }, [sortBy])

  useEffect(() => {
    localStorage.setItem("channelGrid_sortDirection", sortDirection)
  }, [sortDirection])

  useEffect(() => {
    if (trimCount.trim()) {
      localStorage.setItem("channelGrid_trimCount", trimCount)
    }
  }, [trimCount])

  useEffect(() => {
    localStorage.setItem("channelGrid_showSortRank", String(showSortRank))
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
