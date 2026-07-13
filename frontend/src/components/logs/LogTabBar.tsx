import type React from "react"
import { LOG_TAB_META, LOG_TABS, type LogTab } from "@/lib/logs/tabs"

interface LogTabBarProps {
  activeTab: LogTab
  onSelect: (tab: LogTab) => void
}

export const LogTabBar: React.FC<LogTabBarProps> = ({
  activeTab,
  onSelect,
}) => (
  <div className="flex border-b border-app-ink/10">
    {LOG_TABS.map((tab) => (
      <button
        key={tab}
        type="button"
        onClick={() => onSelect(tab)}
        className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all border-b-2 ${
          activeTab === tab
            ? "border-app-ink opacity-100"
            : "border-transparent opacity-40"
        }`}
      >
        {LOG_TAB_META[tab].label} Logs
      </button>
    ))}
  </div>
)
