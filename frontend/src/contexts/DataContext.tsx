import { useQueryClient } from "@tanstack/react-query"
import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import {
  setChannelStatsInCache,
  setChannelsInCache,
  useChannelStatsQuery,
  useChannelsQuery,
  useInvalidateChannels,
} from "../hooks/useChannels"
import type { Channel, ChannelStats } from "../types"

interface DataContextType {
  channels: Channel[]
  isInitialChannelsLoading: boolean
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>
  loadChannels: () => Promise<void>

  channelStats: Record<string, ChannelStats>
  setChannelStats: React.Dispatch<
    React.SetStateAction<Record<string, ChannelStats>>
  >

  selectedChannels: Set<string>
  setSelectedChannels: React.Dispatch<React.SetStateAction<Set<string>>>

  prevChannelNames: Set<string>
  setPrevChannelNames: React.Dispatch<React.SetStateAction<Set<string>>>
}

const DataContext = createContext<DataContextType | undefined>(undefined)

const emptyArray: never[] = []
const emptyChannelStats: Record<string, ChannelStats> = {}

export const DataProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient()
  const invalidateChannels = useInvalidateChannels()

  const channelsQuery = useChannelsQuery()
  const channelStatsQuery = useChannelStatsQuery()

  const [selectedChannels, setSelectedChannels] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("selectedChannels")
      try {
        return saved ? new Set(JSON.parse(saved)) : new Set()
      } catch {
        return new Set()
      }
    }
    return new Set()
  })

  const [prevChannelNames, setPrevChannelNames] = useState<Set<string>>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("prevChannelNames")
      try {
        return saved ? new Set(JSON.parse(saved)) : new Set()
      } catch {
        return new Set()
      }
    }
    return new Set()
  })

  useEffect(() => {
    localStorage.setItem(
      "selectedChannels",
      JSON.stringify(Array.from(selectedChannels)),
    )
  }, [selectedChannels])

  useEffect(() => {
    localStorage.setItem(
      "prevChannelNames",
      JSON.stringify(Array.from(prevChannelNames)),
    )
  }, [prevChannelNames])

  useEffect(() => {
    if (!channelsQuery.data) return
    const names = channelsQuery.data.map((c) => c.name)
    setPrevChannelNames((prevNames) => {
      setSelectedChannels((currentSelected) => {
        const nextSelected = new Set(currentSelected)
        names.forEach((name) => {
          if (!prevNames.has(name)) nextSelected.add(name)
        })
        const namesSet = new Set(names)
        Array.from(nextSelected).forEach((selectedName) => {
          if (!namesSet.has(selectedName)) nextSelected.delete(selectedName)
        })
        return nextSelected
      })
      return new Set(names)
    })
  }, [channelsQuery.data])

  const setChannels = useCallback<
    React.Dispatch<React.SetStateAction<Channel[]>>
  >((action) => setChannelsInCache(queryClient, action), [queryClient])

  const setChannelStats = useCallback<
    React.Dispatch<React.SetStateAction<Record<string, ChannelStats>>>
  >((action) => setChannelStatsInCache(queryClient, action), [queryClient])

  const loadChannels = useCallback(async () => {
    await invalidateChannels()
  }, [invalidateChannels])

  const channels = channelsQuery.data ?? emptyArray
  // Stats land in their own request; the grid renders before they arrive and the
  // two stats-dependent sorts re-sort when they do.
  const channelStats = channelStatsQuery.data ?? emptyChannelStats

  const isInitialChannelsLoading =
    channelsQuery.isPending && channels.length === 0

  /**
   * First-load flags for the log panels.
   *
   * Each tab rendered `logs.length === 0 ? <LogEmptyState/> : …`, which cannot
   * tell "still fetching" from "genuinely nothing" — so while the query was in
   * flight every panel asserted "No LLM logs found". That is not a missing
   * spinner, it is a false statement, and it is what made the Diagnostics
   * section look broken on open.
   *
   * `isPending && length === 0` matches `isInitialChannelsLoading` above: a
   * background refetch with data already on screen is not a loading state, so
   * the list does not flicker back to a skeleton every time it revalidates.
   */

  return (
    <DataContext.Provider
      value={{
        channels,
        isInitialChannelsLoading,
        setChannels,
        loadChannels,
        channelStats,
        setChannelStats,
        selectedChannels,
        setSelectedChannels,
        prevChannelNames,
        setPrevChannelNames,
      }}
    >
      {children}
    </DataContext.Provider>
  )
}

export const useData = () => {
  const context = useContext(DataContext)
  if (context === undefined) {
    throw new Error("useData must be used within a DataProvider")
  }
  return context
}
