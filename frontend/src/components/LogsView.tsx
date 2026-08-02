import { motion } from "motion/react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { EmbeddingLogsTab } from "@/components/logs/EmbeddingLogsTab"
import { LlmLogsTab } from "@/components/logs/LlmLogsTab"
import { LogFilterBar } from "@/components/logs/LogFilterBar"
import { LogsHeader } from "@/components/logs/LogsHeader"
import { LogTabBar } from "@/components/logs/LogTabBar"
import { NetworkLogsTab } from "@/components/logs/NetworkLogsTab"
import { PublishLogsTab } from "@/components/logs/PublishLogsTab"
import { SyncLogsTab } from "@/components/logs/SyncLogsTab"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { useData } from "@/contexts/DataContext"
import { useUI } from "@/contexts/UIContext"
import { useDeleteLogsMutation } from "@/hooks/useLogs"
import {
  DEFAULT_LOG_FILTERS,
  filterEmbeddingLogs,
  filterLlmLogs,
  filterNetworkLogs,
  filterPublishLogs,
  filterSyncLogs,
  type LogFilters,
  uniqueSorted,
} from "@/lib/logs/filters"
import { LOG_TAB_META, type LogTab } from "@/lib/logs/tabs"

const PAGE_SIZE = 20

interface LogTabActions {
  mutation: ReturnType<typeof useDeleteLogsMutation>
  /**
   * Still needed after the mutation invalidates.
   *
   * `DataContext` creates these queries with `enabled: false` — the panels are
   * lazy — and `invalidateQueries` does not refetch a disabled query. What the
   * invalidation buys is that this `fetchQuery` sees the entry as stale and
   * goes to the server instead of returning the cache it just made wrong.
   */
  reload: () => Promise<void>
}

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
    logsLoading,
  } = useData()
  const { setActiveTab, setCurrentSummaryId } = useUI()
  // Five unconditional calls in a fixed order — one per panel — because hooks
  // cannot be called from the `logActions` lookup below.
  const deletePublish = useDeleteLogsMutation("publish")
  const deleteSync = useDeleteLogsMutation("sync")
  const deleteLlm = useDeleteLogsMutation("llm")
  const deleteNetwork = useDeleteLogsMutation("network")
  const deleteEmbedding = useDeleteLogsMutation("embedding")
  const [activeLogTab, setActiveLogTab] = useState<LogTab>("publish")
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS)
  const [showFilters, setShowFilters] = useState(false)
  const [expandedByTab, setExpandedByTab] = useState<
    Record<LogTab, string | null>
  >({ publish: null, sync: null, llm: null, network: null, embedding: null })
  const [visibleByTab, setVisibleByTab] = useState<Record<LogTab, number>>({
    publish: PAGE_SIZE,
    sync: PAGE_SIZE,
    llm: PAGE_SIZE,
    network: PAGE_SIZE,
    embedding: PAGE_SIZE,
  })
  const [clearLogsConfirmOpen, setClearLogsConfirmOpen] = useState(false)
  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleByTab((prev) => ({
            ...prev,
            [activeLogTab]: prev[activeLogTab] + PAGE_SIZE,
          }))
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

  const modelOptions = useMemo(
    () => uniqueSorted(llmLogs.map((log) => log.model)),
    [llmLogs],
  )
  const botOptions = useMemo(
    () => uniqueSorted(publishLogs.map((log) => log.botName)),
    [publishLogs],
  )
  const channelOptions = useMemo(
    () => uniqueSorted(syncLogs.map((log) => log.channelName)),
    [syncLogs],
  )

  const filteredPublishLogs = useMemo(
    () => filterPublishLogs(publishLogs, filters),
    [publishLogs, filters],
  )
  const filteredSyncLogs = useMemo(
    () => filterSyncLogs(syncLogs, filters),
    [syncLogs, filters],
  )
  const filteredLlmLogs = useMemo(
    () => filterLlmLogs(llmLogs, filters),
    [llmLogs, filters],
  )
  const filteredNetworkLogs = useMemo(
    () => filterNetworkLogs(networkLogs, filters),
    [networkLogs, filters],
  )
  const filteredEmbeddingLogs = useMemo(
    () => filterEmbeddingLogs(embeddingLogs, filters),
    [embeddingLogs, filters],
  )

  const recordCountByTab: Record<LogTab, number> = {
    publish: filteredPublishLogs.length,
    sync: filteredSyncLogs.length,
    llm: filteredLlmLogs.length,
    network: filteredNetworkLogs.length,
    embedding: filteredEmbeddingLogs.length,
  }

  const logActions: Record<LogTab, LogTabActions> = {
    publish: { mutation: deletePublish, reload: loadLogs },
    sync: { mutation: deleteSync, reload: loadSyncLogs },
    llm: { mutation: deleteLlm, reload: loadLLMLogs },
    network: { mutation: deleteNetwork, reload: loadNetworkLogs },
    embedding: { mutation: deleteEmbedding, reload: loadEmbeddingLogs },
  }

  const updateFilters = (patch: Partial<LogFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }))
  }

  const handleSelectTab = (tab: LogTab) => {
    setActiveLogTab(tab)
    updateFilters({ searchQuery: "", statusFilter: "all" })
  }

  const handleToggleExpand = (tab: LogTab) => (id: string) => {
    setExpandedByTab((prev) => ({
      ...prev,
      [tab]: prev[tab] === id ? null : id,
    }))
  }

  const handleDelete = (tab: LogTab) => async (id: string) => {
    await logActions[tab].mutation.mutateAsync({ logId: id })
    await logActions[tab].reload()
    toast.success(`${LOG_TAB_META[tab].label} log entry deleted.`)
  }

  const handleClearLogs = () => {
    setClearLogsConfirmOpen(true)
  }

  const confirmClearLogs = async () => {
    const { noun } = LOG_TAB_META[activeLogTab]
    setClearLogsConfirmOpen(false)
    await logActions[activeLogTab].mutation.mutateAsync({ clearAll: true })
    await logActions[activeLogTab].reload()
    toast.success(`All ${noun} logs cleared.`)
  }

  const handleViewSummary = (summaryId: string) => {
    setCurrentSummaryId(summaryId)
    setActiveTab("history")
  }

  const clearLogsNoun = LOG_TAB_META[activeLogTab].noun

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div className="flex flex-col gap-4 mb-6">
        <LogsHeader
          activeTab={activeLogTab}
          recordCount={recordCountByTab[activeLogTab]}
          onClearLogs={handleClearLogs}
        />
        <LogTabBar activeTab={activeLogTab} onSelect={handleSelectTab} />
        <LogFilterBar
          activeTab={activeLogTab}
          filters={filters}
          onFiltersChange={updateFilters}
          showFilters={showFilters}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onClearAllFilters={() => setFilters(DEFAULT_LOG_FILTERS)}
          modelOptions={modelOptions}
          botOptions={botOptions}
          channelOptions={channelOptions}
        />
      </div>

      <div className="space-y-3">
        {activeLogTab === "publish" ? (
          <PublishLogsTab
            logs={filteredPublishLogs}
            isLoading={logsLoading.publish}
            visibleCount={visibleByTab.publish}
            expandedId={expandedByTab.publish}
            onToggleExpand={handleToggleExpand("publish")}
            onDelete={handleDelete("publish")}
            onViewSummary={handleViewSummary}
          />
        ) : activeLogTab === "sync" ? (
          <SyncLogsTab
            logs={filteredSyncLogs}
            isLoading={logsLoading.sync}
            visibleCount={visibleByTab.sync}
            expandedId={expandedByTab.sync}
            onToggleExpand={handleToggleExpand("sync")}
            onDelete={handleDelete("sync")}
          />
        ) : activeLogTab === "llm" ? (
          <LlmLogsTab
            logs={filteredLlmLogs}
            isLoading={logsLoading.llm}
            visibleCount={visibleByTab.llm}
            expandedId={expandedByTab.llm}
            onToggleExpand={handleToggleExpand("llm")}
            onDelete={handleDelete("llm")}
          />
        ) : activeLogTab === "network" ? (
          <NetworkLogsTab
            logs={filteredNetworkLogs}
            isLoading={logsLoading.network}
            visibleCount={visibleByTab.network}
            expandedId={expandedByTab.network}
            onToggleExpand={handleToggleExpand("network")}
            onDelete={handleDelete("network")}
          />
        ) : (
          <EmbeddingLogsTab
            logs={filteredEmbeddingLogs}
            isLoading={logsLoading.embedding}
            visibleCount={visibleByTab.embedding}
            expandedId={expandedByTab.embedding}
            onToggleExpand={handleToggleExpand("embedding")}
            onDelete={handleDelete("embedding")}
          />
        )}

        {/* Intersection Observer Target */}
        <div ref={observerTarget} className="h-10 w-full" />
      </div>

      <TgConfirmDialog
        open={clearLogsConfirmOpen}
        onOpenChange={setClearLogsConfirmOpen}
        title="Clear all logs?"
        description={`Are you sure you want to clear all ${clearLogsNoun} logs?`}
        variant="dangerSoft"
        confirmLabel="Clear all"
        onConfirm={() => {
          void confirmClearLogs()
        }}
      />
    </motion.div>
  )
}
