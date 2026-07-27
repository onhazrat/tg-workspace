import {
  Archive,
  ChevronDown,
  Clock,
  Filter,
  MessageSquare,
  RefreshCw,
  Search,
  Send,
  Star,
  StickyNote,
  Trash2,
  X,
} from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useEffect, useMemo, useRef, useState } from "react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
import { TgMetaChip } from "@/components/ui/tg-chips"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgHeroEmptyState } from "@/components/ui/tg-segmented"
import { formatSummaryModelLabel, isPendingSummary } from "../constants"
import { useData } from "../contexts/DataContext"
import { useUI } from "../contexts/UIContext"
import { useSummarySearchQuery } from "../hooks/useSummaries"
import { markdownPreview } from "../lib/markdown"
import { deleteSummary, saveSummary } from "../lib/repository"
import { formatDateToLocalISO } from "../lib/utils"
import type { SummaryListItem, TabType } from "../types"
import { RelativeTime } from "./RelativeTime"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

const EMPTY_SUMMARIES: SummaryListItem[] = []

const formatDuration = (start: number, end: number) => {
  const diffMs = Math.max(0, end - start)
  const diffMins = Math.floor(diffMs / (1000 * 60))
  const days = Math.floor(diffMins / (60 * 24))
  const hours = Math.floor((diffMins % (60 * 24)) / 60)
  const mins = diffMins % 60

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (mins > 0 || parts.length === 0) parts.push(`${mins}m`)

  return parts.join(" ")
}

