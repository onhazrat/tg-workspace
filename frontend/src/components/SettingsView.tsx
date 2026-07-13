import { motion } from "motion/react"
import type React from "react"
import { useSettings } from "../contexts/SettingsContext"
import { AiSection } from "./settings/AiSection"
import { AppearanceSection } from "./settings/AppearanceSection"
import { NetworkSection } from "./settings/NetworkSection"
import { SyncSection } from "./settings/SyncSection"

export const SettingsView: React.FC<{ activeSection?: string }> = ({
  activeSection = "preferences",
}) => {
  const { advancedMode, setAdvancedMode } = useSettings()

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
                {activeSection === "appearance"
                  ? "System Configuration"
                  : activeSection === "sync"
                    ? "Scraping & Synchronization"
                    : activeSection === "ai"
                      ? "AI & Models"
                      : "Network Configuration"}
              </h3>
              <span className="text-[10px] font-mono opacity-40">
                [{activeSection.toUpperCase()}]
              </span>
            </div>
            <p className="text-[10px] italic serif opacity-50 mt-1">
              {activeSection === "appearance"
                ? "Adjust appearance and interface settings."
                : activeSection === "sync"
                  ? "Configure automation, schedules, and data sync."
                  : activeSection === "ai"
                    ? "Configure LLMs, embeddings, and generation parameters."
                    : "Manage proxies, TOR, and synchronization networks."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold uppercase tracking-tight opacity-60">
              Advanced Mode
            </span>
            <button
              type="button"
              onClick={() => setAdvancedMode(!advancedMode)}
              className={`w-10 h-5 transition-all relative border border-app-ink/20 ${advancedMode ? "bg-app-ink" : "bg-app-ink/10"}`}
            >
              <div
                className={`absolute top-0.5 w-3.5 h-3.5 transition-all ${advancedMode ? "left-5.5 bg-app-bg" : "left-0.5 bg-app-ink/50"}`}
              />
            </button>
          </div>
        </div>
        <div className="h-px bg-app-ink/10 w-full" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {activeSection === "appearance" && <AppearanceSection />}
        {activeSection === "sync" && <SyncSection />}
        {activeSection === "network" && <NetworkSection />}
        {activeSection === "ai" && <AiSection />}
      </div>
    </motion.div>
  )
}
