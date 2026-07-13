import { Trash2 } from "lucide-react"
import type React from "react"
import { LOG_TAB_META, type LogTab } from "@/lib/logs/tabs"

interface LogsHeaderProps {
  activeTab: LogTab
  recordCount: number
  onClearLogs: () => void
}

export const LogsHeader: React.FC<LogsHeaderProps> = ({
  activeTab,
  recordCount,
  onClearLogs,
}) => {
  const meta = LOG_TAB_META[activeTab]
  return (
    <div className="flex justify-between items-end">
      <div className="text-left">
        <div className="flex items-baseline gap-3">
          <h3 className="text-sm uppercase font-bold tracking-widest">
            System Logs
          </h3>
          <span className="text-[10px] font-mono opacity-40">
            [{recordCount} RECORDS]
          </span>
        </div>
        <p className="text-[10px] italic serif opacity-50 mt-1">
          {meta.description}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onClearLogs}
          className="px-3 py-1.5 border border-red-500/20 text-red-500 hover:bg-red-500 hover:text-white transition-all text-[9px] uppercase font-bold flex items-center gap-2"
        >
          <Trash2 size={12} />
          Clear {meta.label} Logs
        </button>
      </div>
    </div>
  )
}
