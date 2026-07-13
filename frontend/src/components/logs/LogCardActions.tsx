import { ChevronDown, Trash2 } from "lucide-react"
import type React from "react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tg-tooltip"

interface ExpandToggleButtonProps {
  expanded: boolean
  onClick: () => void
}

export const ExpandToggleButton: React.FC<ExpandToggleButtonProps> = ({
  expanded,
  onClick,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
        className="p-1.5 text-app-ink opacity-30 hover:opacity-100 transition-all border border-app-ink/10 hover:bg-app-ink/5"
      >
        <ChevronDown
          size={14}
          className={`transition-transform ${expanded ? "rotate-180" : ""}`}
        />
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <p>{expanded ? "Collapse" : "Expand"} Details</p>
    </TooltipContent>
  </Tooltip>
)

interface DeleteLogButtonProps {
  onClick: () => void
}

export const DeleteLogButton: React.FC<DeleteLogButtonProps> = ({
  onClick,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        type="button"
        onClick={onClick}
        className="p-1.5 text-red-500 opacity-30 hover:opacity-100 transition-all border border-red-500/10 hover:bg-red-500/5"
      >
        <Trash2 size={14} />
      </button>
    </TooltipTrigger>
    <TooltipContent>
      <p>Delete Log Entry</p>
    </TooltipContent>
  </Tooltip>
)
