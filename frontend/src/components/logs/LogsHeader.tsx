import { Trash2 } from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
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
        <TgButton
          type="button"
          variant="dangerSoft"
          size="sm"
          onClick={onClearLogs}
        >
          <Trash2 size={12} />
          Clear {meta.label} Logs
        </TgButton>
      </div>
    </div>
  )
}
