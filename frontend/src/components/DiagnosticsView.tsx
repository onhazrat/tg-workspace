import { Activity, List } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { LogsView } from "./LogsView"
import { NetworkTelemetry } from "./NetworkTelemetry"

export const DiagnosticsView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<"logs" | "telemetry">("logs")

  return (
    <motion.div
      key="diagnostics"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                Diagnostics
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [SYSTEM_HEALTH]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              Monitor system logs, telemetry, and network connections.
            </p>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="flex bg-app-ink/5 p-1 rounded-lg border border-app-ink/10 w-fit mb-6">
        <button
          type="button"
          onClick={() => setActiveTab("logs")}
          className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all flex items-center gap-2 ${
            activeTab === "logs"
              ? "bg-app-ink text-app-bg shadow-sm"
              : "text-app-ink/40 hover:text-app-ink/60"
          }`}
        >
          <List size={12} /> View Logs
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("telemetry")}
          className={`px-4 py-2 text-[10px] uppercase font-bold tracking-widest transition-all flex items-center gap-2 ${
            activeTab === "telemetry"
              ? "bg-app-ink text-app-bg shadow-sm"
              : "text-app-ink/40 hover:text-app-ink/60"
          }`}
        >
          <Activity size={12} /> Network Telemetry
        </button>
      </div>

      <AnimatePresence mode="wait">
        {activeTab === "logs" && (
          <motion.div
            key="logs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <LogsView />
          </motion.div>
        )}
        {activeTab === "telemetry" && (
          <motion.div
            key="telemetry"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <NetworkTelemetry />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
