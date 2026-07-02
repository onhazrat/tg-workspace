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

interface PasteTagsModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (text: string, modelName?: string) => Promise<boolean>
}

export const PasteTagsModal: React.FC<PasteTagsModalProps> = ({
  isOpen,
  onClose,
  onSave,
}) => {
  const [text, setText] = useState("")
  const [modelName, setModelName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isOpen) {
      setText("")
      setModelName("")
      setSaving(false)
    }
  }, [isOpen])

  const pasteFromClipboard = async () => {
    try {
      const clipText = await navigator.clipboard.readText()
      if (!clipText.trim()) {
        toast.warning("Clipboard is empty.")
        return
      }
      setText(clipText)
      toast.success("Pasted from clipboard.")
    } catch {
      toast.error("Clipboard access failed. Paste manually.")
    }
  }

  const handleSave = async () => {
    if (!text.trim()) {
      toast.error("Response text cannot be empty.")
      return
    }
    setSaving(true)
    try {
      const ok = await onSave(text.trim(), modelName.trim() || undefined)
      if (ok) onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl border-app-ink/20 bg-app-card text-app-ink">
        <DialogHeader>
          <DialogTitle>Paste Tag Response</DialogTitle>
          <DialogDescription className="text-app-ink/70">
            Paste JSON in this shape: {"{"}"channel_username": ["tag1", "tag2"]{"}"}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => void pasteFromClipboard()}
            className="flex items-center gap-2 rounded-lg border border-app-ink/10 px-3 py-2 text-xs font-bold tracking-wide hover:bg-app-muted/30"
          >
            <ClipboardPaste size={14} />
            Paste from clipboard
          </button>
          <input
            type="text"
            value={modelName}
            onChange={(event) => setModelName(event.target.value)}
            placeholder="Model name (optional)"
            className="w-full rounded-lg border border-app-ink/10 bg-app-muted/10 px-3 py-2 text-sm"
          />
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={14}
            className="w-full min-h-[280px] resize-y rounded-lg border border-app-ink/10 bg-app-muted/10 px-3 py-2 text-sm font-mono"
            placeholder='{"channel_a":["Politics","Geopolitics"]}'
          />
        </div>
        <DialogFooter>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-app-ink/20 px-4 py-2 text-xs font-bold tracking-wide"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-app-ink px-4 py-2 text-xs font-bold tracking-wide text-app-bg disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : null}
            Save Response
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
