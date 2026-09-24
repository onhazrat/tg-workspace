import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"

/**
 * The metadata block a publish prepends to the summary. `text` is owned by the
 * caller, which also needs it for the publish and the length hint; `savedText`
 * is what Cancel restores.
 */
export function PublishMetadataPanel({
  send,
  text,
  savedText,
  onSendChange,
  onTextChange,
  onSave,
}: {
  send: boolean
  text: string
  savedText: string
  onSendChange: (send: boolean) => void
  onTextChange: (text: string) => void
  onSave: (text: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await onSave(text)
      setEditing(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-8 border-t border-app-ink/10 pt-6">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-[11px] font-bold uppercase tracking-widest text-app-ink/70">
          Publish Metadata
        </h4>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={send}
            onChange={(e) => onSendChange(e.target.checked)}
            className="w-3 h-3 accent-app-ink"
          />
          <span className="text-[11px] uppercase font-bold text-app-ink">
            Include Metadata
          </span>
        </label>
      </div>

      {send && (
        <div className="bg-app-muted/5 border border-app-ink/10 rounded-lg p-4">
          {editing ? (
            <div className="space-y-3">
              <textarea
                aria-label="Metadata text"
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                className="w-full bg-transparent border border-app-ink/20 rounded p-3 text-xs font-mono focus:outline-none focus:border-app-ink/50 min-h-[120px]"
              />
              <div className="flex justify-end gap-2">
                <TgButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onTextChange(savedText)
                    setEditing(false)
                  }}
                >
                  Cancel
                </TgButton>
                <TgButton
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={saving}
                  loadingLabel="Saving…"
                  onClick={save}
                >
                  Save
                </TgButton>
              </div>
            </div>
          ) : (
            <div
              className="group relative cursor-pointer"
              onClick={() => setEditing(true)}
            >
              <pre className="text-xs font-mono whitespace-pre-wrap opacity-80 group-hover:opacity-100 transition-opacity">
                {text}
              </pre>
              <div className="absolute top-0 right-0 opacity-0 group-hover:opacity-100 transition-opacity bg-app-bg/80 backdrop-blur-sm px-2 py-1 rounded text-[11px] font-bold uppercase border border-app-ink/10">
                Click to Edit
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
