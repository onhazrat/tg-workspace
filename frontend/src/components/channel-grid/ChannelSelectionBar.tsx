import {
  ChevronDown,
  Hash,
  Layers,
  RefreshCw,
  Snowflake,
  Square,
  Sun,
  Trash2,
  X,
} from "lucide-react"
import { Popover } from "radix-ui"
import type React from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { TgButton } from "@/components/ui/tg-button"
import type { TagSuggestion } from "@/lib/channels/bulk-tag-suggestions"
import type { CardZoom } from "@/lib/channels/card-zoom"
import {
  type ActionLimit,
  actionTargets,
} from "@/lib/channels/selection-regions"
import type { ChannelSettingGroup } from "@/types"
import { BarToggle, CardSizeSwitch } from "./ChannelBarControls"
import {
  ActionLimitIndicator,
  ChannelSelectionAdjust,
} from "./ChannelSelectionAdjust"
import { TagCompletionField } from "./TagCompletionField"

export type ChannelSelectionBarProps = {
  selection: ReadonlySet<string>
  /** The Shown Channels' names. */
  shown: string[]
  onSelectAll: () => void
  onSetSelection: (next: Set<string>) => void
  actionLimit: ActionLimit
  onActionLimitChange: (limit: ActionLimit) => void
  onClear: () => void
  trimCount: string
  onTrimCountChange: (value: string) => void
  onTrim: () => void
  isTrimDisabled: boolean
  onSync: () => void
  isSyncDisabled: boolean
  isSyncing: boolean
  /** A Sync selected job is running, so Sync becomes Stop sync. */
  syncJobRunning: boolean
  onStopSync: () => void
  onFreeze: () => void
  onUnfreeze: () => void
  onDelete: () => void
  settingGroups: ChannelSettingGroup[]
  moveTargetId: string
  onMoveTargetChange: (id: string) => void
  onMove: () => void
  tagInput: string
  onTagInputChange: (value: string) => void
  onAddTag: () => void
  removeTagInput: string
  onRemoveTagInputChange: (value: string) => void
  onRemoveTag: () => void
  /** What the two tag fields complete to, from the Channels actions reach. */
  tagSuggestions: { add: TagSuggestion[]; remove: TagSuggestion[] }
  groupBySelection: boolean
  onToggleGroupBySelection: () => void
  showSortRank: boolean
  onShowSortRankChange: (value: boolean) => void
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
  /** Keyboard mode, a switch for the browser session. */
  keyboard: boolean
  onKeyboardChange: (on: boolean) => void
}

const actionClass =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-ink/80 hover:bg-app-ink/10 hover:text-app-ink disabled:opacity-40"

const plural = (n: number) => `${n} channel${n === 1 ? "" : "s"}`

/** Stops the running Sync selected job, which outlives the selection it started from. */
const StopSync = ({ onStopSync }: { onStopSync: () => void }) => (
  <button
    type="button"
    onClick={onStopSync}
    data-testid="channel-sync-selected-stop"
    className={actionClass}
  >
    <Square size={11} className="fill-current" />
    Stop sync
  </button>
)

