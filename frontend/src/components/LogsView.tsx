import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  Clock,
  Cpu,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  Hash,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
  XCircle,
  Zap,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { useData } from "../contexts/DataContext"
import { useUI } from "../contexts/UIContext"
import {
  clearEmbeddingLogs,
  clearLLMLogs,
  clearNetworkLogs,
  clearPublishLogs,
  clearSyncLogs,
  deleteEmbeddingLog,
  deleteLLMLog,
  deleteNetworkLog,
  deletePublishLog,
  deleteSyncLog,
} from "../lib/repository"
import { formatDateToLocalISO } from "../lib/utils"
import { RelativeTime } from "./RelativeTime"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

type LogTab = "publish" | "sync" | "llm" | "network" | "embedding"

export const LogsView: React.FC = () => {
  const {
    publishLogs,
    loadLogs,
    syncLogs,
    loadSyncLogs,
    llmLogs,
    loadLLMLogs,
    networkLogs,
    loadNetworkLogs,
    embeddingLogs,
    loadEmbeddingLogs,
  } = useData()
  const { setActiveTab, setCurrentSummaryId } = useUI()
  const [activeLogTab, setActiveLogTab] = useState<LogTab>("publish")
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<
    "all" | "success" | "failed"
  >("all")
  const [startDate, setStartDate] = useState<number | null>(null)
  const [endDate, setEndDate] = useState<number | null>(null)
  const [modelFilter, setModelFilter] = useState("all")
  const [botFilter, setBotFilter] = useState("all")
  const [channelFilter, setChannelFilter] = useState("all")
  const [searchInDetails, setSearchInDetails] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedLlmLog, setExpandedLlmLog] = useState<string | null>(null)
  const [expandedPublishLog, setExpandedPublishLog] = useState<string | null>(
    null,
  )
  const [expandedSyncLog, setExpandedSyncLog] = useState<string | null>(null)
  const [expandedNetworkLog, setExpandedNetworkLog] = useState<string | null>(
    null,
  )
  const [expandedEmbeddingLog, setExpandedEmbeddingLog] = useState<
    string | null
  >(null)

  const [visiblePublishLogs, setVisiblePublishLogs] = useState(20)
  const [visibleSyncLogs, setVisibleSyncLogs] = useState(20)
  const [visibleLlmLogs, setVisibleLlmLogs] = useState(20)
  const [visibleNetworkLogs, setVisibleNetworkLogs] = useState(20)
  const [visibleEmbeddingLogs, setVisibleEmbeddingLogs] = useState(20)
  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisiblePublishLogs(20)
    setVisibleSyncLogs(20)
    setVisibleLlmLogs(20)
    setVisibleNetworkLogs(20)
    setVisibleEmbeddingLogs(20)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          if (activeLogTab === "publish") {
            setVisiblePublishLogs((prev) => prev + 20)
          } else if (activeLogTab === "sync") {
            setVisibleSyncLogs((prev) => prev + 20)
          } else if (activeLogTab === "llm") {
            setVisibleLlmLogs((prev) => prev + 20)
          } else if (activeLogTab === "network") {
            setVisibleNetworkLogs((prev) => prev + 20)
          } else if (activeLogTab === "embedding") {
            setVisibleEmbeddingLogs((prev) => prev + 20)
          }
        }
      },
      { threshold: 0.1 },
    )

    if (observerTarget.current) {
      observer.observe(observerTarget.current)
    }

    return () => {
      if (observerTarget.current) {
        observer.unobserve(observerTarget.current)
      }
    }
  }, [activeLogTab])

  const uniqueModels = useMemo(() => {
    const models = new Set<string>()
    llmLogs.forEach((log) => models.add(log.model))
    return Array.from(models).sort()
  }, [llmLogs])

  const uniqueBots = useMemo(() => {
    const bots = new Set<string>()
    publishLogs.forEach((log) => bots.add(log.botName))
    return Array.from(bots).sort()
  }, [publishLogs])

  const uniqueChannels = useMemo(() => {
    const channels = new Set<string>()
    syncLogs.forEach((log) => channels.add(log.channelName))
    return Array.from(channels).sort()
  }, [syncLogs])

  const filteredPublishLogs = useMemo(() => {
    return publishLogs.filter((log) => {
      // Status filter
      if (statusFilter !== "all" && log.status !== statusFilter) return false

      // Bot filter
      if (botFilter !== "all" && log.botName !== botFilter) return false

      // Date range filter
      if (startDate !== null) {
        if (log.timestamp < startDate) return false
      }
      if (endDate !== null) {
        const end = endDate + 24 * 60 * 60 * 1000 // End of day
        if (log.timestamp > end) return false
      }

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesBot = log.botName.toLowerCase().includes(q)
        const matchesChat = log.chatName.toLowerCase().includes(q)
        const matchesChatId = log.chatId.toLowerCase().includes(q)
        const matchesError = log.error?.toLowerCase().includes(q)
        const matchesText = log.textSent?.toLowerCase().includes(q)

        let matchesDetails = false
        if (searchInDetails) {
          const reqStr = log.fullRequest
            ? JSON.stringify(log.fullRequest).toLowerCase()
            : ""
          const resStr = log.fullResponse
            ? JSON.stringify(log.fullResponse).toLowerCase()
            : ""
          matchesDetails = reqStr.includes(q) || resStr.includes(q)
        }

        if (
          !matchesBot &&
          !matchesChat &&
          !matchesChatId &&
          !matchesError &&
          !matchesText &&
          !matchesDetails
        )
          return false
      }
      return true
    })
  }, [
    publishLogs,
    statusFilter,
    searchQuery,
    startDate,
    endDate,
    botFilter,
    searchInDetails,
  ])

  const filteredSyncLogs = useMemo(() => {
    return syncLogs.filter((log) => {
      // Status filter
      if (statusFilter !== "all" && log.status !== statusFilter) return false

      // Channel filter
      if (channelFilter !== "all" && log.channelName !== channelFilter)
        return false

      // Date range filter
      if (startDate !== null) {
        if (log.timestamp < startDate) return false
      }
      if (endDate !== null) {
        const end = endDate + 24 * 60 * 60 * 1000 // End of day
        if (log.timestamp > end) return false
      }

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesChannel = log.channelName.toLowerCase().includes(q)
        const matchesSource = log.source.toLowerCase().includes(q)
        const matchesError = log.error?.toLowerCase().includes(q)

        let matchesDetails = false
        if (searchInDetails) {
          const reqStr = log.fullRequest
            ? JSON.stringify(log.fullRequest).toLowerCase()
            : ""
          const resStr = log.fullResponse
            ? JSON.stringify(log.fullResponse).toLowerCase()
            : ""
          matchesDetails = reqStr.includes(q) || resStr.includes(q)
        }

        if (
          !matchesChannel &&
          !matchesSource &&
          !matchesError &&
          !matchesDetails
        )
          return false
      }
      return true
    })
  }, [
    syncLogs,
    statusFilter,
    searchQuery,
    startDate,
    endDate,
    channelFilter,
    searchInDetails,
  ])

  const filteredLlmLogs = useMemo(() => {
    return llmLogs.filter((log) => {
      // Status filter
      if (statusFilter !== "all" && log.status !== statusFilter) return false

      // Model filter
      if (modelFilter !== "all" && log.model !== modelFilter) return false

      // Date range filter
      if (startDate !== null) {
        if (log.timestamp < startDate) return false
      }
      if (endDate !== null) {
        const end = endDate + 24 * 60 * 60 * 1000 // End of day
        if (log.timestamp > end) return false
      }

      // Search query
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesModel = log.model.toLowerCase().includes(q)
        const matchesPrompt = log.prompt.toLowerCase().includes(q)
        const matchesResponse = log.response.toLowerCase().includes(q)
        const matchesError = log.error?.toLowerCase().includes(q)

        let matchesDetails = false
        if (searchInDetails) {
          const reqStr = log.fullRequest
            ? JSON.stringify(log.fullRequest).toLowerCase()
            : ""
          const resStr = log.fullResponse
            ? JSON.stringify(log.fullResponse).toLowerCase()
            : ""
          matchesDetails = reqStr.includes(q) || resStr.includes(q)
        }

        if (
          !matchesModel &&
          !matchesPrompt &&
          !matchesResponse &&
          !matchesError &&
          !matchesDetails
        )
          return false
      }
      return true
    })
  }, [
    llmLogs,
    statusFilter,
    searchQuery,
    startDate,
    endDate,
    modelFilter,
    searchInDetails,
  ])

  const filteredNetworkLogs = useMemo(() => {
    return networkLogs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false
      if (startDate !== null) {
        if (log.timestamp < startDate) return false
      }
      if (endDate !== null) {
        const end = endDate + 24 * 60 * 60 * 1000
        if (log.timestamp > end) return false
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesUrl = log.url.toLowerCase().includes(q)
        const matchesMethod = log.method.toLowerCase().includes(q)
        const matchesError = log.error?.toLowerCase().includes(q)
        let matchesDetails = false
        if (searchInDetails) {
          const telStr = log.telemetry
            ? JSON.stringify(log.telemetry).toLowerCase()
            : ""
          matchesDetails = telStr.includes(q)
        }
        if (!matchesUrl && !matchesMethod && !matchesError && !matchesDetails)
          return false
      }
      return true
    })
  }, [
    networkLogs,
    statusFilter,
    searchQuery,
    startDate,
    endDate,
    searchInDetails,
  ])

  const filteredEmbeddingLogs = useMemo(() => {
    return embeddingLogs.filter((log) => {
      if (statusFilter !== "all" && log.status !== statusFilter) return false
      if (startDate !== null) {
        if (log.timestamp < startDate) return false
      }
      if (endDate !== null) {
        const end = endDate + 24 * 60 * 60 * 1000
        if (log.timestamp > end) return false
      }
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const matchesText = log.textCount.toString().includes(q)
        const matchesError = log.error?.toLowerCase().includes(q)
        if (!matchesText && !matchesError) return false
      }
      return true
    })
  }, [embeddingLogs, statusFilter, searchQuery, startDate, endDate])

  const handleDeletePublishLog = async (id: string) => {
    await deletePublishLog(id)
    await loadLogs()
    toast.success("Publish log entry deleted.")
  }

  const handleClearPublishLogs = async () => {
    if (window.confirm("Are you sure you want to clear all publish logs?")) {
      await clearPublishLogs()
      await loadLogs()
      toast.success("All publish logs cleared.")
    }
  }

  const handleDeleteSyncLog = async (id: string) => {
    await deleteSyncLog(id)
    await loadSyncLogs()
    toast.success("Sync log entry deleted.")
  }

  const handleClearSyncLogs = async () => {
    if (window.confirm("Are you sure you want to clear all sync logs?")) {
      await clearSyncLogs()
      await loadSyncLogs()
      toast.success("All sync logs cleared.")
    }
  }

  const handleDeleteLlmLog = async (id: string) => {
    await deleteLLMLog(id)
    await loadLLMLogs()
    toast.success("LLM log entry deleted.")
  }

  const handleClearLlmLogs = async () => {
    if (window.confirm("Are you sure you want to clear all LLM logs?")) {
      await clearLLMLogs()
      await loadLLMLogs()
      toast.success("All LLM logs cleared.")
    }
  }

  const handleDeleteNetworkLog = async (id: string) => {
    await deleteNetworkLog(id)
    await loadNetworkLogs()
    toast.success("Network log entry deleted.")
  }

  const handleClearNetworkLogs = async () => {
    if (window.confirm("Are you sure you want to clear all network logs?")) {
      await clearNetworkLogs()
      await loadNetworkLogs()
      toast.success("All network logs cleared.")
    }
  }

  const handleDeleteEmbeddingLog = async (id: string) => {
    await deleteEmbeddingLog(id)
    await loadEmbeddingLogs()
    toast.success("Embedding log entry deleted.")
  }

  const handleClearEmbeddingLogs = async () => {
    if (window.confirm("Are you sure you want to clear all embedding logs?")) {
      await clearEmbeddingLogs()
      await loadEmbeddingLogs()
      toast.success("All embedding logs cleared.")
    }
  }

  const handleClearAllFilters = () => {
    setSearchQuery("")
    setStatusFilter("all")
    setStartDate(null)
    setEndDate(null)
    setModelFilter("all")
    setBotFilter("all")
    setChannelFilter("all")
    setSearchInDetails(false)
  }

  const isAnyFilterActive = useMemo(() => {
    return (
      searchQuery !== "" ||
      statusFilter !== "all" ||
      startDate !== null ||
      endDate !== null ||
      modelFilter !== "all" ||
      botFilter !== "all" ||
      channelFilter !== "all" ||
      searchInDetails
    )
  }, [
    searchQuery,
    statusFilter,
    startDate,
    endDate,
    modelFilter,
    botFilter,
    channelFilter,
    searchInDetails,
  ])

  const _formatDateTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    })
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                System Logs
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [
                {activeLogTab === "publish"
                  ? filteredPublishLogs.length
                  : activeLogTab === "sync"
                    ? filteredSyncLogs.length
                    : activeLogTab === "llm"
                      ? filteredLlmLogs.length
                      : activeLogTab === "network"
                        ? filteredNetworkLogs.length
                        : filteredEmbeddingLogs.length}{" "}
                RECORDS]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              {activeLogTab === "publish"
                ? "Track all messages sent to Telegram bots."
                : activeLogTab === "sync"
                  ? "Track all channel synchronization attempts."
                  : activeLogTab === "llm"
                    ? "Track all interactions with Large Language Models."
                    : activeLogTab === "network"
                      ? "Track all network requests and proxy/TOR usage."
                      : "Track all embedding generations."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={
                activeLogTab === "publish"
                  ? handleClearPublishLogs
                  : activeLogTab === "sync"
                    ? handleClearSyncLogs
                    : activeLogTab === "llm"
                      ? handleClearLlmLogs
                      : activeLogTab === "network"
                        ? handleClearNetworkLogs
                        : handleClearEmbeddingLogs
              }
              className="px-3 py-1.5 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all text-[9px] uppercase font-bold flex items-center gap-2"
            >
              <Trash2 size={12} />
              Clear{" "}
              {activeLogTab === "publish"
                ? "Publish"
                : activeLogTab === "sync"
                  ? "Sync"
                  : activeLogTab === "llm"
                    ? "LLM"
                    : activeLogTab === "network"
                      ? "Network"
                      : "Embedding"}{" "}
              Logs
            </button>
          </div>
        </div>

        <div className="flex border-b border-app-ink/10">
          <button
            type="button"
            onClick={() => {
              setActiveLogTab("publish")
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
              activeLogTab === "publish"
                ? "border-app-ink opacity-100"
                : "border-transparent opacity-40"
            }`}
          >
            Publish Logs
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLogTab("sync")
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
              activeLogTab === "sync"
                ? "border-app-ink opacity-100"
                : "border-transparent opacity-40"
            }`}
          >
            Sync Logs
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLogTab("llm")
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
              activeLogTab === "llm"
                ? "border-app-ink opacity-100"
                : "border-transparent opacity-40"
            }`}
          >
            LLM Logs
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLogTab("network")
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
              activeLogTab === "network"
                ? "border-app-ink opacity-100"
                : "border-transparent opacity-40"
            }`}
          >
            Network Logs
          </button>
          <button
            type="button"
            onClick={() => {
              setActiveLogTab("embedding")
              setSearchQuery("")
              setStatusFilter("all")
            }}
            className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
              activeLogTab === "embedding"
                ? "border-app-ink opacity-100"
                : "border-transparent opacity-40"
            }`}
          >
            Embedding Logs
          </button>
        </div>

        <div className="flex gap-2">
          <div className="flex-1 flex gap-2">
            <div className="relative flex-1">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 opacity-30"
              />
              <input
                type="text"
                placeholder={
                  activeLogTab === "publish"
                    ? "SEARCH PUBLISH LOGS..."
                    : activeLogTab === "sync"
                      ? "SEARCH SYNC LOGS..."
                      : activeLogTab === "llm"
                        ? "SEARCH LLM LOGS..."
                        : activeLogTab === "network"
                          ? "SEARCH NETWORK LOGS..."
                          : "SEARCH EMBEDDING LOGS..."
                }
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-app-ink/5 border border-app-ink/10 pl-10 pr-4 py-2 text-[10px] font-mono focus:outline-none focus:border-app-ink/30 transition-all uppercase tracking-widest"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 opacity-30 hover:opacity-100"
                >
                  <X size={14} />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 px-3 border border-app-ink/10 bg-app-ink/5">
              <input
                type="checkbox"
                id="search-details"
                checked={searchInDetails}
                onChange={(e) => setSearchInDetails(e.target.checked)}
                className="w-3 h-3 accent-app-ink"
              />
              <label
                htmlFor="search-details"
                className="text-[8px] uppercase font-bold opacity-50 cursor-pointer select-none"
              >
                Search in Details
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className={`px-4 flex items-center gap-2 border transition-all text-[10px] uppercase font-bold tracking-tighter ${
              showFilters || isAnyFilterActive
                ? "bg-app-ink text-app-bg border-app-ink"
                : "bg-app-ink/5 border-app-ink/10 hover:border-app-ink/30"
            }`}
          >
            <Filter size={14} />
            Filters
            <ChevronDown
              size={12}
              className={`transition-transform ${showFilters ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        <AnimatePresence>
          {showFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="p-4 bg-app-ink/5 border border-app-ink/10 space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Status Filter */}
                  <div className="space-y-2">
                    <label className="text-[9px] uppercase font-bold opacity-50">
                      Status
                    </label>
                    <div className="flex gap-2">
                      {(["all", "success", "failed"] as const).map((s) => (
                        <button
                          type="button"
                          key={s}
                          onClick={() => setStatusFilter(s)}
                          className={`px-3 py-1 text-[9px] uppercase font-bold tracking-widest transition-all border ${
                            statusFilter === s
                              ? "bg-app-ink text-app-bg border-app-ink"
                              : "bg-transparent border-app-ink/10 opacity-50 hover:opacity-100"
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Date Range Filter */}
                  <div className="space-y-2 col-span-1 md:col-span-2">
                    <label className="text-[9px] uppercase font-bold opacity-50">
                      Date Range
                    </label>
                    <div className="flex items-center gap-3">
                      <input
                        type="date"
                        value={
                          startDate && !Number.isNaN(startDate)
                            ? formatDateToLocalISO(new Date(startDate)).split(
                                "T",
                              )[0]
                            : ""
                        }
                        max={formatDateToLocalISO(new Date()).split("T")[0]}
                        onChange={(e) => {
                          if (e.target.value) {
                            const time = new Date(
                              `${e.target.value}T00:00:00`,
                            ).getTime()
                            setStartDate(Number.isNaN(time) ? null : time)
                          } else {
                            setStartDate(null)
                          }
                        }}
                        className="bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                      />
                      <span className="opacity-30 text-[10px]">TO</span>
                      <input
                        type="date"
                        value={
                          endDate && !Number.isNaN(endDate)
                            ? formatDateToLocalISO(new Date(endDate)).split(
                                "T",
                              )[0]
                            : ""
                        }
                        max={formatDateToLocalISO(new Date()).split("T")[0]}
                        onChange={(e) => {
                          if (e.target.value) {
                            const time = new Date(
                              `${e.target.value}T00:00:00`,
                            ).getTime()
                            setEndDate(Number.isNaN(time) ? null : time)
                          } else {
                            setEndDate(null)
                          }
                        }}
                        className="bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t border-app-ink/5">
                  {/* Tab Specific Filters */}
                  {activeLogTab === "llm" && (
                    <div className="space-y-2">
                      <label className="text-[9px] uppercase font-bold opacity-50">
                        Model
                      </label>
                      <select
                        value={modelFilter}
                        onChange={(e) => setModelFilter(e.target.value)}
                        className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                      >
                        <option value="all">ALL MODELS</option>
                        {uniqueModels.map((m) => (
                          <option key={m} value={m}>
                            {m.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeLogTab === "publish" && (
                    <div className="space-y-2">
                      <label className="text-[9px] uppercase font-bold opacity-50">
                        Bot
                      </label>
                      <select
                        value={botFilter}
                        onChange={(e) => setBotFilter(e.target.value)}
                        className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                      >
                        <option value="all">ALL BOTS</option>
                        {uniqueBots.map((b) => (
                          <option key={b} value={b}>
                            {b.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeLogTab === "sync" && (
                    <div className="space-y-2">
                      <label className="text-[9px] uppercase font-bold opacity-50">
                        Channel
                      </label>
                      <select
                        value={channelFilter}
                        onChange={(e) => setChannelFilter(e.target.value)}
                        className="w-full bg-transparent border border-app-ink/10 px-2 py-1 text-[10px] font-mono focus:outline-none focus:border-app-ink/30"
                      >
                        <option value="all">ALL CHANNELS</option>
                        {uniqueChannels.map((c) => (
                          <option key={c} value={c}>
                            {c.toUpperCase()}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="flex items-end md:col-start-3">
                    <button
                      type="button"
                      onClick={handleClearAllFilters}
                      disabled={!isAnyFilterActive}
                      className="w-full py-2 border border-app-ink/10 text-[9px] uppercase font-bold tracking-widest hover:bg-app-ink hover:text-app-bg transition-all disabled:opacity-20 disabled:hover:bg-transparent disabled:hover:text-app-ink"
                    >
                      Clear All Filters
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="space-y-3">
        {activeLogTab === "publish" ? (
          filteredPublishLogs.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
              <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
                No publish logs found
              </p>
            </div>
          ) : (
            filteredPublishLogs.slice(0, visiblePublishLogs).map((log) => (
              <div
                key={log.id}
                className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
                  log.status === "failed"
                    ? "border-l-4 border-l-red-500"
                    : "border-l-4 border-l-green-500"
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-full ${log.status === "success" ? "bg-green-500/10 text-green-600" : "bg-red-500/10 text-red-600"}`}
                    >
                      {log.status === "success" ? (
                        <CheckCircle2 size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                          {log.status === "success"
                            ? "Published Successfully"
                            : "Publish Failed"}
                        </span>
                        <span className="text-[9px] opacity-30 font-mono">
                          <RelativeTime timestamp={log.timestamp} />
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Bot size={10} />
                          <span>Bot: {log.botName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Send size={10} />
                          <span>
                            Dest: {log.chatName} ({log.chatId})
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedPublishLog(
                              expandedPublishLog === log.id ? null : log.id,
                            )
                          }
                          className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${expandedPublishLog === log.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {expandedPublishLog === log.id
                            ? "Collapse"
                            : "Expand"}{" "}
                          Details
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => {
                            setCurrentSummaryId(log.summaryId)
                            setActiveTab("history")
                          }}
                          className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                        >
                          <ExternalLink size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>View Summary in History</p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleDeletePublishLog(log.id)}
                          className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete Log Entry</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {log.status === "failed" && log.error && (
                  <div className="mt-3 p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3">
                    <AlertTriangle
                      size={14}
                      className="text-red-500 shrink-0 mt-0.5"
                    />
                    <div className="space-y-1">
                      <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
                        Error Message:
                      </p>
                      <p className="text-[10px] font-mono text-red-600 leading-relaxed">
                        {log.error}
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-3 pt-3 border-t border-app-ink/5">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] font-bold uppercase opacity-40">
                      Summary ID:
                    </span>
                    <span className="text-[8px] font-mono opacity-60">
                      {log.summaryId}
                    </span>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedPublishLog === log.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
                        {log.textSent && (
                          <div className="space-y-1.5">
                            <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
                              <FileText size={10} />
                              Text Sent
                            </label>
                            <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed opacity-80">
                              {log.textSent}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {log.fullRequest && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Request (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullRequest, null, 2)}
                              </div>
                            </div>
                          )}
                          {log.fullResponse && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Response (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullResponse, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )
        ) : activeLogTab === "sync" ? (
          filteredSyncLogs.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
              <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
                No sync logs found
              </p>
            </div>
          ) : (
            filteredSyncLogs.slice(0, visibleSyncLogs).map((log) => (
              <div
                key={log.id}
                className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
                  log.status === "failed"
                    ? "border-l-4 border-l-red-500"
                    : "border-l-4 border-l-blue-500"
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-full ${log.status === "success" ? "bg-blue-500/10 text-blue-600" : "bg-red-500/10 text-red-600"}`}
                    >
                      {log.status === "success" ? (
                        <RefreshCw size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                          {log.status === "success"
                            ? "Sync Successful"
                            : "Sync Failed"}
                        </span>
                        <span className="text-[9px] opacity-30 font-mono">
                          <RelativeTime timestamp={log.timestamp} />
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Activity size={10} />
                          <span>Channel: @{log.channelName}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Clock size={10} />
                          <span>Source: {log.source}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedSyncLog(
                              expandedSyncLog === log.id ? null : log.id,
                            )
                          }
                          className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${expandedSyncLog === log.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {expandedSyncLog === log.id ? "Collapse" : "Expand"}{" "}
                          Details
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleDeleteSyncLog(log.id)}
                          className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete Log Entry</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {log.status === "success" && (
                  <div className="mt-2 flex items-center gap-4">
                    <div className="flex items-center gap-1.5 text-[9px] font-mono opacity-60">
                      <Hash size={10} />
                      <span>New Posts: {log.postsCount}</span>
                    </div>
                    {log.newLatestId && (
                      <div className="flex items-center gap-1.5 text-[9px] font-mono opacity-60">
                        <span className="font-bold uppercase">Latest ID:</span>
                        <span>{log.newLatestId}</span>
                      </div>
                    )}
                  </div>
                )}

                {log.status === "failed" && log.error && (
                  <div className="mt-3 p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3">
                    <AlertTriangle
                      size={14}
                      className="text-red-500 shrink-0 mt-0.5"
                    />
                    <div className="space-y-1">
                      <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
                        Error Message:
                      </p>
                      <p className="text-[10px] font-mono text-red-600 leading-relaxed">
                        {log.error}
                      </p>
                    </div>
                  </div>
                )}

                <AnimatePresence>
                  {expandedSyncLog === log.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {log.fullRequest && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Request (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullRequest, null, 2)}
                              </div>
                            </div>
                          )}
                          {log.fullResponse && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Response (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullResponse, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )
        ) : activeLogTab === "llm" ? (
          filteredLlmLogs.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
              <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
                No LLM logs found
              </p>
            </div>
          ) : (
            filteredLlmLogs.slice(0, visibleLlmLogs).map((log) => (
              <div
                key={log.id}
                className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
                  log.status === "failed"
                    ? "border-l-4 border-l-red-500"
                    : "border-l-4 border-l-purple-500"
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-full ${log.status === "success" ? "bg-purple-500/10 text-purple-600" : "bg-red-500/10 text-red-600"}`}
                    >
                      {log.status === "success" ? (
                        <Cpu size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                          {log.status === "success"
                            ? "LLM Interaction"
                            : "LLM Error"}
                        </span>
                        <span className="text-[9px] opacity-30 font-mono">
                          <RelativeTime timestamp={log.timestamp} />
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Cpu size={10} />
                          <span>Model: {log.model}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          {log.type === "chat" ? (
                            <MessageSquare size={10} />
                          ) : (
                            <FileText size={10} />
                          )}
                          <span>Type: {log.type}</span>
                        </div>
                        {log.duration && (
                          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                            <Zap size={10} />
                            <span>{log.duration}ms</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedLlmLog(
                              expandedLlmLog === log.id ? null : log.id,
                            )
                          }
                          className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${expandedLlmLog === log.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {expandedLlmLog === log.id ? "Collapse" : "Expand"}{" "}
                          Details
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleDeleteLlmLog(log.id)}
                          className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete Log Entry</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedLlmLog === log.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
                        <div className="flex flex-wrap gap-4 mb-4">
                          {log.tokens && (
                            <div className="flex flex-col">
                              <span className="text-[7px] font-mono uppercase tracking-widest opacity-30 mb-0.5">
                                Total Tokens
                              </span>
                              <span className="text-[10px] font-bold tracking-tighter leading-none font-mono">
                                {log.tokens}
                              </span>
                            </div>
                          )}
                          {log.modelConfig && (
                            <div className="flex flex-col">
                              <span className="text-[7px] font-mono uppercase tracking-widest opacity-30 mb-0.5">
                                Temperature
                              </span>
                              <span className="text-[10px] font-bold tracking-tighter leading-none font-mono">
                                {log.modelConfig.temperature}
                              </span>
                            </div>
                          )}
                        </div>

                        {log.systemInstruction && (
                          <div className="space-y-1.5">
                            <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
                              <Bot size={10} />
                              System Instruction
                            </label>
                            <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed opacity-80">
                              {log.systemInstruction}
                            </div>
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
                            <MessageSquare size={10} />
                            Prompt / Input
                          </label>
                          <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed opacity-80">
                            {log.prompt}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
                            <FileText size={10} />
                            Response / Output
                          </label>
                          <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-60 overflow-y-auto leading-relaxed">
                            {log.response ||
                              (log.status === "failed"
                                ? "No response generated."
                                : "Empty response.")}
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {log.fullRequest && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Request (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullRequest, null, 2)}
                              </div>
                            </div>
                          )}
                          {log.fullResponse && (
                            <div className="space-y-1.5">
                              <label className="text-[8px] uppercase font-bold opacity-40">
                                Full Response (JSON)
                              </label>
                              <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                                {JSON.stringify(log.fullResponse, null, 2)}
                              </div>
                            </div>
                          )}
                        </div>
                        {log.error && (
                          <div className="p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3">
                            <AlertTriangle
                              size={14}
                              className="text-red-500 shrink-0 mt-0.5"
                            />
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
                                Error Message:
                              </p>
                              <p className="text-[10px] font-mono text-red-600 leading-relaxed">
                                {log.error}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )
        ) : activeLogTab === "network" ? (
          filteredNetworkLogs.length === 0 ? (
            <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
              <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
                No network logs found
              </p>
            </div>
          ) : (
            filteredNetworkLogs.slice(0, visibleNetworkLogs).map((log) => (
              <div
                key={log.id}
                className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
                  log.status === "failed"
                    ? "border-l-4 border-l-red-500"
                    : "border-l-4 border-l-teal-500"
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2 rounded-full ${log.status === "success" ? "bg-teal-500/10 text-teal-600" : "bg-red-500/10 text-red-600"}`}
                    >
                      {log.status === "success" ? (
                        <Globe size={16} />
                      ) : (
                        <XCircle size={16} />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                          {log.status === "success"
                            ? "Network Request"
                            : "Network Error"}
                        </span>
                        <span className="text-[9px] opacity-30 font-mono">
                          <RelativeTime timestamp={log.timestamp} />
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1">
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Activity size={10} />
                          <span>{log.method}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Globe size={10} />
                          <span className="truncate max-w-[200px]">
                            {log.url}
                          </span>
                        </div>
                        {log.duration && (
                          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                            <Clock size={10} />
                            <span>{log.duration}ms</span>
                          </div>
                        )}
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Activity size={10} />
                          <span>
                            {log.proxyUsed
                              ? log.proxyUsed.includes("socks5h://127.0.0.1")
                                ? "Tor"
                                : "Proxy"
                              : "Direct"}
                          </span>
                        </div>
                        {log.attempts && log.attempts > 1 && (
                          <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                            <RefreshCw size={10} />
                            <span>{log.attempts} tries</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedNetworkLog(
                              expandedNetworkLog === log.id ? null : log.id,
                            )
                          }
                          className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                        >
                          <ChevronDown
                            size={14}
                            className={`transition-transform ${expandedNetworkLog === log.id ? "rotate-180" : ""}`}
                          />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>
                          {expandedNetworkLog === log.id
                            ? "Collapse"
                            : "Expand"}{" "}
                          Details
                        </p>
                      </TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => handleDeleteNetworkLog(log.id)}
                          className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
                        >
                          <Trash2 size={14} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Delete Log Entry</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                <AnimatePresence>
                  {expandedNetworkLog === log.id && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      className="overflow-hidden"
                    >
                      <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
                        {log.telemetry && (
                          <div className="space-y-1.5">
                            <label className="text-[8px] uppercase font-bold opacity-40">
                              Telemetry Data
                            </label>
                            <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[9px] whitespace-pre overflow-x-auto max-h-60 opacity-60">
                              {JSON.stringify(log.telemetry, null, 2)}
                            </div>
                          </div>
                        )}
                        {log.error && (
                          <div className="p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3">
                            <AlertTriangle
                              size={14}
                              className="text-red-500 shrink-0 mt-0.5"
                            />
                            <div className="space-y-1">
                              <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
                                Error Message:
                              </p>
                              <p className="text-[10px] font-mono text-red-600 leading-relaxed">
                                {log.error}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            ))
          )
        ) : filteredEmbeddingLogs.length === 0 ? (
          <div className="py-20 text-center border border-dashed border-app-ink/10 opacity-30">
            <p className="text-[10px] uppercase font-mono tracking-[0.2em]">
              No embedding logs found
            </p>
          </div>
        ) : (
          filteredEmbeddingLogs.slice(0, visibleEmbeddingLogs).map((log) => (
            <div
              key={log.id}
              className={`group border border-app-ink border-opacity-10 p-4 transition-all hover:border-opacity-30 bg-app-card ${
                log.status === "failed"
                  ? "border-l-4 border-l-red-500"
                  : "border-l-4 border-l-orange-500"
              }`}
            >
              <div className="flex justify-between items-start mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`p-2 rounded-full ${log.status === "success" ? "bg-orange-500/10 text-orange-600" : "bg-red-500/10 text-red-600"}`}
                  >
                    {log.status === "success" ? (
                      <Hash size={16} />
                    ) : (
                      <XCircle size={16} />
                    )}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-mono font-bold uppercase tracking-widest">
                        {log.status === "success"
                          ? "Embedding Generation"
                          : "Embedding Error"}
                      </span>
                      <span className="text-[9px] opacity-30 font-mono">
                        <RelativeTime timestamp={log.timestamp} />
                      </span>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                        <Hash size={10} />
                        <span>Tokens: {log.tokensEstimated || 0}</span>
                      </div>
                      {log.duration && (
                        <div className="flex items-center gap-1.5 text-[9px] font-bold uppercase opacity-60">
                          <Clock size={10} />
                          <span>{log.duration}ms</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedEmbeddingLog(
                            expandedEmbeddingLog === log.id ? null : log.id,
                          )
                        }
                        className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
                      >
                        <ChevronDown
                          size={14}
                          className={`transition-transform ${expandedEmbeddingLog === log.id ? "rotate-180" : ""}`}
                        />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {expandedEmbeddingLog === log.id
                          ? "Collapse"
                          : "Expand"}{" "}
                        Details
                      </p>
                    </TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => handleDeleteEmbeddingLog(log.id)}
                        className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
                      >
                        <Trash2 size={14} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>Delete Log Entry</p>
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              <AnimatePresence>
                {expandedEmbeddingLog === log.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 space-y-4 pt-4 border-t border-app-ink/5">
                      <div className="space-y-1.5">
                        <label className="text-[8px] uppercase font-bold opacity-40 flex items-center gap-1.5">
                          <FileText size={10} />
                          Input Details
                        </label>
                        <div className="p-3 bg-app-ink/5 border border-app-ink/10 rounded font-mono text-[10px] whitespace-pre-wrap max-h-40 overflow-y-auto leading-relaxed opacity-80">
                          Texts embedded: {log.textCount}
                        </div>
                      </div>
                      {log.error && (
                        <div className="p-3 bg-red-500/5 border border-red-500/10 rounded flex items-start gap-3">
                          <AlertTriangle
                            size={14}
                            className="text-red-500 shrink-0 mt-0.5"
                          />
                          <div className="space-y-1">
                            <p className="text-[9px] font-bold uppercase text-red-500 opacity-70">
                              Error Message:
                            </p>
                            <p className="text-[10px] font-mono text-red-600 leading-relaxed">
                              {log.error}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          ))
        )}

        {/* Intersection Observer Target */}
        <div ref={observerTarget} className="h-10 w-full" />
      </div>
    </motion.div>
  )
}
