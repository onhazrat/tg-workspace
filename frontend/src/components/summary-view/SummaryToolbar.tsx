import { Check, Copy, Download, RefreshCw, StickyNote } from "lucide-react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tg-tooltip"
import { exportFilename } from "./summary-text"

function ToolbarButton({
  tooltip,
  ...props
}: React.ComponentProps<typeof TgButton> & { tooltip: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <TgButton type="button" variant="ghost" size="sm" {...props} />
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}

export function NoteToggleButton({
  note,
  editing,
  onToggle,
}: {
  note: string | undefined
  editing: boolean
  onToggle: () => void
}) {
  const tooltip = editing ? "Close Note" : note ? "Edit Note" : "Add Note"
  return (
    <ToolbarButton
      tooltip={tooltip}
      onClick={onToggle}
      className={note ? "text-amber-600 bg-amber-500/10" : undefined}
    >
      <StickyNote size={12} className={editing ? "fill-current" : ""} />
      Note
    </ToolbarButton>
  )
}

export function RerunButton({
  running,
  onRerun,
}: {
  running: boolean
  onRerun: () => void
}) {
  return (
    <ToolbarButton
      tooltip="Re-analyzes the current time window."
      onClick={onRerun}
      loading={running}
      loadingLabel="Re-analyze Window"
    >
      <RefreshCw size={12} />
      Re-analyze Window
    </ToolbarButton>
  )
}

/** Copy to clipboard and download as Markdown. */
export function ExportButtons({ body }: { body: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      <ToolbarButton
        tooltip="Copies the summary text to your clipboard."
        onClick={() => {
          navigator.clipboard.writeText(body)
          setCopied(true)
          setTimeout(() => setCopied(false), 2000)
        }}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy Text"}
      </ToolbarButton>
      <ToolbarButton
        tooltip="Downloads the summary as a Markdown file."
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([body], { type: "text/markdown" }),
          )
          const a = document.createElement("a")
          a.href = url
          a.download = exportFilename(new Date())
          a.click()
          URL.revokeObjectURL(url)
        }}
      >
        <Download size={12} />
        Export .MD
      </ToolbarButton>
    </>
  )
}
