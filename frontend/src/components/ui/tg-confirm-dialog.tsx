import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { TgButton } from "@/components/ui/tg-button"
import { cn } from "@/lib/utils"
import type * as React from "react"

type TgConfirmVariant = "default" | "destructive" | "dangerSoft"

type TgConfirmDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: React.ReactNode
  description?: React.ReactNode
  descriptionClassName?: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: TgConfirmVariant
  loading?: boolean
  loadingLabel?: string
  onConfirm: () => void | Promise<void>
  onCancel?: () => void
  children?: React.ReactNode
  className?: string
  footerClassName?: string
  confirmClassName?: string
  cancelClassName?: string
  confirmTestId?: string
  cancelTestId?: string
}

const confirmVariantMap: Record<
  TgConfirmVariant,
  "primary" | "danger" | "dangerSoft"
> = {
  default: "primary",
  destructive: "danger",
  dangerSoft: "dangerSoft",
}

export { confirmVariantMap }

/** Shared TG confirm modal chrome wrapping Radix Dialog. */
function TgConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  descriptionClassName,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  loading = false,
  loadingLabel,
  onConfirm,
  onCancel,
  children,
  className,
  footerClassName,
  confirmClassName,
  cancelClassName,
  confirmTestId,
  cancelTestId,
}: TgConfirmDialogProps) {
  const handleCancel = () => {
    onCancel?.()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md",
          className,
        )}
        showCloseButton={false}
      >
        <DialogHeader className="border-b border-app-ink/10 p-4">
          <DialogTitle className="text-lg font-bold tracking-tight">
            {title}
          </DialogTitle>
          {description != null && description !== "" ? (
            <DialogDescription
              className={cn("text-sm text-app-ink/70", descriptionClassName)}
            >
              {description}
            </DialogDescription>
          ) : null}
        </DialogHeader>
        {children}
        <DialogFooter
          className={cn(
            "border-t border-app-ink/10 bg-app-muted/30 p-4 sm:justify-end",
            footerClassName,
          )}
        >
          <TgButton
            type="button"
            variant="secondary"
            size="md"
            data-testid={cancelTestId}
            className={cancelClassName}
            disabled={loading}
            onClick={handleCancel}
          >
            {cancelLabel}
          </TgButton>
          <TgButton
            type="button"
            variant={confirmVariantMap[variant]}
            size="md"
            data-testid={confirmTestId}
            className={confirmClassName}
            loading={loading}
            loadingLabel={loadingLabel}
            onClick={() => {
              void onConfirm()
            }}
          >
            {confirmLabel}
          </TgButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export { TgConfirmDialog }
export type { TgConfirmDialogProps, TgConfirmVariant }
// confirmVariantMap exported above for unit tests
