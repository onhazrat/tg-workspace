import { ClipboardPaste, Loader2 } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"

interface PasteSummaryModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (text: string, modelName?: string) => Promise<boolean>
}

export const PasteSummaryModal: React.FC<PasteSummaryModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [text, setText] = useState("")
  const [modelName, setModelName] = useState("")
  const [saving, setSaving] = useState(false)
  const [pasting, setPasting] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setText("")
      setModelName("")
      setSaving(false)
      setPasting(false)
    }
  }, [isOpen])

  const handlePasteFromClipboard = async () => {
    if (!navigator.clipboard?.readText) {
      toast.error("Clipboard access is not available in this browser.")
      return
    }

    setPasting(true)
    try {
      const clipText = await navigator.clipboard.readText()
      if (!clipText.trim()) {
        toast.warning("Clipboard is empty.")
        return
      }
      setText(clipText)
      toast.success("Pasted from clipboard.")
    } catch (err: unknown) {
      console.error(err)
      toast.error(
        "Could not read clipboard. Grant permission or paste manually (Cmd/Ctrl+V).",
      )
    } finally {
      setPasting(false)
    }
  }

  const handleSave = async () => {
    const trimmed = text.trim()
    if (!trimmed) {
      toast.error("Summary text cannot be empty.")
      return
    }

    setSaving(true)
    try {
      const saved = await onSave(trimmed, modelName.trim() || undefined)
      if (saved) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl border-app-ink/20 bg-app-card text-app-ink">
        <DialogHeader>
          <DialogTitle>Paste AI Response</DialogTitle>
          <DialogDescription className="text-app-ink/70">
            Paste the summary from your external AI tool. Review and edit before
            saving - this history entry will be completed with your response.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <button
            type="button"
            onClick={() => void handlePasteFromClipboard()}
            disabled={pasting}
            className="flex items-center gap-2 px-3 py-2 text-xs font-bold tracking-wide border border-app-ink/10 rounded-lg hover:bg-app-muted/30 disabled:opacity-50"
          >
            {pasting ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <ClipboardPaste size={14} className="opacity-60" />
            )}
            Paste from clipboard
          </button>
          <input
            type="text"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            placeholder="Model name (optional), e.g. Claude 3.5, GPT-4o"
            className="w-full rounded-lg border border-app-ink/10 bg-app-muted/10 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-app-ink/20"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Paste your AI-generated summary here..."
            rows={16}
            className="w-full min-h-[320px] resize-y rounded-lg border border-app-ink/10 bg-app-muted/10 px-3 py-2 text-sm font-mono leading-relaxed focus:outline-none focus:ring-1 focus:ring-app-ink/20"
          />
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-xs font-bold tracking-wide border border-app-ink/20 rounded-lg hover:bg-app-muted/30 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !text.trim()}
            className="px-4 py-2 text-xs font-bold tracking-wide bg-app-ink text-app-bg rounded-lg hover:opacity-90 disabled:opacity-50 flex items-center gap-2"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            Save Summary
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
