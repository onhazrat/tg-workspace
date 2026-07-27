import { AlertCircle, Database, HardDrive, Search, Trash2 } from "lucide-react"
import type React from "react"
import { RelativeTime } from "@/components/RelativeTime"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
import { TgSettingsSection } from "@/components/ui/tg-settings-section"
import { isStaleCalculation } from "@/lib/data-freshness"

export type TableSizeRow = { name: string; size: number; count: number }
export type TableSizeSource = "local" | "server"

type DbStats = {
  postCount?: number
  channelCount?: number
  summaryCount?: number
  storageEstimate?: { usage?: number; quota?: number }
} | null

export const DatabaseStatsCards: React.FC<{ dbStats: DbStats }> = ({
  dbStats,
}) => (
  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
    <div className="border border-app-ink/10 p-6 bg-app-card shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center gap-3 mb-6 opacity-40">
          <Database size={16} />
          {/* These three cards read three different sources — server counts,
              browser quota, browser schema — and are not governed by the DATA
              SOURCE toggle below, which selects how per-table sizes are computed.
              Unlabelled, they read as the table's numbers disagreeing with
              themselves. `getDBStats` merges remote counts over a local base. */}
          <h4 className="text-[11px] uppercase font-bold tracking-widest">
            Records · Server
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
            Storage · Browser
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
            Info · Browser Cache
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
            <span className="font-mono font-bold text-[10px]">Persistent</span>
          </div>
        </div>
      </div>
    </div>
  </div>
)

type TableSizesPanelProps = {
  tableSizes: TableSizeRow[] | null
  tableSizesLastCalculated: number | null
  selectedTable: string
  selectedTablesForExport: Set<string>
  isCalculatingSizes: boolean
  sizeSource: TableSizeSource
  actions?: React.ReactNode
  children?: React.ReactNode
  onSelectTable: (name: string) => void
  onToggleExportTable: (name: string, checked: boolean) => void
  onCalculateSizes: () => void
  onChangeSizeSource: (source: TableSizeSource) => void
  onClearTable: (name: string) => void
}

export const TableSizesPanel: React.FC<TableSizesPanelProps> = ({
  tableSizes,
  tableSizesLastCalculated,
  selectedTable,
  selectedTablesForExport,
  isCalculatingSizes,
  sizeSource,
  actions,
  children,
  onSelectTable,
  onToggleExportTable,
  onCalculateSizes,
  onChangeSizeSource,
  onClearTable,
}) => (
  <TgSettingsSection
    icon={Search}
    title="Table Sizes & Queries"
    className="mb-8"
    titleClassName="text-[11px]"
    subtitle={
      tableSizesLastCalculated ? (
        <span
          className={
            isStaleCalculation(tableSizesLastCalculated)
              ? "text-amber-600 dark:text-amber-400"
              : undefined
          }
          data-testid="table-sizes-last-calculated"
        >
          Last calculated: <RelativeTime timestamp={tableSizesLastCalculated} />
          {/* Cached figures are shown until recalculated; without this they read
              as current no matter how old they are. */}
          {isStaleCalculation(tableSizesLastCalculated)
            ? " — recalculate for current figures"
            : null}
        </span>
      ) : undefined
    }
    actions={
      <>
        {actions}
        <TgButton
          type="button"
          variant="secondary"
          size="md"
          onClick={onCalculateSizes}
          loading={isCalculatingSizes}
          loadingLabel="Calculate Sizes"
        >
          <HardDrive size={14} />
          Calculate Sizes
        </TgButton>
      </>
    }
  >
    <div className="flex items-center gap-3 mb-6">
      <span className="text-[10px] uppercase opacity-50 tracking-widest font-bold">
        Data Source
      </span>
      <TgSegmentedControl
        size="dense"
        aria-label="Table size data source"
        value={sizeSource}
        onChange={onChangeSizeSource}
        options={[
          { value: "local", label: "Local (Browser)" },
          { value: "server", label: "Backend DB" },
        ]}
      />
    </div>

    {tableSizes && (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {tableSizes.map((table) => (
            <div
              key={table.name}
              className={`p-4 border transition-colors cursor-pointer group relative ${selectedTable === table.name ? "border-app-ink bg-app-ink/5" : "border-app-ink/10 hover:border-app-ink/30"}`}
              onClick={() => onSelectTable(table.name)}
            >
              <div className="flex justify-between items-center mb-2">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selectedTablesForExport.has(table.name)}
                    onChange={(e) => {
                      e.stopPropagation()
                      onToggleExportTable(table.name, e.target.checked)
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
                <TgIconButton
                  variant="danger"
                  aria-label={`Clear all entries in ${table.name}`}
                  tooltip={`Clear all entries in ${table.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onClearTable(table.name)
                  }}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 size={14} />
                </TgIconButton>
              </div>
            </div>
          ))}
        </div>

        {children}
      </div>
    )}
  </TgSettingsSection>
)
