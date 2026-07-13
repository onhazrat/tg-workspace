import type React from "react"

const TONE_CLASSES = {
  green: "bg-green-500 border-green-600",
  amber: "bg-amber-500 border-amber-600",
} as const

/**
 * The square on/off switch repeated across the appearance, network, and AI
 * settings sections. Markup and classes are byte-identical to the previous
 * inline buttons.
 */
export const ToggleSwitch: React.FC<{
  checked: boolean
  onClick: () => void
  tone?: keyof typeof TONE_CLASSES
}> = ({ checked, onClick, tone = "green" }) => (
  <button
    type="button"
    onClick={onClick}
    className={`w-10 h-5 transition-all relative border border-app-ink/20 ${checked ? TONE_CLASSES[tone] : "bg-app-ink/10"}`}
  >
    <div
      className={`absolute top-0.5 w-3.5 h-3.5 bg-white transition-all ${checked ? "left-5.5" : "left-0.5"}`}
    />
  </button>
)
