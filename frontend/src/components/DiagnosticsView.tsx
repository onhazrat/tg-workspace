import { Activity, List } from "lucide-react"
import { AnimatePresence, motion } from "motion/react"
import type React from "react"
import { useState } from "react"
import { TgSegmentedControl } from "@/components/ui/tg-segmented"
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

      <TgSegmentedControl<"logs" | "telemetry">
        aria-label="Diagnostics view"
        className="mb-6"
        value={activeTab}
        onChange={setActiveTab}
        options={[
          {
            value: "logs",
            label: (
              <>
                <List size={12} /> View Logs
              </>
            ),
          },
          {
            value: "telemetry",
            label: (
              <>
                <Activity size={12} /> Network Telemetry
              </>
            ),
          },
        ]}
      />

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
