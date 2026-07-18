import { Database, RefreshCw } from "lucide-react"
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
import {
  type ClearTableConfirm,
  DangerPanel,
} from "./settings/data/DangerPanel"
import { QueryPanel } from "./settings/data/QueryPanel"
import { RetentionPanel } from "./settings/data/RetentionPanel"
import {
  DatabaseStatsCards,
  type TableSizeRow,
  TableSizesPanel,
} from "./settings/data/TableSizesPanel"
import {
  TransferExportImportActions,
  TransferPanel,
} from "./settings/data/TransferPanel"
import { SettingAnchor } from "./settings/SettingAnchor"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

export const DatabaseManagement: React.FC<{
  focus?: "data" | "retention" | "table-sizes" | "transfer" | "query" | "danger"
  highlightId?: string | null
}> = ({ focus = "data", highlightId = null }) => {
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
  const [confirmModal, setConfirmModal] = useState<ClearTableConfirm>(null)

  const [tableSizes, setTableSizes] = useState<TableSizeRow[] | null>(() => {
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
        return new Set(sizes.map((s: { name: string }) => s.name))
      } catch (_e) {
        return new Set()
      }
    }
    return new Set()
  })
  const [isCalculatingSizes, setIsCalculatingSizes] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string>("")
  const [query, setQuery] = useState<string>("")
  const [queryResults, setQueryResults] = useState<unknown[] | null>(null)
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
    } catch (err: unknown) {
      console.error("Query failed:", err)
      setQueryError(err instanceof Error ? err.message : String(err))
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
    } catch (err: unknown) {
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

      worker.onmessage = async (ev) => {
        if (ev.data.type === "PROGRESS") {
          toast.info(ev.data.message, { id: "import-progress" })
        } else if (ev.data.type === "METADATA") {
          const meta = ev.data.data
          if (meta?.localStorage) {
            localStorage.clear()
            for (const [key, value] of Object.entries(meta.localStorage)) {
              localStorage.setItem(key, value as string)
            }
          }
        } else if (ev.data.type === "SUCCESS") {
          toast.success(ev.data.message, { id: "import-progress" })
          setIsImporting(false)
          worker.terminate()
          setTimeout(() => {
            window.location.reload()
          }, 1500)
        } else if (ev.data.type === "ERROR") {
          toast.error(`Import failed: ${ev.data.error}`, {
            id: "import-progress",
          })
          setIsImporting(false)
          worker.terminate()
        }
      }

      worker.postMessage({ type: "IMPORT", file, clear: true })
    } catch (err: unknown) {
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

  const showStats = focus === "data" || focus === "table-sizes"
  const showTransfer = focus === "data" || focus === "transfer"
  const showRetention = focus === "data" || focus === "retention"
  const showTablesSection =
    focus === "data" ||
    focus === "table-sizes" ||
    focus === "transfer" ||
    focus === "query" ||
    focus === "danger"
  const showAbout = focus === "data" || focus === "table-sizes"

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

        {showStats && <DatabaseStatsCards dbStats={dbStats} />}

        {showTransfer && (
          <SettingAnchor
            settingId="panel-transfer"
            highlighted={highlightId === "panel-transfer"}
          >
            <TransferPanel
              isMigratingToServer={isMigratingToServer}
              onMigrate={handleMigrateToServer}
            />
          </SettingAnchor>
        )}

        {showRetention && (
          <SettingAnchor
            settingId="panel-retention"
            highlighted={highlightId === "panel-retention"}
          >
            <RetentionPanel
              postRetentionDays={postRetentionDays}
              logRetentionDays={logRetentionDays}
              onPostRetentionDaysChange={setPostRetentionDays}
              onLogRetentionDaysChange={setLogRetentionDays}
              highlightId={highlightId}
            />
          </SettingAnchor>
        )}

        {showTablesSection && (
          <SettingAnchor
            settingId="panel-table-sizes"
            highlighted={highlightId === "panel-table-sizes"}
          >
            <TableSizesPanel
              tableSizes={tableSizes}
              tableSizesLastCalculated={tableSizesLastCalculated}
              selectedTable={selectedTable}
              selectedTablesForExport={selectedTablesForExport}
              isCalculatingSizes={isCalculatingSizes}
              actions={
                <TransferExportImportActions
                  isExporting={isExporting}
                  isImporting={isImporting}
                  selectedExportCount={selectedTablesForExport.size}
                  onExport={handleExportDB}
                  onImport={handleImportDB}
                />
              }
              onSelectTable={setSelectedTable}
              onToggleExportTable={(name, checked) => {
                const next = new Set(selectedTablesForExport)
                if (checked) next.add(name)
                else next.delete(name)
                setSelectedTablesForExport(next)
              }}
              onCalculateSizes={handleCalculateSizes}
              onClearTable={handleClearTable}
            >
              <SettingAnchor
                settingId="panel-query"
                highlighted={highlightId === "panel-query"}
              >
                <QueryPanel
                  selectedTable={selectedTable}
                  query={query}
                  queryResults={queryResults}
                  queryError={queryError}
                  isQuerying={isQuerying}
                  onQueryChange={setQuery}
                  onRunQuery={handleRunQuery}
                />
              </SettingAnchor>
            </TableSizesPanel>
          </SettingAnchor>
        )}
      </div>

      {showAbout && (
        <div className="p-6 bg-app-ink/5 border border-app-ink/10">
          <h3 className="text-[11px] uppercase font-bold tracking-widest mb-3">
            About Local Storage
          </h3>
          <p className="text-[11px] opacity-60 leading-relaxed font-serif">
            This application uses your browser's IndexedDB to store all channel
            data and posts locally. No data is sent to our servers except for
            the content you explicitly send to AI models for analysis. Exporting
            your database regularly is recommended to prevent data loss if you
            clear your browser cache.
          </p>
        </div>
      )}

      <SettingAnchor
        settingId="panel-danger"
        highlighted={highlightId === "panel-danger"}
      >
        <DangerPanel
          confirmModal={confirmModal}
          onDismiss={() => setConfirmModal(null)}
        />
      </SettingAnchor>
    </motion.div>
  )
}
