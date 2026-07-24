import type React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { selectTriggerClassName } from "@/components/ui/tg-select-trigger"
import type { ChannelSettingGroup } from "@/types"

type ChannelBulkActionsProps = {
  selectedCount: number
  onRequestFreeze: () => void
  onRequestUnfreeze: () => void
  settingGroups: ChannelSettingGroup[]
  bulkTargetGroupId: string
  onBulkTargetGroupIdChange: (value: string) => void
  onApplyMoveToGroup: () => void
  bulkTagInput: string
  onBulkTagInputChange: (value: string) => void
  onBulkAddTag: () => void
  bulkRemoveTagInput: string
  onBulkRemoveTagInputChange: (value: string) => void
  onBulkRemoveTag: () => void
  onRequestDelete: () => void
}

/** Bulk action bar shown when channels are selected: freeze, move to group, tag edits, delete. */
export const ChannelBulkActions: React.FC<ChannelBulkActionsProps> = ({
  selectedCount,
  onRequestFreeze,
  onRequestUnfreeze,
  settingGroups,
  bulkTargetGroupId,
  onBulkTargetGroupIdChange,
  onApplyMoveToGroup,
  bulkTagInput,
  onBulkTagInputChange,
  onBulkAddTag,
  bulkRemoveTagInput,
  onBulkRemoveTagInputChange,
  onBulkRemoveTag,
  onRequestDelete,
}) => {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-app-ink/5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[10px] uppercase font-bold text-app-ink/70">
          {selectedCount} Selected
        </span>
        <div className="h-4 w-px bg-app-ink/10 mx-1" />
        <TgButton
          type="button"
          variant="infoSoft"
          size="sm"
          onClick={onRequestFreeze}
        >
          Freeze
        </TgButton>
        <TgButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRequestUnfreeze}
        >
          Unfreeze
        </TgButton>
        <div className="h-4 w-px bg-app-ink/10 mx-1" />
        <div className="flex items-center gap-2 rounded-md border border-app-ink/10 bg-app-muted/40 px-2 py-1.5">
          <span className="text-[9px] uppercase font-bold text-app-ink/60">
            Move to group
          </span>
          <Select
            value={bulkTargetGroupId}
            onValueChange={onBulkTargetGroupIdChange}
          >
            <SelectTrigger className={selectTriggerClassName}>
              <SelectValue placeholder="Group" />
            </SelectTrigger>
            <SelectContent>
              {settingGroups.map((group) => (
                <SelectItem key={group.id} value={group.id}>
                  {group.name}
                  {group.isDefault ? " (default)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <TgButton
            type="button"
            variant="primary"
            size="sm"
            onClick={onApplyMoveToGroup}
            className="px-2 text-[9px]"
          >
            Apply
          </TgButton>
        </div>
        <div className="relative">
          <TgInput
            type="text"
            variant="muted"
            value={bulkTagInput}
            onChange={(e) => onBulkTagInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onBulkAddTag()}
            placeholder="Add tag..."
            className="h-8 w-36 rounded-md py-0 pl-2.5 pr-16 text-[10px] focus:ring-1"
          />
          <TgButton
            type="button"
            variant="primary"
            size="sm"
            onClick={onBulkAddTag}
            disabled={!bulkTagInput.trim()}
            className="absolute inset-y-1 right-1 h-auto min-w-[3.25rem] px-2 text-[8px] tracking-normal"
          >
            Add
          </TgButton>
        </div>
        <div className="relative">
          <TgInput
            type="text"
            variant="muted"
            value={bulkRemoveTagInput}
            onChange={(e) => onBulkRemoveTagInputChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onBulkRemoveTag()}
            placeholder="Remove tag..."
            className="h-8 w-36 rounded-md py-0 pl-2.5 pr-16 text-[10px] focus:ring-1"
          />
          <TgButton
            type="button"
            variant="primary"
            size="sm"
            onClick={onBulkRemoveTag}
            disabled={!bulkRemoveTagInput.trim()}
            className="absolute inset-y-1 right-1 h-auto min-w-[3.25rem] px-2 text-[8px] tracking-normal"
          >
            Remove
          </TgButton>
        </div>
        <TgButton
          type="button"
          variant="dangerSoft"
          size="sm"
          onClick={onRequestDelete}
        >
          Delete
        </TgButton>
      </div>
    </div>
  )
}
