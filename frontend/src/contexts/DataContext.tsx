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
import { useChannelsQuery, useInvalidateChannels } from "../hooks/useChannels"
import { useLogsQuery } from "../hooks/useLogs"
import {
  useInvalidateSummaries,
  useSummariesQuery,
} from "../hooks/useSummaries"
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
  Summary,
  SyncLog,
} from "../types"

interface DataContextType {
  channels: Channel[]
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

  summariesHistory: Summary[]
  setSummariesHistory: React.Dispatch<React.SetStateAction<Summary[]>>
  loadHistory: () => Promise<void>

  dbStats: DBStats | null
  setDbStats: React.Dispatch<React.SetStateAction<DBStats | null>>
  loadDBStats: () => Promise<void>

  publishLogs: PublishLog[]
  setPublishLogs: React.Dispatch<React.SetStateAction<PublishLog[]>>
  loadLogs: () => Promise<void>

  syncLogs: SyncLog[]
  setSyncLogs: React.Dispatch<React.SetStateAction<SyncLog[]>>
  loadSyncLogs: () => Promise<void>

  llmLogs: LLMLog[]
  setLlmLogs: React.Dispatch<React.SetStateAction<LLMLog[]>>
  loadLLMLogs: () => Promise<void>

  embeddingLogs: EmbeddingLog[]
  setEmbeddingLogs: React.Dispatch<React.SetStateAction<EmbeddingLog[]>>
  loadEmbeddingLogs: () => Promise<void>

  networkLogs: NetworkLog[]
  setNetworkLogs: React.Dispatch<React.SetStateAction<NetworkLog[]>>
  loadNetworkLogs: () => Promise<void>

  selectedChannels: Set<string>
  setSelectedChannels: React.Dispatch<React.SetStateAction<Set<string>>>

  prevChannelNames: Set<string>
  setPrevChannelNames: React.Dispatch<React.SetStateAction<Set<string>>>
}

const DataContext = createContext<DataContextType | undefined>(undefined)

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
    queryFn: async () => {
      await cleanupLegacyBots()
      const [credentials, destinations] = await Promise.all([
        listBotCredentials(),
        listChatDestinations(),
      ])
      return { credentials, destinations }
    },
    staleTime: 30_000,
  })

  const [channels, setChannels] = useState<Channel[]>([])
  const [channelStats, setChannelStats] = useState<
    Record<string, ChannelStats>
  >({})
  const [botCredentials, setBotCredentials] = useState<BotCredential[]>([])
  const [chatDestinations, setChatDestinations] = useState<ChatDestination[]>(
    [],
  )
  const [summariesHistory, setSummariesHistory] = useState<Summary[]>([])
  const [dbStats, setDbStats] = useState<DBStats | null>(null)

  const publishLogsQuery = useLogsQuery("publish", false)
  const syncLogsQuery = useLogsQuery("sync", false)
  const llmLogsQuery = useLogsQuery("llm", false)
  const embeddingLogsQuery = useLogsQuery("embedding", false)
  const networkLogsQuery = useLogsQuery("network", false)

  const [publishLogs, setPublishLogs] = useState<PublishLog[]>([])
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([])
  const [llmLogs, setLlmLogs] = useState<LLMLog[]>([])
  const [embeddingLogs, setEmbeddingLogs] = useState<EmbeddingLog[]>([])
  const [networkLogs, setNetworkLogs] = useState<NetworkLog[]>([])

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
    const normalizedChannels = channelsQuery.data.channels
    setChannels(normalizedChannels)
    setChannelStats(channelsQuery.data.channelStats)

    const names = normalizedChannels.map((c) => c.name)
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

  useEffect(() => {
    if (botsQuery.data) {
      setBotCredentials(botsQuery.data.credentials)
      setChatDestinations(botsQuery.data.destinations)
    }
  }, [botsQuery.data])

  useEffect(() => {
    if (summariesQuery.data) setSummariesHistory(summariesQuery.data)
  }, [summariesQuery.data])

  useEffect(() => {
    if (publishLogsQuery.data)
      setPublishLogs(publishLogsQuery.data as PublishLog[])
  }, [publishLogsQuery.data])

  useEffect(() => {
    if (syncLogsQuery.data) setSyncLogs(syncLogsQuery.data as SyncLog[])
  }, [syncLogsQuery.data])

  useEffect(() => {
    if (llmLogsQuery.data) setLlmLogs(llmLogsQuery.data as LLMLog[])
  }, [llmLogsQuery.data])

  useEffect(() => {
    if (embeddingLogsQuery.data)
      setEmbeddingLogs(embeddingLogsQuery.data as EmbeddingLog[])
  }, [embeddingLogsQuery.data])

  useEffect(() => {
    if (networkLogsQuery.data)
      setNetworkLogs(networkLogsQuery.data as NetworkLog[])
  }, [networkLogsQuery.data])

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
    setDbStats(stats)
    await queryClient.setQueryData(queryKeys.dbStats, stats)
  }, [queryClient])

  return (
    <DataContext.Provider
      value={{
        channels,
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
        setSummariesHistory,
        loadHistory,
        dbStats,
        setDbStats,
        loadDBStats,
        publishLogs,
        setPublishLogs,
        loadLogs,
        syncLogs,
        setSyncLogs,
        loadSyncLogs,
        llmLogs,
        setLlmLogs,
        loadLLMLogs,
        embeddingLogs,
        setEmbeddingLogs,
        loadEmbeddingLogs,
        networkLogs,
        setNetworkLogs,
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
