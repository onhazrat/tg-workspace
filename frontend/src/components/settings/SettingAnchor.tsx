import type React from "react"
import { cn } from "@/lib/utils"

/** Matches SettingRow deep-link highlight styling. */
export const SETTING_HIGHLIGHT_CLASS =
  "bg-amber-500/10 ring-1 ring-amber-500/30 rounded-sm"

/**
 * Stable DOM target for `?setting=<catalogId>` deep-links outside SettingRow.
 * Renders `id="setting-<id>"` and `data-setting-id`, which the panels still
 * carry until SET-03 redraws them.
 */
export const SettingAnchor: React.FC<{
  settingId: string
  highlighted?: boolean
  className?: string
  children: React.ReactNode
}> = ({ settingId, highlighted = false, className, children }) => (
  <div
    id={`setting-${settingId}`}
    data-setting-id={settingId}
    className={cn(
      "scroll-mt-24",
      highlighted && SETTING_HIGHLIGHT_CLASS,
      className,
    )}
  >
    {children}
  </div>
)
