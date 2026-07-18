import { ArrowLeft } from "lucide-react"
import { TgButton } from "@/components/ui/tg-button"

interface AssistantPanelProps {
  onBack: () => void
}

/** Assistant sub-view placeholder for natural-language commands. */
export function AssistantPanel({ onBack }: AssistantPanelProps) {
  return (
    <div className="space-y-4 p-6">
      <TgButton type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft size={14} />
        Back
      </TgButton>
      <p className="text-sm text-app-ink/80">
        Natural language commands — coming soon
      </p>
    </div>
  )
}
