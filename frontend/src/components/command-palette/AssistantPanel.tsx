import { ArrowLeft } from "lucide-react"

interface AssistantPanelProps {
  onBack: () => void
}

/** Assistant sub-view placeholder for natural-language commands. */
export function AssistantPanel({ onBack }: AssistantPanelProps) {
  return (
    <div className="space-y-4 p-6">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-2 text-xs uppercase tracking-widest text-app-ink/60 hover:text-app-ink"
      >
        <ArrowLeft size={14} />
        Back
      </button>
      <p className="text-sm text-app-ink/80">
        Natural language commands — coming soon
      </p>
    </div>
  )
}
