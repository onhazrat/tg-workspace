import type * as React from "react"

import { cn } from "@/lib/utils"

const TONE_CLASSES = {
  green: "bg-green-500 border-green-600",
  amber: "bg-amber-500 border-amber-600",
} as const

type TgToggleProps = {
  checked: boolean
  onClick: () => void
  tone?: keyof typeof TONE_CLASSES
  className?: string
  "aria-label"?: string
}

/**
 * Square on/off switch used across Appearance, Network, and AI settings.
 */
function TgToggle({
  checked,
  onClick,
  tone = "green",
  className,
  "aria-label": ariaLabel,
}: TgToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      data-slot="tg-toggle"
      onClick={onClick}
      className={cn(
        "w-10 h-5 transition-all relative border border-app-ink/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30",
        checked ? TONE_CLASSES[tone] : "bg-app-ink/10",
        className,
      )}
    >
      <div
        className={cn(
          "absolute top-0.5 w-3.5 h-3.5 bg-white transition-all",
          checked ? "left-5.5" : "left-0.5",
        )}
      />
    </button>
  )
}

export { TgToggle }
export type { TgToggleProps }