const formatDateTime = (timestamp: number) => {
  if (!timestamp) return "Unknown"
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return "Unknown"
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

interface HistoryViewProps {
  handleSelectHistorySummary: (s: SummaryListItem) => void
  setActiveTab: (tab: TabType) => void
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  handleSelectHistorySummary,
  setActiveTab,
}) => {
  const { botCredentials, chatDestinations, loadHistory, summariesHistory } =
    useData()
  const {
    historySearchQuery,
    setHistorySearchQuery,
    starredOnly,
    setStarredOnly,
  } = useUI()

  const [regeneratingSummaries, _setRegeneratingSummaries] = useState<
    Set<string>
  >(new Set())
  const [historyFilter, setHistoryFilter] = useState<
    "all" | "summary" | "chat"
  >("all")
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false)
  const [modelFilter, setModelFilter] = useState<string>("all")
  const [languageFilter, setLanguageFilter] = useState<string>("all")
  const [startDateFilter, setStartDateFilter] = useState<number | null>(null)
  const [endDateFilter, setEndDateFilter] = useState<number | null>(null)
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null)
  const [noteValue, setNoteValue] = useState<string>("")
  const [visibleHistory, setVisibleHistory] = useState(20)
  const [summaryPendingDelete, setSummaryPendingDelete] =
    useState<SummaryListItem | null>(null)
  const observerTarget = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setVisibleHistory(20)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleHistory((prev) => prev + 20)
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
  }, [])

  const uniqueModels = useMemo(() => {
    const models = new Set<string>()
    summariesHistory.forEach((s) => {
      if (s.model) models.add(s.model)
    })
    return Array.from(models)
  }, [summariesHistory])

  const uniqueLanguages = useMemo(() => {
    const langs = new Set<string>()
    summariesHistory.forEach((s) => {
      if (s.language) langs.add(s.language)
    })
    return Array.from(langs)
  }, [summariesHistory])

  // Text search runs server-side: `promptText` is matched in SQL and is no
  // longer shipped to the client. The facet filters below still narrow the
  // returned rows locally.
  const { data: searchMatches } = useSummarySearchQuery(historySearchQuery)
  const textMatches = historySearchQuery.trim()
    ? (searchMatches ?? EMPTY_SUMMARIES)
    : summariesHistory

  const filteredHistory = useMemo(() => {
    return textMatches.filter((s) => {
      // Type filter
      if (historyFilter !== "all") {
        const hasChat = s.chatMessageCount > 0
        if (historyFilter === "chat" && !hasChat) return false
        if (historyFilter === "summary" && hasChat) return false
      }

      // Search query handled by useSummarySearchQuery above

      // Model filter
      if (modelFilter !== "all" && s.model !== modelFilter) return false

      // Language filter
      if (languageFilter !== "all" && s.language !== languageFilter)
        return false

      // Starred filter
      if (starredOnly && !s.isStarred) return false

      // Date range filter
      if (startDateFilter !== null) {
        if (s.timestamp < startDateFilter) return false
      }
      if (endDateFilter !== null) {
        if (s.timestamp > endDateFilter) return false
      }

      return true
    })
  }, [
    textMatches,
    historyFilter,
    modelFilter,
    languageFilter,
    startDateFilter,
    endDateFilter,
    starredOnly,
  ])

  const handleDeleteSummary = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const summary = summariesHistory.find((entry) => entry.id === id)
    if (!summary) return
    setSummaryPendingDelete(summary)
  }

  const confirmDeleteSummary = async () => {
    if (!summaryPendingDelete) return
    await deleteSummary(summaryPendingDelete.id)
    await loadHistory()
    setSummaryPendingDelete(null)
    toast.success("Summary deleted.")
  }

  const closeDeleteSummaryDialog = () => {
    setSummaryPendingDelete(null)
  }

  const handleToggleAutoRegenerate = async (
    s: SummaryListItem,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation()

    if (!s.autoRegenerate) {
      const durationMs = s.endDate - s.startDate
      if (durationMs < 60 * 1000) {
        toast.error(
          "Cannot auto-regenerate a summary with a duration of less than 1 minute.",
        )
        return
      }
    }

    const updatedSummary = { ...s, autoRegenerate: !s.autoRegenerate }
    await saveSummary(updatedSummary)
    await loadHistory()
  }

  const handleToggleAutoPublish = async (
    s: SummaryListItem,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation()
    const updatedSummary = { ...s, autoPublish: !s.autoPublish }
    await saveSummary(updatedSummary)
    await loadHistory()
  }

  const handleUpdatePublishConfig = async (
    s: SummaryListItem,
    botId: string,
    destId: string,
  ) => {
    const updatedSummary = { ...s, publishBotId: botId, publishChatId: destId }
    await saveSummary(updatedSummary)
    await loadHistory()
  }

  const handleToggleStar = async (s: SummaryListItem, e: React.MouseEvent) => {
    e.stopPropagation()
    const updatedSummary = { ...s, isStarred: !s.isStarred }
    await saveSummary(updatedSummary)
    await loadHistory()
    if (updatedSummary.isStarred) {
      toast.success("Item starred.")
    } else {
      toast.info("Item unstarred.")
    }
  }

  const setQuickHistoryRange = (hours: number) => {
    const end = Date.now()
    const start = end - hours * 60 * 60 * 1000
    setStartDateFilter(start)
    setEndDateFilter(end)
  }

  const handleSaveNote = async (s: SummaryListItem) => {
    const updatedSummary = { ...s, note: noteValue }
    await saveSummary(updatedSummary)
    await loadHistory()
    setEditingNoteId(null)
    setNoteValue("")
    toast.success("Note saved.")
  }

  const handleDeleteNote = async (s: SummaryListItem) => {
    const updatedSummary = { ...s, note: undefined }
    await saveSummary(updatedSummary)
    await loadHistory()
    setEditingNoteId(null)
    setNoteValue("")
    toast.success("Note deleted.")
  }

  return (
    <motion.div
      key="history"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-10"
    >
      {/* Header & Controls */}
      <div className="flex flex-col gap-4 mb-6">
        {/* Top Toolbar */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-app-card border border-app-ink/10 p-3 rounded-xl shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-app-muted flex items-center justify-center border border-app-ink/10">
              <Archive size={16} className="opacity-60" />
            </div>
            <div>
              <h3 className="text-xs uppercase font-bold tracking-widest leading-none">
                Analysis History
              </h3>
              <p className="text-[11px] font-mono text-app-ink/70 mt-1">
                {filteredHistory.length} Records Found
              </p>
            </div>
          </div>

          <div className="flex items-center bg-app-muted rounded-lg p-1 border border-app-ink/10">
            <button
              type="button"
              onClick={() => setStarredOnly(!starredOnly)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-tight transition-all ${
                starredOnly
                  ? "bg-amber-500 text-white shadow-sm"
                  : "text-app-ink/70 hover:text-app-ink hover:bg-app-ink/5"
              }`}
            >
              <Star size={12} className={starredOnly ? "fill-white" : ""} />
              Starred
            </button>
            <div className="w-px h-4 bg-app-ink/10 mx-1" />
            {(["all", "summary", "chat"] as const).map((f) => (
              <button
                type="button"
                key={f}
                onClick={() => setHistoryFilter(f)}
                className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-tight transition-all ${
                  historyFilter === f
                    ? "bg-app-card text-app-ink shadow-sm"
                    : "text-app-ink/70 hover:text-app-ink hover:bg-app-ink/5"
                }`}
              >
                {f === "all" ? "All" : f === "summary" ? "Summaries" : "Chats"}
              </button>
            ))}
          </div>
        </div>

        {/* Search & Advanced Filters Toggle */}
        <div className="flex gap-3">
          <div className="relative flex-1 group">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40 group-focus-within:opacity-100 group-focus-within:text-blue-500 transition-colors"
            />
            <input
              type="text"
              placeholder="Search channels, content, or models..."
              value={historySearchQuery}
              onChange={(e) => setHistorySearchQuery(e.target.value)}
              className="w-full bg-app-card border border-app-ink/10 rounded-xl py-2.5 pl-10 pr-10 text-[13px] focus:outline-none focus:border-app-ink/30 focus:ring-4 focus:ring-app-ink/5 transition-all shadow-sm"
            />
            {historySearchQuery && (
              <TgIconButton
                variant="ghost"
                aria-label="Clear search"
                onClick={() => setHistorySearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 opacity-40 hover:opacity-100 p-1"
              >
                <X size={14} />
              </TgIconButton>
            )}
          </div>
          <TgButton
            type="button"
            variant={
              showAdvancedFilters ||
              modelFilter !== "all" ||
              languageFilter !== "all" ||
              startDateFilter !== null ||
              endDateFilter !== null
                ? "primary"
                : "secondary"
            }
            size="md"
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
            className="px-4 rounded-xl"
          >
            <Filter size={14} />
            <span>Filters</span>
            <ChevronDown
              size={14}
              className={`transition-transform duration-300 ${showAdvancedFilters ? "rotate-180" : ""}`}
            />
          </TgButton>
        </div>

        {/* Advanced Filters Panel */}
        <AnimatePresence>
          {showAdvancedFilters && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-5 bg-app-card border border-app-ink/10 rounded-xl shadow-sm mt-1">
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    Model
                  </label>
                  <select
                    value={modelFilter}
                    onChange={(e) => setModelFilter(e.target.value)}
                    className="w-full bg-app-muted border border-app-ink/10 rounded-lg py-2 px-3 text-[11px] font-mono focus:outline-none focus:border-app-ink/30 transition-colors"
                  >
                    <option value="all">All Models</option>
                    {uniqueModels.map((m) => (
                      <option key={m} value={m}>
                        {formatSummaryModelLabel(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    Language
                  </label>
                  <select
                    value={languageFilter}
                    onChange={(e) => setLanguageFilter(e.target.value)}
                    className="w-full bg-app-muted border border-app-ink/10 rounded-lg py-2 px-3 text-[11px] font-mono focus:outline-none focus:border-app-ink/30 transition-colors"
                  >
                    <option value="all">All Languages</option>
                    {uniqueLanguages.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    From Date
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      startDateFilter && !Number.isNaN(startDateFilter)
                        ? formatDateToLocalISO(new Date(startDateFilter))
                        : ""
                    }
                    max={formatDateToLocalISO(new Date())}
                    onChange={(e) => {
                      if (e.target.value) {
                        const time = new Date(e.target.value).getTime()
                        setStartDateFilter(Number.isNaN(time) ? null : time)
                      } else {
                        setStartDateFilter(null)
                      }
                    }}
                    className="w-full bg-app-muted border border-app-ink/10 rounded-lg py-2 px-3 text-[11px] font-mono focus:outline-none focus:border-app-ink/30 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                    To Date
                  </label>
                  <input
                    type="datetime-local"
                    value={
                      endDateFilter && !Number.isNaN(endDateFilter)
                        ? formatDateToLocalISO(new Date(endDateFilter))
                        : ""
                    }
                    max={formatDateToLocalISO(new Date())}
                    onChange={(e) => {
                      if (e.target.value) {
                        const time = new Date(e.target.value).getTime()
                        setEndDateFilter(Number.isNaN(time) ? null : time)
                      } else {
                        setEndDateFilter(null)
                      }
                    }}
                    className="w-full bg-app-muted border border-app-ink/10 rounded-lg py-2 px-3 text-[11px] font-mono focus:outline-none focus:border-app-ink/30 transition-colors"
                  />
                </div>
                <div className="col-span-1 sm:col-span-2 lg:col-span-4 space-y-3 pt-2 border-t border-app-ink/5 mt-2">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <label className="text-[11px] uppercase font-bold text-app-ink/70 tracking-widest">
                        Quick Presets:
                      </label>
                      <div className="flex flex-wrap gap-2">
                        {[
                          { label: "1h", hours: 1 },
                          { label: "6h", hours: 6 },
                          { label: "24h", hours: 24 },
                          { label: "3d", hours: 72 },
                          { label: "7d", hours: 168 },
                          { label: "30d", hours: 720 },
                        ].map((range) => (
                          <button
                            type="button"
                            key={range.label}
                            onClick={() => setQuickHistoryRange(range.hours)}
                            className="text-[11px] uppercase font-bold px-2.5 py-1 rounded-md bg-app-muted border border-app-ink/10 hover:border-app-ink/30 hover:bg-app-ink hover:text-app-bg transition-all"
                          >
                            {range.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    {(modelFilter !== "all" ||
                      languageFilter !== "all" ||
                      startDateFilter !== null ||
                      endDateFilter !== null) && (
                      <TgButton
                        type="button"
                        variant="dangerSoft"
                        size="sm"
                        onClick={() => {
                          setModelFilter("all")
                          setLanguageFilter("all")
                          setStartDateFilter(null)
                          setEndDateFilter(null)
                        }}
                      >
                        Clear Filters
                      </TgButton>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* History List */}
      {filteredHistory.length === 0 ? (
        <TgHeroEmptyState
          className="h-full max-w-md mx-auto"
          icon={<Clock size={28} className="opacity-40" />}
          title={
            summariesHistory.length === 0
              ? "No History Found"
              : "No Matching Items"
          }
          description={
            summariesHistory.length === 0
              ? "Your generated summaries and chat sessions will appear here."
              : "Try adjusting your search query or clearing the advanced filters."
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {filteredHistory.slice(0, visibleHistory).map((s) => (
            <div
              key={s.id}
              data-history-summary-id={s.id}
              onClick={() => handleSelectHistorySummary(s)}
              className={`bg-app-card border rounded-xl p-5 shadow-sm hover:shadow-md transition-all cursor-pointer group relative flex flex-col gap-3 ${
                isPendingSummary(s)
                  ? "border-amber-500/30 hover:border-amber-500/50 bg-amber-500/[0.03]"
                  : "border-app-ink/10 hover:border-app-ink/20"
              }`}
            >
              {/* Card Header */}
              <div className="flex justify-between items-start gap-4">
                <div className="flex flex-col gap-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <h4 className="text-sm font-bold uppercase tracking-tight truncate">
                      {s.channels.join(", ")}
                    </h4>
                    <div className="flex gap-1 shrink-0">
                      {isPendingSummary(s) && (
                        <span className="px-2 py-0.5 rounded-md text-[11px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-800 dark:text-amber-200">
                          Awaiting response
                        </span>
                      )}
                      {s.autoRegenerate && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Auto-Regenerate Active</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {s.autoPublish && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>Auto-Publish Active</p>
                          </TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono text-app-ink/70">
                    <Clock size={10} /> <RelativeTime timestamp={s.timestamp} />
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity bg-app-card/80 backdrop-blur-sm p-1 rounded-lg border border-app-ink/5 shadow-sm">
                  <TgIconButton
                    aria-label={s.isStarred ? "Unstar Item" : "Star Item"}
                    tooltip={s.isStarred ? "Unstar Item" : "Star Item"}
                    data-active={s.isStarred || undefined}
                    onClick={(e) => handleToggleStar(s, e)}
                    className={
                      s.isStarred ? "text-amber-500 bg-amber-500/10" : undefined
                    }
                  >
                    <Star
                      size={14}
                      className={s.isStarred ? "fill-amber-500" : ""}
                    />
                  </TgIconButton>
                  <TgIconButton
                    aria-label={
                      editingNoteId === s.id
                        ? "Close Note"
                        : s.note
                          ? "Edit Note"
                          : "Add Note"
                    }
                    tooltip={
                      editingNoteId === s.id
                        ? "Close Note"
                        : s.note
                          ? "Edit Note"
                          : "Add Note"
                    }
                    data-active={
                      s.note || editingNoteId === s.id ? true : undefined
                    }
                    onClick={(e) => {
                      e.stopPropagation()
                      if (editingNoteId === s.id) {
                        setEditingNoteId(null)
                      } else {
                        setEditingNoteId(s.id)
                        setNoteValue(s.note || "")
                      }
                    }}
                    className={
                      s.note || editingNoteId === s.id
                        ? "text-amber-600 bg-amber-500/10"
                        : undefined
                    }
                  >
                    <StickyNote
                      size={14}
                      className={
                        editingNoteId === s.id ? "fill-amber-500/20" : ""
                      }
                    />
                  </TgIconButton>
                  <div className="w-px h-4 bg-app-ink/10 mx-1" />
                  <TgIconButton
                    aria-label={
                      s.autoRegenerate
                        ? "Disable Auto-Regenerate"
                        : "Enable Auto-Regenerate"
                    }
                    tooltip={
                      s.autoRegenerate
                        ? "Disable Auto-Regenerate"
                        : "Enable Auto-Regenerate"
                    }
                    data-active={s.autoRegenerate || undefined}
                    onClick={(e) => handleToggleAutoRegenerate(s, e)}
                    disabled={isPendingSummary(s)}
                    className={
                      s.autoRegenerate
                        ? "text-green-600 bg-green-500/10"
                        : undefined
                    }
                  >
                    <RefreshCw
                      size={14}
                      className={
                        regeneratingSummaries.has(s.id) ? "animate-spin" : ""
                      }
                    />
                  </TgIconButton>
                  {s.autoRegenerate && (
                    <TgIconButton
                      aria-label={
                        s.autoPublish
                          ? "Disable Auto-Publish"
                          : "Enable Auto-Publish"
                      }
                      tooltip={
                        s.autoPublish
                          ? "Disable Auto-Publish"
                          : "Enable Auto-Publish"
                      }
                      data-active={s.autoPublish || undefined}
                      onClick={(e) => handleToggleAutoPublish(s, e)}
                      className={
                        s.autoPublish
                          ? "text-blue-600 bg-blue-500/10"
                          : undefined
                      }
                    >
                      <Send size={14} />
                    </TgIconButton>
                  )}
                  <div className="w-px h-4 bg-app-ink/10 mx-1" />
                  <TgIconButton
                    aria-label="Delete Summary"
                    tooltip="Delete Summary"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDeleteSummary(s.id, e)
                    }}
                    className="hover:text-red-500 hover:bg-red-500/10"
                  >
                    <Trash2 size={14} />
                  </TgIconButton>
                </div>
              </div>

              {/* Card Content (Snippet) */}
              {isPendingSummary(s) ? (
                <p className="text-[12px] text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                  Prompt copied — paste the external AI response to complete
                  this entry.
                </p>
              ) : (
                <p
                  className={`text-[12px] text-app-ink/80 line-clamp-2 leading-relaxed ${s.language === "Persian" ? "font-persian text-right" : ""}`}
                >
                  {markdownPreview(s.text)}
                </p>
              )}

              {/* Notes Section */}
              {editingNoteId === s.id ? (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl relative overflow-hidden"
                  onClick={(e) => e.stopPropagation()}
                >
                  <textarea
                    value={noteValue}
                    onChange={(e) => setNoteValue(e.target.value)}
                    onInput={(e) => {
                      const target = e.target as HTMLTextAreaElement
                      target.style.height = "auto"
                      target.style.height = `${target.scrollHeight}px`
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSaveNote(s)
                      } else if (e.key === "Escape") {
                        setEditingNoteId(null)
                      }
                    }}
                    placeholder="Jot down your thoughts... (Cmd+Enter to save)"
                    className="w-full bg-transparent border-none text-[13px] font-medium text-amber-900 placeholder:text-amber-900/40 focus:outline-none resize-none min-h-[60px] leading-relaxed custom-scrollbar"
                  />
                  <div className="flex justify-between items-center mt-3 pt-2 border-t border-amber-500/20">
                    <span className="text-[11px] text-amber-700/80 font-medium">
                      {noteValue.length} chars
                    </span>
                    <div className="flex gap-2 items-center">
                      {s.note && (
                        <TgButton
                          type="button"
                          variant="dangerSoft"
                          size="sm"
                          onClick={() => handleDeleteNote(s)}
                          className="border-0 bg-transparent hover:bg-red-500/10"
                        >
                          Delete
                        </TgButton>
                      )}
                      <TgButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingNoteId(null)}
                        className="text-amber-800/80 hover:text-amber-900 hover:bg-amber-500/10"
                      >
                        Cancel
                      </TgButton>
                      <TgButton
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => handleSaveNote(s)}
                        className="bg-amber-500 text-amber-950 hover:bg-amber-400 hover:opacity-100 shadow-sm"
                      >
                        Save Note
                      </TgButton>
                    </div>
                  </div>
                </motion.div>
              ) : (
                s.note && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="mt-2 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl cursor-pointer hover:bg-amber-500/10 transition-colors group/note relative"
                    onClick={(e) => {
                      e.stopPropagation()
                      setEditingNoteId(s.id)
                      setNoteValue(s.note || "")
                    }}
                  >
                    <div className="flex justify-between items-start mb-1.5">
                      <span className="font-bold uppercase text-[11px] tracking-wider text-amber-700/80 flex items-center gap-1.5">
                        <StickyNote size={12} className="text-amber-600/50" />
                        Note
                      </span>
                      <span className="opacity-0 group-hover/note:opacity-100 text-[11px] font-bold uppercase tracking-widest text-amber-700/80 transition-opacity">
                        Click to Edit
                      </span>
                    </div>
                    <p className="text-[12px] font-medium text-amber-900/90 whitespace-pre-wrap leading-relaxed">
                      {s.note}
                    </p>
                  </motion.div>
                )
              )}

              {/* Auto-Publish Config (If Active) */}
              {s.autoRegenerate && s.autoPublish && (
                <div
                  className="mt-1 flex flex-wrap items-center gap-2 bg-blue-500/5 border border-blue-500/10 p-2 rounded-lg"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[11px] uppercase font-bold text-blue-600/80 flex items-center gap-1.5">
                    <Send size={10} /> Publish Target:
                  </span>
                  <select
                    value={s.publishBotId || ""}
                    onChange={(e) =>
                      handleUpdatePublishConfig(
                        s,
                        e.target.value,
                        s.publishChatId || "",
                      )
                    }
                    className="bg-app-card border border-blue-500/20 rounded-md py-1 px-2 focus:outline-none focus:border-blue-500/50 transition-colors text-[11px] font-mono cursor-pointer text-blue-900 dark:text-blue-100"
                  >
                    <option value="">Select Bot</option>
                    {botCredentials.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={s.publishChatId || ""}
                    onChange={(e) =>
                      handleUpdatePublishConfig(
                        s,
                        s.publishBotId || "",
                        e.target.value,
                      )
                    }
                    className="bg-app-card border border-blue-500/20 rounded-md py-1 px-2 focus:outline-none focus:border-blue-500/50 transition-colors text-[11px] font-mono cursor-pointer text-blue-900 dark:text-blue-100"
                  >
                    <option value="">Select Dest</option>
                    {chatDestinations.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Card Footer (Metadata Badges) */}
              <div className="mt-2 pt-3 border-t border-app-ink/5 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap gap-2">
                  <TgMetaChip size="history">
                    <MessageSquare size={10} /> {s.postCount || 0} Posts
                  </TgMetaChip>
                  <TgMetaChip size="history">
                    {formatDuration(s.startDate, s.endDate)}
                  </TgMetaChip>
                  <TgMetaChip size="history">
                    {formatSummaryModelLabel(s.model)}
                  </TgMetaChip>
                  <TgMetaChip size="history">{s.language}</TgMetaChip>
                  <TgMetaChip size="history">
                    {formatDateTime(s.startDate)} - {formatDateTime(s.endDate)}
                  </TgMetaChip>
                </div>

                {s.chatMessageCount > 0 && (
                  <TgButton
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectHistorySummary(s)
                      setActiveTab("chat")
                    }}
                  >
                    <MessageSquare size={12} />
                    <span>{s.chatMessageCount} Messages</span>
                  </TgButton>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <TgConfirmDialog
        open={Boolean(summaryPendingDelete)}
        onOpenChange={(open) => {
          if (!open) closeDeleteSummaryDialog()
        }}
        title="Delete Summary"
        description="This removes the selected summary from your history permanently."
        variant="dangerSoft"
        confirmLabel="Delete"
        onConfirm={() => {
          void confirmDeleteSummary()
        }}
        onCancel={closeDeleteSummaryDialog}
      >
        {summaryPendingDelete ? (
          <div className="px-4 pt-4">
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-[11px] text-red-700 dark:text-red-300">
              {summaryPendingDelete.channels.join(", ") || "Summary entry"} ·{" "}
              {formatDateTime(summaryPendingDelete.timestamp)}
            </div>
          </div>
        ) : null}
      </TgConfirmDialog>

      {/* Intersection Observer Target */}
      <div ref={observerTarget} className="h-10 w-full" />
    </motion.div>
  )
}
