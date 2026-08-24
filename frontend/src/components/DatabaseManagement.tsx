import { Database, RefreshCw } from "lucide-react"
import { motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { toast } from "sonner"
import { useDBStats, useLoadDBStats } from "@/hooks/useDBStats"
import { useInvalidateSummaries } from "@/hooks/useSummaries"
import { scopedStorage } from "@/lib/storage/scoped"
import { api } from "../api"
import { useData } from "../contexts/DataContext"
import { useSettings } from "../contexts/SettingsContext"
import {
  exportDatabaseBlob,
  importDatabaseFile,
} from "../lib/data-transfer/database"
import {
  buildTimestampedFilename,
  downloadBlob,
} from "../lib/data-transfer/download"
import {
  type ClearTableConfirm,
  DangerPanel,
} from "./settings/data/DangerPanel"
import { RetentionPanel } from "./settings/data/RetentionPanel"
import {
  DatabaseStatsCards,
  type TableSizeRow,
  type TableSizeSource,
  TableSizesPanel,
} from "./settings/data/TableSizesPanel"
import { TransferExportImportActions } from "./settings/data/TransferPanel"
import { SettingAnchor } from "./settings/SettingAnchor"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

export const DatabaseManagement: React.FC<{
  focus?: "data" | "retention" | "table-sizes" | "transfer" | "query"
  highlightId?: string | null
}> = ({ focus = "data", highlightId = null }) => {
  const { loadChannels } = useData()
  const dbStats = useDBStats()
  const loadDBStats = useLoadDBStats()
  const loadHistory = useInvalidateSummaries()
  const {
    postRetentionDays,
    setPostRetentionDays,
    logRetentionDays,
    setLogRetentionDays,
    payloadRetentionDays,
    setPayloadRetentionDays,
    reportRetentionDays,
    setReportRetentionDays,
    reportRetentionMax,
    setReportRetentionMax,
  } = useSettings()

  const [isExporting, setIsExporting] = useState(false)
  const [isImporting, setIsImporting] = useState(false)
  const [confirmModal, setConfirmModal] = useState<ClearTableConfirm>(null)

  // A4 removed the browser mirror, so there is one source of tables: the
  // server. The local/server toggle this panel used to carry is gone with it.
  const sizeSource: TableSizeSource = "server"

  const tableSizesCacheKey = (source: TableSizeSource) =>
    `tableSizesCache:${source}`
  const tableSizesLastCalculatedKey = (source: TableSizeSource) =>
    `tableSizesLastCalculated:${source}`

  const readCachedSizes = (source: TableSizeSource): TableSizeRow[] | null => {
    const cached = scopedStorage.getItem(tableSizesCacheKey(source))
    if (!cached) return null
    try {
      return JSON.parse(cached)
    } catch (_e) {
      return null
    }
  }
  const readCachedLastCalculated = (source: TableSizeSource): number | null => {
    const cached = scopedStorage.getItem(tableSizesLastCalculatedKey(source))
    return cached ? parseInt(cached, 10) : null
  }

  const [tableSizes, setTableSizes] = useState<TableSizeRow[] | null>(() =>
    readCachedSizes(sizeSource),
  )
  const [tableSizesLastCalculated, setTableSizesLastCalculated] = useState<
    number | null
  >(() => readCachedLastCalculated(sizeSource))
  const [selectedTablesForExport, setSelectedTablesForExport] = useState<
    Set<string>
  >(() => {
    const sizes = readCachedSizes(sizeSource)
    return sizes ? new Set(sizes.map((s) => s.name)) : new Set()
  })
  const [isCalculatingSizes, setIsCalculatingSizes] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string>("")
  const [_query, _setQuery] = useState<string>("")
  const [_queryResults, _setQueryResults] = useState<unknown[] | null>(null)
  const [_isQuerying, _setIsQuerying] = useState(false)
  const [_queryError, _setQueryError] = useState<string | null>(null)

  const handleCalculateSizes = async () => {
    setIsCalculatingSizes(true)
    try {
      const sizes = await api.getTableSizes()
      setTableSizes(sizes)
      setSelectedTablesForExport(new Set(sizes.map((s) => s.name)))
      const now = Date.now()
      setTableSizesLastCalculated(now)
      scopedStorage.setItem(
        tableSizesCacheKey(sizeSource),
        JSON.stringify(sizes),
      )
      scopedStorage.setItem(
        tableSizesLastCalculatedKey(sizeSource),
        now.toString(),
      )
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

  const handleRefreshStats = async () => {
    await loadDBStats()
  }

  const handleExportDB = async () => {
    setIsExporting(true)
    try {
      toast.info("Exporting database…", { id: "export-progress" })
      // The whole selection means "everything"; `exportDatabaseBlob` treats an
      // empty selection the same way.
      const allSelected =
        tableSizes !== null &&
        selectedTablesForExport.size === tableSizes.length
      const blob = await exportDatabaseBlob(
        allSelected ? undefined : Array.from(selectedTablesForExport),
      )
      downloadBlob(blob, buildTimestampedFilename("telegram-summarizer-db"))
      toast.success("Database exported successfully", { id: "export-progress" })
    } catch (err: unknown) {
      console.error("Export error:", err)
      toast.error(
        `Export failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: "export-progress" },
      )
    } finally {
      setIsExporting(false)
    }
  }

  const handleImportDB = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ""

    setIsImporting(true)
    try {
      toast.info("Importing database…", { id: "import-progress" })
      const imported = await importDatabaseFile(file)
      const summary = Object.entries(imported)
        .map(([table, count]) => `${table}: ${count}`)
        .join(", ")
      toast.success(`Import complete (${summary || "no records"})`, {
        id: "import-progress",
      })
      await Promise.all([loadDBStats(), loadChannels(), loadHistory()])
      await handleCalculateSizes()
    } catch (err: unknown) {
      console.error("Import error:", err)
      toast.error(
        `Import failed: ${err instanceof Error ? err.message : String(err)}`,
        { id: "import-progress" },
      )
    } finally {
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
          await api.clearServerTable(tableName)
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
  const showRetention = focus === "data" || focus === "retention"
  const showTablesSection =
    focus === "data" ||
    focus === "table-sizes" ||
    focus === "transfer" ||
    focus === "query"
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
              Monitor storage usage and manage server and cached data.
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

        {showRetention && (
          <SettingAnchor
            settingId="panel-retention"
            highlighted={highlightId === "panel-retention"}
          >
            <RetentionPanel
              postRetentionDays={postRetentionDays}
              logRetentionDays={logRetentionDays}
              payloadRetentionDays={payloadRetentionDays}
              reportRetentionDays={reportRetentionDays}
              reportRetentionMax={reportRetentionMax}
              onPostRetentionDaysChange={setPostRetentionDays}
              onLogRetentionDaysChange={setLogRetentionDays}
              onPayloadRetentionDaysChange={setPayloadRetentionDays}
              onReportRetentionDaysChange={setReportRetentionDays}
              onReportRetentionMaxChange={setReportRetentionMax}
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
            />
          </SettingAnchor>
        )}
      </div>

      {showAbout && (
        <div className="p-6 bg-app-ink/5 border border-app-ink/10">
          <h3 className="text-[11px] uppercase font-bold tracking-widest mb-3">
            About Storage
          </h3>
          <p className="text-[11px] opacity-60 leading-relaxed font-serif">
            Channels, posts and summaries live in this deployment's PostgreSQL
            database, which is the only place they are stored. The browser keeps
            nothing but your settings and the current selection, so clearing it
            loses no data. Export from here to take a backup — and note that an
            export is a point-in-time copy, not a running mirror.
          </p>
        </div>
      )}

      {/* Not a section — this is the confirmation dialog for the per-table clear
          buttons, and renders nothing until one is triggered. It carries no
          settings anchor because nothing can deep-link to a dialog. */}
      <DangerPanel
        confirmModal={confirmModal}
        onDismiss={() => setConfirmModal(null)}
      />
    </motion.div>
  )
}
