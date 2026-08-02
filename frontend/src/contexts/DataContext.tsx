import { useQuery, useQueryClient } from "@tanstack/react-query"
import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import { listBotCredentials, listChatDestinations } from "@/lib/bots/store"
import { queryKeys } from "../hooks/queryKeys"
import {
  setChannelStatsInCache,
  setChannelsInCache,
  useChannelsQuery,
  useInvalidateChannels,
} from "../hooks/useChannels"
import {
  useInvalidateSummaries,
  useSummariesQuery,
} from "../hooks/useSummaries"
import { getDBStats } from "../lib/repository"
import type { Channel, ChannelStats, DBStats, SummaryListItem } from "../types"

interface DataContextType {
  channels: Channel[]
  isInitialChannelsLoading: boolean
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>
  loadChannels: () => Promise<void>

  channelStats: Record<string, ChannelStats>
  setChannelStats: React.Dispatch<
    React.SetStateAction<Record<string, ChannelStats>>
  >

  summariesHistory: SummaryListItem[]
  loadHistory: () => Promise<void>

  dbStats: DBStats | null
  loadDBStats: () => Promise<void>

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
  const invalidateSummaries = useInvalidateSummaries()

  const channelsQuery = useChannelsQuery()
  const summariesQuery = useSummariesQuery()

  const dbStatsQuery = useQuery({
    queryKey: queryKeys.dbStats,
    queryFn: () => getDBStats(),
    enabled: false,
  })

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
    const names = channelsQuery.data.channels.map((c) => c.name)
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

  const loadHistory = useCallback(async () => {
    await invalidateSummaries()
  }, [invalidateSummaries])

  const loadDBStats = useCallback(async () => {
    const stats = await getDBStats()
    queryClient.setQueryData(queryKeys.dbStats, stats)
  }, [queryClient])

  const channels = channelsQuery.data?.channels ?? emptyArray
  const channelStats = channelsQuery.data?.channelStats ?? emptyChannelStats
  const summariesHistory = summariesQuery.data ?? emptyArray
  const dbStats = dbStatsQuery.data ?? null

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
        summariesHistory,
        loadHistory,
        dbStats,
        loadDBStats,
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
