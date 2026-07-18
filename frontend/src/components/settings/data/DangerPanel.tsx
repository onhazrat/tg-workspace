import type React from "react"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"

export type ClearTableConfirm = {
  isOpen: boolean
  title: string
  message: string
  onConfirm: () => void
} | null

type DangerPanelProps = {
  confirmModal: ClearTableConfirm
  onDismiss: () => void
}

/** Clear-table confirmation dialog (triggers live on table cards). */
export const DangerPanel: React.FC<DangerPanelProps> = ({
  confirmModal,
  onDismiss,
}) => (
  <TgConfirmDialog
    open={Boolean(confirmModal?.isOpen)}
    onOpenChange={(open) => {
      if (!open) onDismiss()
    }}
    title={confirmModal?.title ?? ""}
    description={confirmModal?.message}
    descriptionClassName="text-app-ink/80"
    variant="dangerSoft"
    onConfirm={() => {
      confirmModal?.onConfirm()
    }}
    onCancel={onDismiss}
  />
)
