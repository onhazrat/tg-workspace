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
import { DatabaseManagementView } from "./database-management/DatabaseManagementView"
import {
  allTableNames,
  type DatabaseFocus,
  exportSelection,
  failureText,
  importSummary,
  panelVisibility,
  readCachedLastCalculated,
  readCachedSizes,
  tableToSelect,
  withTable,
  writeCachedSizes,
} from "./database-management/database-model"
import type { ClearTableConfirm } from "./settings/data/DangerPanel"
import { RetentionPanel } from "./settings/data/RetentionPanel"
import {
  type TableSizeRow,
  type TableSizeSource,
  TableSizesPanel,
} from "./settings/data/TableSizesPanel"
import { TransferExportImportActions } from "./settings/data/TransferPanel"

export const DatabaseManagement: React.FC<{
  focus?: DatabaseFocus
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
    sharedLogRetentionDays,
    setSharedLogRetentionDays,
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

  const [tableSizes, setTableSizes] = useState<TableSizeRow[] | null>(() =>
    readCachedSizes(scopedStorage, sizeSource),
  )
  const [tableSizesLastCalculated, setTableSizesLastCalculated] = useState<
    number | null
  >(() => readCachedLastCalculated(scopedStorage, sizeSource))
  const [selectedTablesForExport, setSelectedTablesForExport] = useState<
    Set<string>
  >(() => allTableNames(readCachedSizes(scopedStorage, sizeSource)))
  const [isCalculatingSizes, setIsCalculatingSizes] = useState(false)
  const [selectedTable, setSelectedTable] = useState<string>("")

  const handleCalculateSizes = async () => {
    setIsCalculatingSizes(true)
    try {
      const sizes = await api.getTableSizes()
      setTableSizes(sizes)
      setSelectedTablesForExport(allTableNames(sizes))
      const now = Date.now()
      setTableSizesLastCalculated(now)
      writeCachedSizes(scopedStorage, sizeSource, sizes, now)
      const first = tableToSelect(sizes, selectedTable)
      if (first) setSelectedTable(first)
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
      const blob = await exportDatabaseBlob(
        exportSelection(tableSizes, selectedTablesForExport),
      )
      downloadBlob(blob, buildTimestampedFilename("telegram-summarizer-db"))
      toast.success("Database exported successfully", { id: "export-progress" })
    } catch (err: unknown) {
      console.error("Export error:", err)
      toast.error(failureText("Export failed", err), { id: "export-progress" })
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
      toast.success(importSummary(imported), { id: "import-progress" })
      await Promise.all([loadDBStats(), loadChannels(), loadHistory()])
      await handleCalculateSizes()
    } catch (err: unknown) {
      console.error("Import error:", err)
      toast.error(failureText("Import failed", err), { id: "import-progress" })
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

  return (
    <DatabaseManagementView
      visible={panelVisibility(focus)}
      highlightId={highlightId}
      dbStats={dbStats}
      retention={
        <RetentionPanel
          postRetentionDays={postRetentionDays}
          logRetentionDays={logRetentionDays}
          sharedLogRetentionDays={sharedLogRetentionDays}
          payloadRetentionDays={payloadRetentionDays}
          reportRetentionDays={reportRetentionDays}
          reportRetentionMax={reportRetentionMax}
          onPostRetentionDaysChange={setPostRetentionDays}
          onLogRetentionDaysChange={setLogRetentionDays}
          onSharedLogRetentionDaysChange={setSharedLogRetentionDays}
          onPayloadRetentionDaysChange={setPayloadRetentionDays}
          onReportRetentionDaysChange={setReportRetentionDays}
          onReportRetentionMaxChange={setReportRetentionMax}
          highlightId={highlightId}
        />
      }
      tables={
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
          onToggleExportTable={(name, checked) =>
            setSelectedTablesForExport(
              withTable(selectedTablesForExport, name, checked),
            )
          }
          onCalculateSizes={handleCalculateSizes}
          onClearTable={handleClearTable}
        />
      }
      confirmModal={confirmModal}
      onRefreshStats={handleRefreshStats}
      onDismissConfirm={() => setConfirmModal(null)}
    />
  )
}
