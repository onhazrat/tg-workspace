import { ClipboardPaste } from "lucide-react"
import type React from "react"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { TgButton } from "@/components/ui/tg-button"
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
          <TgButton
            type="button"
            variant="secondary"
            size="md"
            onClick={() => void handlePasteFromClipboard()}
            loading={pasting}
            loadingLabel="Paste from clipboard"
          >
            <ClipboardPaste size={14} className="opacity-60" />
            Paste from clipboard
          </TgButton>
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
          <TgButton
            type="button"
            variant="secondary"
            size="md"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </TgButton>
          <TgButton
            type="button"
            variant="primary"
            size="md"
            onClick={() => void handleSave()}
            disabled={!text.trim()}
            loading={saving}
            loadingLabel="Save Summary"
          >
            Save Summary
          </TgButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