/** The bulk toolbar: what reaches the selected Channels. */
function SelectionActions(p: ChannelSelectionBarProps) {
  const actionCount = actionTargets(p.selection, p.shown, p.actionLimit).size
  const count = plural(actionCount)
  const narrowed = actionCount < p.selection.size
  // Every selected Channel hidden, on Shown: nothing for an action to reach.
  const idle = actionCount === 0
  return (
    <>
      <ChannelSelectionAdjust
        selection={p.selection}
        shown={p.shown}
        onApply={p.onSetSelection}
        limit={p.actionLimit}
        onLimitChange={p.onActionLimitChange}
      />
      <ActionLimitIndicator
        selection={p.selection}
        shown={p.shown}
        limit={p.actionLimit}
        onLimitChange={p.onActionLimitChange}
      />
      <div className="flex items-center gap-1 rounded-md border border-app-ink/10 pl-2">
        <span className="text-[11px] font-semibold text-app-ink/50">
          Keep first
        </span>
        <input
          type="number"
          min={1}
          value={p.trimCount}
          onChange={(e) => p.onTrimCountChange(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && p.onTrim()}
          data-testid="channel-trim-count"
          aria-label="Trim selection count"
          className="h-7 w-12 bg-transparent text-center text-[11px] outline-none"
        />
        {narrowed && (
          <span className="text-[11px] font-semibold text-app-ink/50">
            shown
          </span>
        )}
        <button
          type="button"
          onClick={p.onTrim}
          disabled={p.isTrimDisabled}
          data-testid="channel-trim-button"
          title="Keep the first N selected channels by the current sort"
          className={`${actionClass} h-7`}
        >
          Trim
        </button>
      </div>
      {p.syncJobRunning ? (
        <StopSync onStopSync={p.onStopSync} />
      ) : (
        <button
          type="button"
          onClick={p.onSync}
          disabled={p.isSyncDisabled || p.isSyncing}
          className={actionClass}
        >
          <RefreshCw size={12} className={p.isSyncing ? "animate-spin" : ""} />
          Sync
        </button>
      )}
      <button
        type="button"
        onClick={p.onFreeze}
        disabled={idle}
        className={actionClass}
      >
        <Snowflake size={12} /> Freeze
      </button>
      <button
        type="button"
        onClick={p.onUnfreeze}
        disabled={idle}
        className={actionClass}
      >
        <Sun size={12} /> Unfreeze
      </button>
      <BarPopover
        width="w-60"
        trigger={
          <button type="button" disabled={idle} className={actionClass}>
            <Layers size={12} /> Move to group
            <ChevronDown size={11} className="opacity-50" />
          </button>
        }
      >
        <BarHeading>Move {count} to</BarHeading>
        {p.settingGroups.map((group) => (
          <button
            key={group.id}
            type="button"
            aria-pressed={p.moveTargetId === group.id}
            onClick={() => p.onMoveTargetChange(group.id)}
            className={`block w-full rounded-md px-2 py-1.5 text-left hover:bg-app-ink/5 ${p.moveTargetId === group.id ? "font-semibold" : "text-app-ink/70"}`}
          >
            {group.name}
            {group.isDefault ? " (default)" : ""}
          </button>
        ))}
        <Popover.Close asChild>
          <TgButton size="sm" className="mt-2 w-full" onClick={p.onMove}>
            Move
          </TgButton>
        </Popover.Close>
      </BarPopover>
      <BarPopover
        width="w-64"
        trigger={
          <button
            type="button"
            data-testid="bulk-tags"
            disabled={idle}
            className={actionClass}
          >
            <Hash size={12} /> Tags
            <ChevronDown size={11} className="opacity-50" />
          </button>
        }
      >
        <BarHeading>Add to {count}</BarHeading>
        <TagCompletionField
          label="Add tag to selected channels"
          button="Add"
          value={p.tagInput}
          onChange={p.onTagInputChange}
          onSubmit={p.onAddTag}
          suggestions={p.tagSuggestions.add}
          testId="bulk-add-tag"
        />
        <BarHeading>Remove from {count}</BarHeading>
        <TagCompletionField
          label="Remove tag from selected channels"
          button="Remove"
          value={p.removeTagInput}
          onChange={p.onRemoveTagInputChange}
          onSubmit={p.onRemoveTag}
          suggestions={p.tagSuggestions.remove}
          testId="bulk-remove-tag"
        />
      </BarPopover>
      <button
        type="button"
        onClick={p.onDelete}
        disabled={idle}
        className={`${actionClass} text-red-500 hover:bg-red-500/10 hover:text-red-500`}
      >
        <Trash2 size={12} /> Delete
      </button>
    </>
  )
}

const Ghost = (props: React.ComponentProps<typeof TgButton>) => (
  <TgButton type="button" variant="ghost" size="sm" {...props} />
)

/**
 * Row 2 (CTB-01): a summary with Select all while nothing is selected, the
 * bulk toolbar once something is, and the layout toggles and card size at its
 * right end in both states, so nothing moves on a select. Adjust selection
 * (CTB-04) holds what All and Invert used to do once something is selected.
 */
export function ChannelSelectionBar(p: ChannelSelectionBarProps) {
  const selecting = p.selection.size > 0
  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1 border-t border-app-ink/10 px-3 py-1.5">
      {selecting ? (
        <button
          type="button"
          onClick={p.onClear}
          aria-label="Clear selection"
          title="Clear selection"
          className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-app-ink px-2.5 text-[11px] font-bold text-app-bg"
        >
          <span>{p.selection.size} selected</span>
          <X size={12} />
        </button>
      ) : (
        <>
          <span
            data-testid="channel-selection-summary"
            className="mr-1 text-[11px] font-semibold text-app-ink/60"
          >
            {plural(p.shown.length)}
          </span>
          <Ghost onClick={p.onSelectAll} disabled={p.shown.length === 0}>
            Select all
          </Ghost>
        </>
      )}
      {selecting ? (
        <SelectionActions {...p} />
      ) : (
        p.syncJobRunning && <StopSync onStopSync={p.onStopSync} />
      )}
      <div className="ml-auto flex flex-wrap items-center gap-1.5 pl-2">
        <BarToggle
          on={p.groupBySelection}
          onClick={p.onToggleGroupBySelection}
          label="Selected first"
          title="Selected channels first, frozen last"
        />
        <BarToggle
          on={p.showSortRank}
          onClick={() => p.onShowSortRankChange(!p.showSortRank)}
          label="Sort rank"
          title="Number each selected card by its place in the sort"
          testId="channel-show-sort-rank"
        />
        <BarToggle
          on={p.keyboard}
          onClick={() => p.onKeyboardChange(!p.keyboard)}
          label="Keyboard"
          title="j / k to move, gg / G to jump, an action's letter to fire it"
          testId="channel-keyboard"
        />
        <CardSizeSwitch zoom={p.zoom} onZoomChange={p.onZoomChange} />
      </div>
    </div>
  )
}
