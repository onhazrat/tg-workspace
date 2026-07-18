import { type KeyboardEvent, useEffect, useRef } from "react"
import { PaletteFooterHints } from "@/components/PaletteKeyboardChrome"
import { TgButton } from "@/components/ui/tg-button"
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
        <p className="text-sm text-app-ink/60">{description}</p>
      </div>
      <div className="flex justify-end gap-2">
        <TgButton
          ref={cancelRef}
          type="button"
          variant="secondary"
          size="md"
          data-testid="command-palette-confirm-cancel"
          onClick={onCancel}
        >
          Cancel
        </TgButton>
        <TgButton
          ref={confirmRef}
          type="button"
          variant="dangerSoft"
          size="md"
          data-testid="command-palette-confirm-confirm"
          onClick={() => {
            void onConfirm()
          }}
        >
          Confirm
        </TgButton>
      </div>
      <PaletteFooterHints hints="↵ run focused · ←→ switch · esc cancel" />
    </div>
  )
}
