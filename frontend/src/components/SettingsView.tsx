import { motion } from "motion/react"
import type React from "react"
import { AiSection } from "./settings/AiSection"
import { AppearanceSection } from "./settings/AppearanceSection"
import { NetworkSection } from "./settings/NetworkSection"
import { SyncSection } from "./settings/SyncSection"

export const SettingsView: React.FC<{
  activeSection?: string
  highlightId?: string | null
}> = ({ activeSection = "appearance", highlightId = null }) => {
  const title =
    activeSection === "appearance"
      ? "System Configuration"
      : activeSection === "sync" || activeSection === "channels-sync"
        ? "Channels & Sync"
        : activeSection === "ai"
          ? "AI & Models"
          : activeSection === "commonly-used"
            ? "Commonly Used"
            : "Network Configuration"

  const subtitle =
    activeSection === "appearance"
      ? "Adjust appearance and interface settings."
      : activeSection === "sync" || activeSection === "channels-sync"
        ? "Configure automation, schedules, and data sync."
        : activeSection === "ai"
          ? "Configure LLMs, embeddings, and generation parameters."
          : activeSection === "commonly-used"
            ? "Frequently adjusted settings."
            : "Manage proxies, TOR, and synchronization networks."

  return (
    <motion.div
      key="settings"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-8 pb-20"
    >
      <div className="flex flex-col gap-4 mb-6">
        <div className="flex justify-between items-end">
          <div className="text-left">
            <div className="flex items-baseline gap-3">
              <h3 className="text-sm uppercase font-bold tracking-widest">
                {title}
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [{activeSection.toUpperCase()}]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              {subtitle}
            </p>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {activeSection === "appearance" && (
          <AppearanceSection highlightId={highlightId} />
        )}
        {(activeSection === "sync" || activeSection === "channels-sync") && (
          <SyncSection highlightId={highlightId} />
        )}
        {activeSection === "network" && (
          <NetworkSection highlightId={highlightId} />
        )}
        {activeSection === "ai" && <AiSection highlightId={highlightId} />}
      </div>
    </motion.div>
  )
}
