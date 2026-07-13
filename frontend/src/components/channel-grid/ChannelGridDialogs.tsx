import { ShieldAlert } from "lucide-react"
import type React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
      <Dialog
        open={confirmResetModal !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseResetModal()
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Reset & Sync Channel
            </DialogTitle>
            <DialogDescription className="text-sm text-app-ink/70">
              {confirmResetModal
                ? `Clear all posts for @${confirmResetModal.name} and re-sync from ID ${confirmResetModal.startId ?? 1}?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4 sm:justify-end">
            <button
              type="button"
              onClick={onCloseResetModal}
              className="px-4 py-2 border border-app-ink/20 hover:bg-app-ink/5 transition-colors text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmResetAndSync}
              className="px-4 py-2 bg-red-500 text-white hover:bg-red-600 transition-colors text-sm font-medium"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmDeleteChannel !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseDeleteChannel()
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Remove Channel?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-app-ink/60">
              {confirmDeleteChannel ? (
                <>
                  You are about to remove{" "}
                  <span className="font-bold text-app-ink">
                    @{confirmDeleteChannel.name}
                  </span>
                  . This will also permanently delete all scraped posts
                  associated with this channel from your local database.
                </>
              ) : (
                ""
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 pt-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
          </div>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={onCloseDeleteChannel}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink/10 hover:bg-app-muted/50 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmDeleteChannel}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
            >
              Delete Everything
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmBulkDelete}
        onOpenChange={(nextOpen) => onBulkDeleteOpenChange(nextOpen)}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              Remove Selected Channels?
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed text-app-ink/60">
              You are about to remove{" "}
              <span className="font-bold text-app-ink">
                {selectedCount} selected channels
              </span>
              . This will also permanently delete all scraped posts associated
              with these channels from your local database.
            </DialogDescription>
          </DialogHeader>
          <div className="px-4 pt-4">
            <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center shrink-0">
              <ShieldAlert className="text-red-500" size={20} />
            </div>
          </div>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={() => onBulkDeleteOpenChange(false)}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest border border-app-ink/10 hover:bg-app-muted/50 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmBulkDelete}
              className="flex-1 px-4 py-2 text-[10px] font-bold uppercase tracking-widest bg-red-500 text-white hover:bg-red-600 transition-all shadow-lg shadow-red-500/20"
            >
              Delete {selectedCount} Channels
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={confirmBulkFreezeAction !== null}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) onCloseBulkFreezeAction()
        }}
      >
        <DialogContent className="border-app-ink/20 bg-app-card p-0 text-app-ink sm:max-w-md">
          <DialogHeader className="border-b border-app-ink/10 p-4">
            <DialogTitle className="text-lg font-bold tracking-tight">
              {confirmBulkFreezeAction === "freeze"
                ? "Freeze Selected Channels?"
                : "Unfreeze Selected Channels?"}
            </DialogTitle>
            <DialogDescription className="text-sm text-app-ink/70">
              {confirmBulkFreezeAction === "freeze"
                ? "Freeze all currently selected channels. They will be skipped during sync."
                : "Unfreeze all currently selected channels."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="border-t border-app-ink/10 bg-app-muted/30 p-4">
            <button
              type="button"
              onClick={onCloseBulkFreezeAction}
              className="rounded-md border border-app-ink/20 px-3 py-2 text-xs font-mono uppercase tracking-widest hover:bg-app-ink/5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirmBulkFreezeAction}
              className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs font-mono uppercase tracking-widest text-red-600 hover:bg-red-500/20"
            >
              Confirm
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
