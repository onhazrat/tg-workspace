import { Minus, Plus } from "lucide-react"
import type React from "react"
import {
  controlGroupClassName,
  controlGroupItemClassName,
  controlGroupLabelClassName,
  controlRowItemClassName,
  controlSeparatorClassName,
} from "@/components/channel-grid/control-styles"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TgButton } from "@/components/ui/tg-button"
import { TgIconButton } from "@/components/ui/tg-icon-button"
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

/**
 * The two tag fields are identical twins, so they share one field/button spec.
 * They sit on the group pill's muted fill, so they take the same card surface as
 * the select next to them rather than fading into it.
 */
const bulkTagInputClassName = `${controlGroupItemClassName} w-40 rounded-md border-app-ink/15 bg-app-card/70 py-0 pl-2.5 pr-8 text-[10px] focus:ring-1`

const bulkTagButtonClassName =
  "absolute inset-y-0.5 right-0.5 h-auto w-6 rounded p-0 text-app-ink/60 hover:bg-app-ink/10 hover:text-app-ink"

/** Bulk action bar shown when channels are selected: freeze/unfreeze/delete, move to group, tag edits. */
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
    <div className="flex flex-col gap-3 border-t border-app-ink/5 pt-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap text-[10px] font-bold uppercase text-app-ink/70">
          {selectedCount} Selected
        </span>
        <div className={controlSeparatorClassName} />
        <TgButton
          type="button"
          variant="infoSoft"
          size="sm"
          onClick={onRequestFreeze}
          className={`${controlRowItemClassName} px-3`}
        >
          Freeze
        </TgButton>
        <TgButton
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRequestUnfreeze}
          className={`${controlRowItemClassName} px-3`}
        >
          Unfreeze
        </TgButton>
        <TgButton
          type="button"
          variant="dangerSoft"
          size="sm"
          onClick={onRequestDelete}
          className={`${controlRowItemClassName} px-3`}
        >
          Delete
        </TgButton>
        <div className={controlSeparatorClassName} />
        <div className={controlGroupClassName}>
          <span className={controlGroupLabelClassName}>Move to group</span>
          <Select
            value={bulkTargetGroupId}
            onValueChange={onBulkTargetGroupIdChange}
          >
            <SelectTrigger size="sm" className={selectTriggerClassName}>
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
            className={`${controlGroupItemClassName} px-2.5 text-[9px]`}
          >
            Apply
          </TgButton>
        </div>
        <div className={controlGroupClassName}>
          <span className={controlGroupLabelClassName}>Tags</span>
          <div className="relative">
            <TgInput
              type="text"
              variant="muted"
              value={bulkTagInput}
              onChange={(e) => onBulkTagInputChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onBulkAddTag()}
              placeholder="Add tag..."
              aria-label="Add tag to selected channels"
              data-testid="bulk-add-tag-input"
              className={bulkTagInputClassName}
            />
            <TgIconButton
              aria-label="Add tag to selected channels"
              tooltip="Add this tag to every selected channel"
              onClick={onBulkAddTag}
              disabled={!bulkTagInput.trim()}
              data-testid="bulk-add-tag-button"
              className={bulkTagButtonClassName}
            >
              <Plus size={12} />
            </TgIconButton>
          </div>
          <div className="relative">
            <TgInput
              type="text"
              variant="muted"
              value={bulkRemoveTagInput}
              onChange={(e) => onBulkRemoveTagInputChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onBulkRemoveTag()}
              placeholder="Remove tag..."
              aria-label="Remove tag from selected channels"
              data-testid="bulk-remove-tag-input"
              className={bulkTagInputClassName}
            />
            <TgIconButton
              aria-label="Remove tag from selected channels"
              tooltip="Remove this tag from every selected channel"
              onClick={onBulkRemoveTag}
              disabled={!bulkRemoveTagInput.trim()}
              data-testid="bulk-remove-tag-button"
              className={bulkTagButtonClassName}
            >
              <Minus size={12} />
            </TgIconButton>
          </div>
        </div>
      </div>
    </div>
  )
}
