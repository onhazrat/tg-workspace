import type React from "react"
import { settingElementId } from "@/lib/settings/catalog"
import { cn } from "@/lib/utils"

/** Matches SettingRow deep-link highlight styling. */
export const SETTING_HIGHLIGHT_CLASS =
  "bg-amber-500/10 ring-1 ring-amber-500/30 rounded-sm"

/**
 * Stable DOM target for `?setting=<catalogId>` deep-links outside SettingRow.
 * Renders `id="setting-<id>"` and `data-setting-id` so SettingsHub can scroll/highlight.
 */
export const SettingAnchor: React.FC<{
  settingId: string
  highlighted?: boolean
  className?: string
  children: React.ReactNode
}> = ({ settingId, highlighted = false, className, children }) => (
  <div
    id={settingElementId(settingId)}
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
