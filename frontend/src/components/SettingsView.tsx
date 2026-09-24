import { motion } from "motion/react"
import type React from "react"
import { AiSection } from "./settings/AiSection"
import { AppearanceSection } from "./settings/AppearanceSection"
import { NetworkSection } from "./settings/NetworkSection"
import { SyncSection } from "./settings/SyncSection"

const SYNC_HEADING = {
  title: "Channels & Sync",
  subtitle: "Configure automation, schedules, and data sync.",
}

const HEADINGS: Record<string, { title: string; subtitle: string }> = {
  appearance: {
    title: "System Configuration",
    subtitle: "Adjust appearance and interface settings.",
  },
  sync: SYNC_HEADING,
  "channels-sync": SYNC_HEADING,
  ai: {
    title: "AI & Models",
    subtitle: "Configure LLMs, embeddings, and generation parameters.",
  },
  "commonly-used": {
    title: "Commonly Used",
    subtitle: "Frequently adjusted settings.",
  },
  network: {
    title: "Network Configuration",
    subtitle: "Manage proxies, TOR, and synchronization networks.",
  },
}

/** The title and subtitle over a section; anything unknown reads as Network. */
export const settingsViewHeading = (section: string) =>
  HEADINGS[section] ?? HEADINGS.network

/** The catalog body each section draws; a section not listed draws none. */
export const SETTINGS_VIEW_BODIES: Record<
  string,
  React.FC<{ highlightId: string | null }>
> = {
  appearance: AppearanceSection,
  sync: SyncSection,
  "channels-sync": SyncSection,
  network: NetworkSection,
  ai: AiSection,
}

export const SettingsView: React.FC<{
  activeSection?: string
  highlightId?: string | null
}> = ({ activeSection = "appearance", highlightId = null }) => {
  const { title, subtitle } = settingsViewHeading(activeSection)
  const Body = SETTINGS_VIEW_BODIES[activeSection]

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
        {Body && <Body highlightId={highlightId} />}
      </div>
    </motion.div>
  )
}
