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
import { useUI } from "@/contexts/UIContext"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import {
  useDeleteLogsMutation,
  useEmbeddingLogsQuery,
  useLLMLogsQuery,
  useNetworkLogsQuery,
  usePublishLogsQuery,
  useSyncLogsQuery,
} from "@/hooks/useLogs"
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
import type {
  EmbeddingLog,
  LLMLog,
  NetworkLog,
  PublishLog,
  SyncLog,
} from "@/types"

const PAGE_SIZE = 20

// Stable empty defaults: a fresh `[]` per render would re-run every `useMemo`
// keyed on these lists.
const EMPTY_PUBLISH: PublishLog[] = []
const EMPTY_SYNC: SyncLog[] = []
const EMPTY_LLM: LLMLog[] = []
const EMPTY_NETWORK: NetworkLog[] = []
const EMPTY_EMBEDDING: EmbeddingLog[] = []

export const LogsView: React.FC = () => {
  /**
   * The panels own their queries.
   *
   * These used to arrive through `DataContext`, which held all five lists,
   * five imperative `loadXLogs()` reloads and a `logsLoading` map — ~11 of its
   * fields — purely to pass server state that react-query already owns.
   * `NetworkTelemetry` was already doing it this way.
   *
   * **`enabled: true` is what makes the reloads unnecessary.** With the queries
   * disabled, `invalidateQueries` marked them stale but could not refetch them,
   * so every writer had to call back here imperatively. Enabled, the
   * invalidation in `lib/logs/write.ts` refetches on its own.
   */
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS)

  /**
   * The text search runs on the server now.
   *
   * It has to: the list no longer carries `fullRequest` / `fullResponse` (or
   * the LLM prompt and response), so "search in details" has nothing left to
   * match client-side. It is also strictly better — the match is over the whole
   * table rather than the 500 rows that happened to be fetched.
   *
   * Debounced because it is a request per change, and part of the query key so
   * a new term refetches. The other filters stay client-side: they read fields
   * the list still carries and cost nothing there.
   */
  const logSearch = useDebouncedValue(
    useMemo(
      () => ({
        query: filters.searchQuery,
        inDetails: filters.searchInDetails,
      }),
      [filters.searchQuery, filters.searchInDetails],
    ),
    300,
  )

  const publishQuery = usePublishLogsQuery(true, { search: logSearch })
  const syncQuery = useSyncLogsQuery(true, { search: logSearch })
  const llmQuery = useLLMLogsQuery(true, { search: logSearch })
  const networkQuery = useNetworkLogsQuery(true, { search: logSearch })
  const embeddingQuery = useEmbeddingLogsQuery(true, { search: logSearch })

  const publishLogs = publishQuery.data ?? EMPTY_PUBLISH
  const syncLogs = syncQuery.data ?? EMPTY_SYNC
  const llmLogs = llmQuery.data ?? EMPTY_LLM
  const networkLogs = networkQuery.data ?? EMPTY_NETWORK
  const embeddingLogs = embeddingQuery.data ?? EMPTY_EMBEDDING

  /** First-load only: a refetch must not blank a panel that already has rows. */
  const logsLoading: Record<LogTab, boolean> = {
    publish: publishQuery.isPending && publishLogs.length === 0,
    sync: syncQuery.isPending && syncLogs.length === 0,
    llm: llmQuery.isPending && llmLogs.length === 0,
    network: networkQuery.isPending && networkLogs.length === 0,
    embedding: embeddingQuery.isPending && embeddingLogs.length === 0,
  }

  const { setActiveTab, setCurrentSummaryId } = useUI()
  // Five unconditional calls in a fixed order — one per panel — because hooks
  // cannot be called from the `logActions` lookup below.
  const deletePublish = useDeleteLogsMutation("publish")
  const deleteSync = useDeleteLogsMutation("sync")
  const deleteLlm = useDeleteLogsMutation("llm")
  const deleteNetwork = useDeleteLogsMutation("network")
  const deleteEmbedding = useDeleteLogsMutation("embedding")
  const [activeLogTab, setActiveLogTab] = useState<LogTab>("publish")
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

  const deleteMutations: Record<
    LogTab,
    ReturnType<typeof useDeleteLogsMutation>
  > = {
    publish: deletePublish,
    sync: deleteSync,
    llm: deleteLlm,
    network: deleteNetwork,
    embedding: deleteEmbedding,
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
    // No reload: the mutation invalidates, and these queries are enabled, so
    // react-query refetches on its own.
    //
    // The catch is not defensive padding. `useDeleteLogsMutation` says these
    // "**do** throw: the operator asked for the deletion, so a failure has to
    // reach them" — and until ticket 19 nothing here caught, so the failure
    // reached a console as an unhandled rejection and the row simply stayed.
    // Sync and network logs are telemetry nobody owns, so their single-row
    // delete now answers 403 to a non-Admin, which is the first time this path
    // refuses anything an operator can trigger from the UI.
    try {
      await deleteMutations[tab].mutateAsync({ logId: id })
    } catch (e: unknown) {
      toast.error(
        `Could not delete that ${LOG_TAB_META[tab].noun} log: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
      return
    }
    toast.success(`${LOG_TAB_META[tab].label} log entry deleted.`)
  }

  const handleClearLogs = () => {
    setClearLogsConfirmOpen(true)
  }

  const confirmClearLogs = async () => {
    const { noun } = LOG_TAB_META[activeLogTab]
    setClearLogsConfirmOpen(false)
    // Same reasoning as `handleDelete`. This branch has demanded `DATA_ADMIN`
    // since ticket 18, so it has been able to refuse a non-Admin for longer,
    // and silently.
    try {
      await deleteMutations[activeLogTab].mutateAsync({ clearAll: true })
    } catch (e: unknown) {
      toast.error(
        `Could not clear the ${noun} logs: ${
          e instanceof Error ? e.message : String(e)
        }`,
      )
      return
    }
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
