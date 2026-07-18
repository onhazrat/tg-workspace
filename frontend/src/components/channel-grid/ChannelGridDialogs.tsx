import { ShieldAlert } from "lucide-react"
import type React from "react"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import type { Channel } from "@/types"

type ChannelGridDialogsProps = {
  confirmResetModal: Channel | null
  onCloseResetModal: () => void
  onConfirmResetAndSync: () => void
  confirmDeleteChannel: Channel | null
  onCloseDeleteChannel: () => void
  onConfirmDeleteChannel: () => void
  confirmBulkDelete: boolean
  onBulkDeleteOpenChange: (open: boolean) => void
  onConfirmBulkDelete: () => void
  selectedCount: number
  confirmBulkFreezeAction: "freeze" | "unfreeze" | null
  onCloseBulkFreezeAction: () => void
  onConfirmBulkFreezeAction: () => void
}

/** Confirm dialogs for reset-and-sync, single delete, bulk delete, and bulk freeze/unfreeze. */
export const ChannelGridDialogs: React.FC<ChannelGridDialogsProps> = ({
  confirmResetModal,
  onCloseResetModal,
  onConfirmResetAndSync,
  confirmDeleteChannel,
  onCloseDeleteChannel,
  onConfirmDeleteChannel,
  confirmBulkDelete,
  onBulkDeleteOpenChange,
  onConfirmBulkDelete,
  selectedCount,
  confirmBulkFreezeAction,
  onCloseBulkFreezeAction,
  onConfirmBulkFreezeAction,
}) => {
  return (
    <>
      <TgConfirmDialog
        open={confirmResetModal !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseResetModal()
        }}
        title="Reset & Sync Channel"
        description={
          confirmResetModal
            ? `Clear all posts for @${confirmResetModal.name} and re-sync from ID ${confirmResetModal.startId ?? 1}?`
            : ""
        }
        variant="destructive"
        onConfirm={onConfirmResetAndSync}
        onCancel={onCloseResetModal}
      />

      <TgConfirmDialog
        open={confirmDeleteChannel !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseDeleteChannel()
        }}
        title="Remove Channel?"
        description={
          confirmDeleteChannel ? (
            <>
              You are about to remove{" "}
              <span className="font-bold text-app-ink">
                @{confirmDeleteChannel.name}
              </span>
              . This will also permanently delete all scraped posts associated
              with this channel from your local database.
            </>
          ) : (
            ""
          )
        }
        descriptionClassName="text-xs leading-relaxed text-app-ink/60"
        variant="destructive"
        confirmLabel="Delete Everything"
        footerClassName="sm:justify-between"
        confirmClassName="flex-1"
        cancelClassName="flex-1"
        onConfirm={onConfirmDeleteChannel}
        onCancel={onCloseDeleteChannel}
      >
        <div className="px-4 pt-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <ShieldAlert className="text-red-500" size={20} />
          </div>
        </div>
      </TgConfirmDialog>

      <TgConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={onBulkDeleteOpenChange}
        title="Remove Selected Channels?"
        description={
          <>
            You are about to remove{" "}
            <span className="font-bold text-app-ink">
              {selectedCount} selected channels
            </span>
            . This will also permanently delete all scraped posts associated
            with these channels from your local database.
          </>
        }
        descriptionClassName="text-xs leading-relaxed text-app-ink/60"
        variant="destructive"
        confirmLabel={`Delete ${selectedCount} Channels`}
        footerClassName="sm:justify-between"
        confirmClassName="flex-1"
        cancelClassName="flex-1"
        onConfirm={onConfirmBulkDelete}
        onCancel={() => onBulkDeleteOpenChange(false)}
      >
        <div className="px-4 pt-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10">
            <ShieldAlert className="text-red-500" size={20} />
          </div>
        </div>
      </TgConfirmDialog>

      <TgConfirmDialog
        open={confirmBulkFreezeAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseBulkFreezeAction()
        }}
        title={
          confirmBulkFreezeAction === "freeze"
            ? "Freeze Selected Channels?"
            : "Unfreeze Selected Channels?"
        }
        description={
          confirmBulkFreezeAction === "freeze"
            ? "Freeze all currently selected channels. They will be skipped during sync."
            : "Unfreeze all currently selected channels."
        }
        variant="dangerSoft"
        onConfirm={onConfirmBulkFreezeAction}
        onCancel={onCloseBulkFreezeAction}
      />
    </>
  )
}
