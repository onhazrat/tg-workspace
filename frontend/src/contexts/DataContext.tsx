import { useQuery, useQueryClient } from "@tanstack/react-query"
import type React from "react"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { queryKeys } from "../hooks/queryKeys"
import {
  setChannelStatsInCache,
  setChannelsInCache,
  useChannelsQuery,
  useInvalidateChannels,
} from "../hooks/useChannels"
import {
  useEmbeddingLogsQuery,
  useLLMLogsQuery,
  useNetworkLogsQuery,
  usePublishLogsQuery,
  useSyncLogsQuery,
} from "../hooks/useLogs"
import {
  useInvalidateSummaries,
  useSummariesQuery,
} from "../hooks/useSummaries"
import { applySetStateAction } from "../lib/applySetStateAction"
import {
  cleanupLegacyBots,
  getDBStats,
  listBotCredentials,
  listChatDestinations,
  listEmbeddingLogs,
  listLLMLogs,
  listNetworkLogs,
  listPublishLogs,
  listSyncLogs,
} from "../lib/repository"
import type {
  BotCredential,
  Channel,
  ChannelStats,
  ChatDestination,
  DBStats,
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SummaryListItem,
  SyncLog,
} from "../types"

interface BotsQueryResult {
  credentials: BotCredential[]
  destinations: ChatDestination[]
}

interface DataContextType {
  channels: Channel[]
  isInitialChannelsLoading: boolean
  setChannels: React.Dispatch<React.SetStateAction<Channel[]>>
  loadChannels: () => Promise<void>

  botCredentials: BotCredential[]
  setBotCredentials: React.Dispatch<React.SetStateAction<BotCredential[]>>

  chatDestinations: ChatDestination[]
  setChatDestinations: React.Dispatch<React.SetStateAction<ChatDestination[]>>
  loadBots: () => Promise<void>

  channelStats: Record<string, ChannelStats>
  setChannelStats: React.Dispatch<
    React.SetStateAction<Record<string, ChannelStats>>
  >

  summariesHistory: SummaryListItem[]
  loadHistory: () => Promise<void>

  dbStats: DBStats | null
  loadDBStats: () => Promise<void>

  publishLogs: PublishLog[]
  loadLogs: () => Promise<void>

  syncLogs: SyncLog[]
  loadSyncLogs: () => Promise<void>

  llmLogs: LLMLog[]
  loadLLMLogs: () => Promise<void>

  embeddingLogs: EmbeddingLog[]
  loadEmbeddingLogs: () => Promise<void>

  networkLogs: NetworkLog[]
  loadNetworkLogs: () => Promise<void>

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

  const botsQuery = useQuery({
    queryKey: queryKeys.bots,
    queryFn: async (): Promise<BotsQueryResult> => {
      await cleanupLegacyBots()
      const [credentials, destinations] = await Promise.all([
        listBotCredentials(),
        listChatDestinations(),
      ])
      return { credentials, destinations }
    },
    staleTime: 30_000,
  })

  const dbStatsQuery = useQuery({
    queryKey: queryKeys.dbStats,
    queryFn: () => getDBStats(),
    enabled: false,
  })

  const publishLogsQuery = usePublishLogsQuery()
  const syncLogsQuery = useSyncLogsQuery()
  const llmLogsQuery = useLLMLogsQuery()
  const embeddingLogsQuery = useEmbeddingLogsQuery()
  const networkLogsQuery = useNetworkLogsQuery()

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

  const setBotCredentials = useCallback<
    React.Dispatch<React.SetStateAction<BotCredential[]>>
  >(
    (action) => {
      queryClient.setQueryData<BotsQueryResult>(queryKeys.bots, (old) => ({
        credentials: applySetStateAction(action, old?.credentials ?? []),
        destinations: old?.destinations ?? [],
      }))
    },
    [queryClient],
  )

  const setChatDestinations = useCallback<
    React.Dispatch<React.SetStateAction<ChatDestination[]>>
  >(
    (action) => {
      queryClient.setQueryData<BotsQueryResult>(queryKeys.bots, (old) => ({
        credentials: old?.credentials ?? [],
        destinations: applySetStateAction(action, old?.destinations ?? []),
      }))
    },
    [queryClient],
  )

  const loadChannels = useCallback(async () => {
    await invalidateChannels()
  }, [invalidateChannels])

  const loadBots = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.bots })
  }, [queryClient])

  const loadHistory = useCallback(async () => {
    await invalidateSummaries()
  }, [invalidateSummaries])

  const loadLogs = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.logs.publish,
      queryFn: async () => {
        const logs = await listPublishLogs()
        return logs.sort((a, b) => b.timestamp - a.timestamp)
      },
    })
  }, [queryClient])

  const loadSyncLogs = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.logs.sync,
      queryFn: async () => {
        const logs = await listSyncLogs()
        return logs.sort((a, b) => b.timestamp - a.timestamp)
      },
    })
  }, [queryClient])

  const loadLLMLogs = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.logs.llm,
      queryFn: async () => {
        const logs = await listLLMLogs()
        return logs.sort((a, b) => b.timestamp - a.timestamp)
      },
    })
  }, [queryClient])

  const loadEmbeddingLogs = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.logs.embedding,
      queryFn: async () => {
        const logs = await listEmbeddingLogs()
        return logs.sort((a, b) => b.timestamp - a.timestamp)
      },
    })
  }, [queryClient])

  const loadNetworkLogs = useCallback(async () => {
    await queryClient.fetchQuery({
      queryKey: queryKeys.logs.network,
      queryFn: async () => {
        const logs = await listNetworkLogs()
        return logs.sort((a, b) => b.timestamp - a.timestamp)
      },
    })
  }, [queryClient])

  const loadDBStats = useCallback(async () => {
    const stats = await getDBStats()
    queryClient.setQueryData(queryKeys.dbStats, stats)
  }, [queryClient])

  const channels = channelsQuery.data?.channels ?? emptyArray
  const channelStats = channelsQuery.data?.channelStats ?? emptyChannelStats
  const botCredentials = botsQuery.data?.credentials ?? emptyArray
  const chatDestinations = botsQuery.data?.destinations ?? emptyArray
  const summariesHistory = summariesQuery.data ?? emptyArray
  const dbStats = dbStatsQuery.data ?? null
  const publishLogs = publishLogsQuery.data ?? emptyArray
  const syncLogs = syncLogsQuery.data ?? emptyArray
  const llmLogs = llmLogsQuery.data ?? emptyArray
  const embeddingLogs = embeddingLogsQuery.data ?? emptyArray
  const networkLogs = networkLogsQuery.data ?? emptyArray

  const isInitialChannelsLoading =
    channelsQuery.isPending && channels.length === 0

  return (
    <DataContext.Provider
      value={{
        channels,
        isInitialChannelsLoading,
        setChannels,
        loadChannels,
        botCredentials,
        setBotCredentials,
        chatDestinations,
        setChatDestinations,
        loadBots,
        channelStats,
        setChannelStats,
        summariesHistory,
        loadHistory,
        dbStats,
        loadDBStats,
        publishLogs,
        loadLogs,
        syncLogs,
        loadSyncLogs,
        llmLogs,
        loadLLMLogs,
        embeddingLogs,
        loadEmbeddingLogs,
        networkLogs,
        loadNetworkLogs,
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
