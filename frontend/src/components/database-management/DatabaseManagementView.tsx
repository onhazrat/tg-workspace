import { Database, RefreshCw } from "lucide-react"
import { motion } from "motion/react"
import type { ComponentProps, ReactNode } from "react"

import {
  type ClearTableConfirm,
  DangerPanel,
} from "@/components/settings/data/DangerPanel"
import { DatabaseStatsCards } from "@/components/settings/data/TableSizesPanel"
import { SettingAnchor } from "@/components/settings/SettingAnchor"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"
import type { PanelVisibility } from "./database-model"

/**
 * What `DatabaseManagement` renders, as props only. The retention and table
 * panels arrive built, so this decides nothing but which sections a focus
 * shows and where the settings anchors go.
 */
export function DatabaseManagementView({
  visible,
  highlightId,
  dbStats,
  retention,
  tables,
  confirmModal,
  onRefreshStats,
  onDismissConfirm,
}: {
  visible: PanelVisibility
  highlightId: string | null
  dbStats: ComponentProps<typeof DatabaseStatsCards>["dbStats"]
  retention: ReactNode
  tables: ReactNode
  confirmModal: ClearTableConfirm
  onRefreshStats: () => void
  onDismissConfirm: () => void
}) {
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
                onClick={onRefreshStats}
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

        {visible.stats && <DatabaseStatsCards dbStats={dbStats} />}

        {visible.retention && (
          <SettingAnchor
            settingId="panel-retention"
            highlighted={highlightId === "panel-retention"}
          >
            {retention}
          </SettingAnchor>
        )}

        {visible.tables && (
          <SettingAnchor
            settingId="panel-table-sizes"
            highlighted={highlightId === "panel-table-sizes"}
          >
            {tables}
          </SettingAnchor>
        )}
      </div>

      {visible.about && (
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
      <DangerPanel confirmModal={confirmModal} onDismiss={onDismissConfirm} />
    </motion.div>
  )
}
