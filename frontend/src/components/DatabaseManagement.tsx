import * as JSZip from "jszip"
import {
  Activity,
  AlertCircle,
  Database,
  Download,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  Upload,
} from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { useData } from "../contexts/DataContext"
import { useSettings } from "../contexts/SettingsContext"
import {
  clearTable,
  exportDBMetadata,
  getTableSizes,
  runQuery,
} from "../lib/cache"
import {
  buildTimestampedFilename,
  downloadBlob,
  pickSaveFile,
} from "../lib/data-transfer/download"
import { importIndexedDBToServer } from "../lib/repository"
import { RelativeTime } from "./RelativeTime"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

console.log("JSZip loaded:", JSZip)

export const DatabaseManagement: React.FC = () => {
  const { dbStats, loadDBStats, loadChannels, loadHistory } = useData()
  const {
    postRetentionDays,
    setPostRetentionDays,
    logRetentionDays,
    setLogRetentionDays,
  } = useSettings()

  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [isMigratingToServer, setIsMigratingToServer] = useState(false)
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean
    title: string
    message: string
    onConfirm: () => void
  } | null>(null)

  const [tableSizes, setTableSizes] = useState<
    { name: string; size: number; count: number }[] | null
  >(() => {
    const cached = localStorage.getItem("tableSizesCache")
    if (cached) {
      try {
        return JSON.parse(cached)
      } catch (_e) {
        return null
      }
    }
    return null
  })
  const [tableSizesLastCalculated, setTableSizesLastCalculated] = useState<
    number | null
  >(() => {
    const cached = localStorage.getItem("tableSizesLastCalculated")
    return cached ? parseInt(cached, 10) : null
  })
  const [selectedTablesForExport, setSelectedTablesForExport] = useState<
    Set<string>
  >(() => {
    const cached = localStorage.getItem("tableSizesCache")
    if (cached) {
      try {
        const sizes = JSON.parse(cached)
        return new Set(sizes.map((s: any) => s.name))
      } catch (_e) {
        return new Set()
      }
    }
    return new Set()
  })
  const [isCalculatingSizes, setIsCalculatingSizes] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string>("")
  const [query, setQuery] = useState<string>("")
  const [queryResults, setQueryResults] = useState<any[] | null>(null)
  const [isQuerying, setIsQuerying] = useState(false)
  const [queryError, setQueryError] = useState<string | null>(null)

  const handleCalculateSizes = async () => {
    setIsCalculatingSizes(true)
    try {
      const sizes = await getTableSizes()
      setTableSizes(sizes)
      setSelectedTablesForExport(new Set(sizes.map((s) => s.name)))
      const now = Date.now()
      setTableSizesLastCalculated(now)
      localStorage.setItem("tableSizesCache", JSON.stringify(sizes))
      localStorage.setItem("tableSizesLastCalculated", now.toString())
      if (sizes.length > 0 && !selectedTable) {
        setSelectedTable(sizes[0].name)
      }
    } catch (err) {
      console.error("Failed to calculate sizes:", err)
      toast.error("Failed to calculate table sizes")
    } finally {
      setIsCalculatingSizes(false)
    }
  }

  const handleRunQuery = async () => {
    if (!selectedTable) return
    setIsQuerying(true)
    setQueryError(null)
    try {
      const results = await runQuery(selectedTable, query)
      setQueryResults(results)
    } catch (err: any) {
      console.error("Query failed:", err)
      setQueryError(err.message)
      setQueryResults(null)
    } finally {
      setIsQuerying(false)
    }
  }

  const handleRefreshStats = async () => {
    await loadDBStats()
  }

  const handleMigrateToServer = () => {
    setConfirmModal({
      isOpen: true,
      title: "Migrate to Server",
      message:
        "This will export all IndexedDB data and upload it to the PostgreSQL backend. " +
        "Existing server data for matching records will be updated. Continue?",
      onConfirm: async () => {
        setConfirmModal(null)
        setIsMigratingToServer(true)
        try {
          const imported = await importIndexedDBToServer()
          const summary = Object.entries(imported)
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ")
          toast.success(
            `Server migration complete (${summary || "no records"})`,
          )
          await loadDBStats()
          await loadChannels()
          await loadHistory()
        } catch (err: unknown) {
          console.error("Server migration failed:", err)
          toast.error(
            `Server migration failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        } finally {
          setIsMigratingToServer(false)
        }
      },
    })
  }

  const handleExportDB = async () => {
    try {
      let fileHandle: FileSystemFileHandle | undefined
      let useOPFS = false
      try {
        const saveResult = await pickSaveFile(
          buildTimestampedFilename("telegram-summarizer-db"),
        )
        fileHandle = saveResult.fileHandle
        useOPFS = saveResult.useBlobFallback
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") return
        useOPFS = true
      }

      setIsExporting(true)
      const metadata = await exportDBMetadata()

      const worker = new Worker(
        new URL("../workers/dbWorker.ts", import.meta.url),
        { type: "module" },
      )

      worker.onmessage = (e) => {
        if (e.data.type === "PROGRESS") {
          toast.info(e.data.message, { id: "export-progress" })
        } else if (e.data.type === "SUCCESS") {
          if (e.data.file) {
            downloadBlob(
              e.data.file,
              buildTimestampedFilename("telegram-summarizer-db"),
            )
          }
          toast.success("Database exported successfully", {
            id: "export-progress",
          })
          setIsExporting(false)
          worker.terminate()
        } else if (e.data.type === "ERROR") {
          toast.error(`Export failed: ${e.data.error}`, {
            id: "export-progress",
          })
          setIsExporting(false)
          worker.terminate()
        }
      }

      worker.postMessage({
        type: "EXPORT",
        fileHandle,
        useOPFS,
        metadata,
        selectedTables: Array.from(selectedTablesForExport),
      })
    } catch (err: any) {
      console.error("Export error:", err)
      toast.error("Failed to start export")
      setIsExporting(false)
    }
  }

  const handleImportDB = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      setIsImporting(true)

      const worker = new Worker(
        new URL("../workers/dbWorker.ts", import.meta.url),
        { type: "module" },
      )

      worker.onmessage = async (e) => {
        if (e.data.type === "PROGRESS") {
          toast.info(e.data.message, { id: "import-progress" })
        } else if (e.data.type === "METADATA") {
          const meta = e.data.data
          if (meta?.localStorage) {
            localStorage.clear()
            for (const [key, value] of Object.entries(meta.localStorage)) {
              localStorage.setItem(key, value as string)
            }
          }
        } else if (e.data.type === "SUCCESS") {
          toast.success(e.data.message, { id: "import-progress" })
          setIsImporting(false)
          worker.terminate()
          setTimeout(() => {
            window.location.reload()
          }, 1500)
        } else if (e.data.type === "ERROR") {
          toast.error(`Import failed: ${e.data.error}`, {
            id: "import-progress",
          })
          setIsImporting(false)
          worker.terminate()
        }
      }

      worker.postMessage({ type: "IMPORT", file, clear: true })
    } catch (err: any) {
      console.error("Import error:", err)
      toast.error("Failed to start import")
      setIsImporting(false)
    }
  }

  const handleClearTable = (tableName: string) => {
    setConfirmModal({
      isOpen: true,
      title: `Clear Table: ${tableName}`,
      message: `Are you sure you want to delete all entries from the ${tableName} table? This cannot be undone.`,
      onConfirm: async () => {
        try {
          await clearTable(tableName)
          await loadDBStats()
          await handleCalculateSizes()
          setConfirmModal(null)
          toast.success(`Table ${tableName} cleared successfully`)
        } catch (err) {
          console.error(`Failed to clear table ${tableName}:`, err)
          toast.error(`Failed to clear table ${tableName}`)
        }
      },
    })
  }

  return (
    <motion.div
      key="db"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8"
    >
      <div className="bg-app-card p-8 border border-app-ink/10 shadow-sm">
        <div className="flex justify-between items-center mb-6">
          <div className="text-left">
            <h3 className="text-sm uppercase font-bold tracking-widest flex items-center gap-2">
              <Database size={14} className="opacity-40" /> Database Management
            </h3>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Monitor storage usage and manage your local data.
            </p>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleRefreshStats}
                className="p-2 hover:bg-app-ink/5 rounded-full transition-colors opacity-60 hover:opacity-100"
              >
                <RefreshCw size={14} />
              </button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Refresh Stats</p>
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <Database size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Records
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Total Posts
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {dbStats?.postCount?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Channels
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {dbStats?.channelCount?.toLocaleString() || 0}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Summaries
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {dbStats?.summaryCount?.toLocaleString() || 0}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <HardDrive size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Storage
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Used
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {dbStats?.storageEstimate?.usage
                      ? `${(dbStats.storageEstimate.usage / (1024 * 1024)).toFixed(2)} MB`
                      : "Unknown"}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Quota
                  </span>
                  <span className="font-mono font-bold text-[12px]">
                    {dbStats?.storageEstimate?.quota
                      ? `${(dbStats.storageEstimate.quota / (1024 * 1024 * 1024)).toFixed(2)} GB`
                      : "Unknown"}
                  </span>
                </div>
                {dbStats?.storageEstimate?.usage &&
                  dbStats?.storageEstimate?.quota && (
                    <div className="w-full h-1.5 bg-app-ink/5 rounded-full overflow-hidden mt-3">
                      <div
                        className="h-full bg-app-ink/40"
                        style={{
                          width: `${(dbStats.storageEstimate.usage / dbStats.storageEstimate.quota) * 100}%`,
                        }}
                      />
                    </div>
                  )}
              </div>
            </div>
          </div>

          <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
            <div>
              <div className="flex items-center gap-3 mb-6 opacity-40">
                <AlertCircle size={16} />
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Info
                </h4>
              </div>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    DB Name
                  </span>
                  <span
                    className="font-mono font-bold text-[10px] truncate max-w-[100px]"
                    title="TelegramSummarizerDB"
                  >
                    TelegramSummarizerDB
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Version
                  </span>
                  <span className="font-mono font-bold text-[12px]">2</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[10px] uppercase opacity-50 tracking-widest">
                    Persistence
                  </span>
                  <span className="font-mono font-bold text-[10px]">
                    Persistent
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Server Migration */}
        <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mb-8">
          <div className="flex items-center gap-3 mb-4">
            <Upload size={18} className="opacity-40" />
            <h4 className="text-[11px] uppercase font-bold tracking-widest">
              Server Migration
            </h4>
          </div>
          <p className="text-[10px] opacity-50 italic serif mb-4">
            One-time migration: upload your local IndexedDB data to the
            PostgreSQL backend. Run this after logging in when moving from
            browser-only to the FastAPI stack.
          </p>
          <button
            type="button"
            onClick={handleMigrateToServer}
            disabled={isMigratingToServer}
            className="px-4 py-2 text-[10px] uppercase font-bold flex items-center gap-2 border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-colors disabled:opacity-50"
          >
            {isMigratingToServer ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Upload size={14} />
            )}
            Migrate IndexedDB to Server
          </button>
        </div>

        {/* Data Retention */}
        <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mb-8">
          <div className="flex items-center gap-3 mb-6">
            <Database size={18} className="opacity-40" />
            <h4 className="text-[11px] uppercase font-bold tracking-widest">
              Data Retention
            </h4>
          </div>

          <div className="space-y-6">
            <div className="space-y-4">
              <div className="flex items-center gap-2 opacity-60">
                <Database size={14} />
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Post Retention
                </span>
              </div>
              <select
                value={postRetentionDays}
                onChange={(e) =>
                  setPostRetentionDays(parseInt(e.target.value, 10))
                }
                className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
              >
                <option value={0}>Never Delete (Keep Forever)</option>
                <option value={7}>Auto-delete older than 7 days</option>
                <option value={14}>Auto-delete older than 14 days</option>
                <option value={30}>Auto-delete older than 30 days</option>
                <option value={90}>Auto-delete older than 90 days</option>
              </select>
              <p className="text-[10px] opacity-40 italic serif">
                Automatically delete posts older than the selected timeframe.
                Summaries and chat history are always preserved.
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center gap-2 opacity-60">
                <Activity size={14} />
                <span className="text-[10px] font-bold uppercase tracking-tight">
                  Log Retention
                </span>
              </div>
              <select
                value={logRetentionDays}
                onChange={(e) =>
                  setLogRetentionDays(parseInt(e.target.value, 10))
                }
                className="w-full bg-app-bg border border-app-ink/20 p-2 text-[11px] font-mono focus:border-app-ink focus:outline-none transition-colors"
              >
                <option value={0}>Never Delete (Keep Forever)</option>
                <option value={7}>Auto-delete older than 7 days</option>
                <option value={14}>Auto-delete older than 14 days</option>
                <option value={30}>Auto-delete older than 30 days</option>
                <option value={90}>Auto-delete older than 90 days</option>
              </select>
              <p className="text-[10px] opacity-40 italic serif">
                Automatically delete system logs (sync, network, AI) older than
                the selected timeframe.
              </p>
            </div>
          </div>
        </div>

        {/* Table Sizes & Queries */}
        <div className="bg-app-card border border-app-ink/10 p-6 shadow-sm mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Search size={18} className="opacity-40" />
              <div className="flex flex-col">
                <h4 className="text-[11px] uppercase font-bold tracking-widest">
                  Table Sizes & Queries
                </h4>
                {tableSizesLastCalculated && (
                  <span className="text-[9px] opacity-50 italic serif mt-0.5">
                    Last calculated:{" "}
                    <RelativeTime timestamp={tableSizesLastCalculated} />
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={handleExportDB}
                    disabled={isExporting || selectedTablesForExport.size === 0}
                    className="px-4 py-2 text-[10px] uppercase font-bold flex items-center gap-2 border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-colors disabled:opacity-50"
                  >
                    {isExporting ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Download size={14} />
                    )}
                    Export
                  </button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="text-[9px] uppercase font-bold">
                    Export selected tables as JSONL
                  </p>
                </TooltipContent>
              </Tooltip>
              <div className="relative">
                <input
                  type="file"
                  accept=".jsonl"
                  onChange={handleImportDB}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={isImporting}
                />
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      disabled={isImporting}
                      className="px-4 py-2 text-[10px] uppercase font-bold flex items-center gap-2 border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-colors disabled:opacity-50"
                    >
                      {isImporting ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Upload size={14} />
                      )}
                      Import
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-[9px] uppercase font-bold">
                      Import database from JSONL
                    </p>
                  </TooltipContent>
                </Tooltip>
              </div>
              <button
                type="button"
                onClick={handleCalculateSizes}
                disabled={isCalculatingSizes}
                className="px-4 py-2 text-[10px] uppercase font-bold flex items-center gap-2 border border-app-ink/20 hover:bg-app-ink hover:text-app-bg transition-colors disabled:opacity-50"
              >
                {isCalculatingSizes ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <HardDrive size={14} />
                )}
                Calculate Sizes
              </button>
            </div>
          </div>

          {tableSizes && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {tableSizes.map((table) => (
                  <div
                    key={table.name}
                    className={`p-4 border transition-colors cursor-pointer group relative ${selectedTable === table.name ? "border-app-ink bg-app-ink/5" : "border-app-ink/10 hover:border-app-ink/30"}`}
                    onClick={() => setSelectedTable(table.name)}
                  >
                    <div className="flex justify-between items-center mb-2">
                      <div className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selectedTablesForExport.has(table.name)}
                          onChange={(e) => {
                            e.stopPropagation()
                            const newSet = new Set(selectedTablesForExport)
                            if (e.target.checked) {
                              newSet.add(table.name)
                            } else {
                              newSet.delete(table.name)
                            }
                            setSelectedTablesForExport(newSet)
                          }}
                          className="w-3 h-3 accent-app-ink"
                        />
                        <span className="text-[11px] font-bold uppercase tracking-widest">
                          {table.name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono opacity-60">
                        {table.count.toLocaleString()} records
                      </span>
                    </div>
                    <div className="flex justify-between items-center">
                      <div className="text-[12px] font-mono font-bold">
                        {(table.size / (1024 * 1024)).toFixed(2)} MB
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleClearTable(table.name)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1.5 text-red-500 hover:bg-red-500/10 rounded transition-all"
                        title={`Clear all entries in ${table.name}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {selectedTable && (
                <div className="border border-app-ink/10 p-4 bg-app-muted/30">
                  <h5 className="text-[10px] uppercase font-bold tracking-widest mb-3 flex items-center gap-2">
                    Query <span className="text-blue-500">{selectedTable}</span>
                  </h5>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="e.g. channelName === 'mychannel' (leave empty for all)"
                      className="flex-1 bg-app-card border border-app-ink/20 px-3 py-2 text-[11px] font-mono focus:outline-none focus:border-app-ink/50"
                      onKeyDown={(e) => e.key === "Enter" && handleRunQuery()}
                    />
                    <button
                      type="button"
                      onClick={handleRunQuery}
                      disabled={isQuerying}
                      className="px-4 py-2 bg-app-ink text-app-bg text-[10px] uppercase font-bold flex items-center gap-2 disabled:opacity-50"
                    >
                      {isQuerying ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Play size={14} />
                      )}
                      Run
                    </button>
                  </div>
                  <p className="text-[9px] opacity-50 italic mb-4">
                    Uses simple JS evaluation. Example:{" "}
                    <code className="bg-app-ink/10 px-1 py-0.5 rounded">
                      id &gt; 100
                    </code>{" "}
                    or{" "}
                    <code className="bg-app-ink/10 px-1 py-0.5 rounded">
                      text.includes('crypto')
                    </code>
                  </p>

                  {queryError && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 text-[11px] font-mono mb-4">
                      {queryError}
                    </div>
                  )}

                  {queryResults && (
                    <div className="border border-app-ink/10 bg-app-card overflow-hidden">
                      <div className="p-2 bg-app-ink/5 border-b border-app-ink/10 flex justify-between items-center">
                        <span className="text-[10px] font-bold uppercase tracking-widest">
                          Results ({queryResults.length}
                          {queryResults.length === 100 ? "+" : ""})
                        </span>
                      </div>
                      <div className="max-h-96 overflow-auto p-4 text-[11px] font-mono whitespace-pre-wrap">
                        {queryResults.length > 0 ? (
                          JSON.stringify(queryResults, null, 2)
                        ) : (
                          <span className="opacity-50 italic">
                            No results found.
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="p-6 bg-app-ink/5 border border-app-ink/10">
        <h3 className="text-[11px] uppercase font-bold tracking-widest mb-3">
          About Local Storage
        </h3>
        <p className="text-[11px] opacity-60 leading-relaxed font-serif">
          This application uses your browser's IndexedDB to store all channel
          data and posts locally. No data is sent to our servers except for the
          content you explicitly send to AI models for analysis. Exporting your
          database regularly is recommended to prevent data loss if you clear
          your browser cache.
        </p>
      </div>

      <Dialog
        open={Boolean(confirmModal?.isOpen)}
        onOpenChange={(open) => {
          if (!open) setConfirmModal(null)
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card text-app-ink sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{confirmModal?.title}</DialogTitle>
            <DialogDescription className="text-app-ink/80">
              {confirmModal?.message}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setConfirmModal(null)}
              className="rounded-md border border-app-ink/20 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-app-muted/30"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                confirmModal?.onConfirm()
              }}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-red-600 hover:bg-red-500/20"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  )
}
