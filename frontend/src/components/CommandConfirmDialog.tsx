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
  const description =
    command.getConfirmDescription?.(context, payload) ??
    command.confirmDescription ??
    "Are you sure you want to run this action?"

  return (
    <div className="space-y-4 p-6" data-testid="command-palette-confirm">
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">{command.label}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-app-ink/20 px-3 py-2 text-xs font-mono uppercase tracking-widest"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            void onConfirm()
          }}
          className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-red-600"
        >
          Confirm
        </button>
      </div>
    </div>
  )
}
