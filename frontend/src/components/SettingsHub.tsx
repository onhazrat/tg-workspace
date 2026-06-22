import {
  Activity,
  Braces,
  Cpu,
  Database,
  Globe,
  Layout,
  List,
  RefreshCw,
  Send,
  Settings,
} from "lucide-react"
import type React from "react"
import { useEffect } from "react"
import { useSettingsSection } from "@/hooks/useSettingsSection"
import type { SettingsSection } from "@/lib/settingsSection"
import { SETTINGS_TABS } from "../constants"
import { useData } from "../contexts/DataContext"
import { BotManagement } from "./BotManagement"
import { DatabaseManagement } from "./DatabaseManagement"
import { DiagnosticsView } from "./DiagnosticsView"
import { RuntimeConfigView } from "./RuntimeConfigView"
import { SettingsView } from "./SettingsView"

export const SettingsHub: React.FC = () => {
  const {
    activeSection: activeSettingsTab,
    setActiveSection: setActiveSettingsTab,
  } = useSettingsSection()
  const {
    loadDBStats,
    loadLogs,
    loadSyncLogs,
    loadLLMLogs,
    loadEmbeddingLogs,
    loadNetworkLogs,
  } = useData()

  useEffect(() => {
    if (activeSettingsTab === "db") {
      void loadDBStats()
    }
    if (activeSettingsTab === "diagnostics") {
      void Promise.all([
        loadLogs(),
        loadSyncLogs(),
        loadLLMLogs(),
        loadEmbeddingLogs(),
        loadNetworkLogs(),
      ])
    }
  }, [
    activeSettingsTab,
    loadDBStats,
    loadLogs,
    loadSyncLogs,
    loadLLMLogs,
    loadEmbeddingLogs,
    loadNetworkLogs,
  ])

  const renderContent = () => {
    switch (activeSettingsTab) {
      case "appearance":
      case "sync":
      case "ai":
      case "network":
        return <SettingsView activeSection={activeSettingsTab} />
      case "publishing":
        return <BotManagement />
      case "db":
        return <DatabaseManagement />
      case "diagnostics":
        return <DiagnosticsView />
      case "runtime-config":
        return <RuntimeConfigView />
      default:
        return <SettingsView activeSection="appearance" />
    }
  }

  return (
    <div className="flex h-full -m-8">
      {/* Sidebar */}
      <div className="w-64 border-r border-app-ink/10 bg-app-muted/50 p-6 flex flex-col gap-8 shrink-0 overflow-y-auto">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest mb-4 opacity-50">
            Engine Room
          </h2>
          <div className="flex flex-col gap-1">
            {SETTINGS_TABS.map((tab) => {
              const Icon =
                {
                  Settings,
                  Cpu,
                  Globe,
                  Send,
                  Database,
                  List,
                  Activity,
                  Layout,
                  RefreshCw,
                  Braces,
                }[tab.icon] || Settings

              const isActive = activeSettingsTab === tab.id

              return (
                <button
                  type="button"
                  key={tab.id}
                  onClick={() =>
                    setActiveSettingsTab(tab.id as SettingsSection)
                  }
                  className={`flex items-center gap-3 px-3 py-2 text-left text-[11px] font-mono uppercase tracking-widest transition-all rounded-sm ${
                    isActive
                      ? "bg-app-ink text-app-bg font-bold"
                      : "opacity-60 hover:opacity-100 hover:bg-app-ink/5"
                  }`}
                >
                  <Icon size={14} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Content Area */}
      <div
        className={`flex-1 p-8 overflow-y-auto bg-app-card transition-colors ${activeSettingsTab === "diagnostics" || activeSettingsTab === "runtime-config" ? "terminal-theme text-app-ink" : ""}`}
      >
        {renderContent()}
      </div>
    </div>
  )
}
