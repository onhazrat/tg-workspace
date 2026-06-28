import { ArrowLeft } from "lucide-react"

interface PaletteSubViewHeaderProps {
  label: string
  onBack: () => void
  showBackspaceHint?: boolean
}

export function PaletteSubViewHeader({
  label,
  onBack,
  showBackspaceHint = true,
}: PaletteSubViewHeaderProps) {
  return (
    <div className="flex items-center gap-2 border-b border-app-ink/10 px-3 py-2 text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to previous view"
        className="inline-flex items-center gap-1.5 rounded-sm hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
      >
        <ArrowLeft size={12} />
        Back
      </button>
      <span className="truncate text-app-ink/70 normal-case tracking-normal">
        {label}
      </span>
      {showBackspaceHint ? (
        <span className="ml-auto shrink-0">⌫ empty</span>
      ) : null}
    </div>
  )
}

interface PaletteFooterHintsProps {
  hints: string
}

export function PaletteFooterHints({ hints }: PaletteFooterHintsProps) {
  return (
    <div className="border-t border-app-ink/10 px-3 py-2 text-[11px] font-mono uppercase tracking-widest text-app-ink/70">
      {hints}
    </div>
  )
}
