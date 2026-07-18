import { ChevronDown, Trash2 } from "lucide-react"
import type React from "react"
import { TgIconButton } from "@/components/ui/tg-icon-button"

interface ExpandToggleButtonProps {
  expanded: boolean
  onClick: () => void
}

export const ExpandToggleButton: React.FC<ExpandToggleButtonProps> = ({
  expanded,
  onClick,
}) => (
  <TgIconButton
    variant="soft"
    aria-label={expanded ? "Collapse Details" : "Expand Details"}
    tooltip={expanded ? "Collapse Details" : "Expand Details"}
    onClick={onClick}
  >
    <ChevronDown
      size={14}
      className={`transition-transform ${expanded ? "rotate-180" : ""}`}
    />
  </TgIconButton>
)

interface DeleteLogButtonProps {
  onClick: () => void
}

export const DeleteLogButton: React.FC<DeleteLogButtonProps> = ({
  onClick,
}) => (
  <TgIconButton
    variant="soft"
    aria-label="Delete Log Entry"
    tooltip="Delete Log Entry"
    onClick={onClick}
    className="text-red-500 border-red-500/10 hover:bg-red-500/5"
  >
    <Trash2 size={14} />
  </TgIconButton>
)
