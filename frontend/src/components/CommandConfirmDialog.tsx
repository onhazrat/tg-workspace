import { type KeyboardEvent, useEffect, useRef } from "react"
import { PaletteFooterHints } from "@/components/PaletteKeyboardChrome"
import type { CommandContext, CommandDef } from "@/lib/commands/types"

interface CommandConfirmDialogProps {
  command: CommandDef
  context: CommandContext
  payload?: unknown
  onConfirm: () => void | Promise<void>
  onCancel: () => void
}

export function CommandConfirmDialog({
  command,
  context,
  payload,
  onConfirm,
  onCancel,
}: CommandConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    cancelRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter") {
      event.preventDefault()
      const active = document.activeElement
      if (active === confirmRef.current) {
        void onConfirm()
        return
      }
      onCancel()
      return
    }

    const movesFocus =
      event.key === "ArrowLeft" ||
      event.key === "ArrowRight" ||
      event.key === "ArrowUp" ||
      event.key === "ArrowDown"
    if (!movesFocus) return

    event.preventDefault()
    const active = document.activeElement
    if (active === confirmRef.current) {
      cancelRef.current?.focus()
      return
    }
    confirmRef.current?.focus()
  }

  const description =
    command.getConfirmDescription?.(context, payload) ??
    command.confirmDescription ??
    "Are you sure you want to run this action?"

  return (
    <div
      className="space-y-4 p-6"
      data-testid="command-palette-confirm"
      onKeyDown={handleKeyDown}
    >
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{command.label}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          data-testid="command-palette-confirm-cancel"
          onClick={onCancel}
          className="rounded-md border border-app-ink/20 px-3 py-2 text-xs font-mono uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ink/30"
        >
          Cancel
        </button>
        <button
          ref={confirmRef}
          type="button"
          data-testid="command-palette-confirm-confirm"
          onClick={() => {
            void onConfirm()
          }}
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40"
        >
          Confirm
        </button>
      </div>
      <PaletteFooterHints hints="↵ run focused · ←→ switch · esc cancel" />
    </div>
  )
}
