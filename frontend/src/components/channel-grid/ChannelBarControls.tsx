import {
  ChevronDown,
  Grid2x2,
  Grid3x3,
  LayoutGrid,
  LayoutList,
  RefreshCw,
  Sparkles,
  Square,
} from "lucide-react"
import { useState } from "react"
import { BarHeading, BarPopover } from "@/components/BarPopover"
import { SortPicker } from "@/components/filter-tree/SortPicker"
import { pillClass } from "@/components/PostFilterParts"
import { TgButton } from "@/components/ui/tg-button"
import { TgConfirmDialog } from "@/components/ui/tg-confirm-dialog"
import { TgIconButton } from "@/components/ui/tg-icon-button"
import type { CardZoom } from "@/lib/channels/card-zoom"
import { syncAllConfirmation } from "@/lib/channels/manual-sync"
import type { ChannelGridSortOption } from "@/lib/channels/sort-channels-for-grid"
import type { Channel } from "@/types"

const SORT_OPTIONS: { value: ChannelGridSortOption; label: string }[] = [
  { value: "last_updated", label: "Last updated" },
  { value: "followed_at", label: "Followed at" },
  { value: "activity_rate", label: "Activity rate" },
  { value: "reach", label: "Reach" },
  { value: "total_posts", label: "Total posts" },
  { value: "posts_in_scope", label: "Posts in scope" },
  { value: "channel_id", label: "Channel ID" },
  { value: "channel_name", label: "Channel name" },
  { value: "next_regular_sync", label: "Next regular sync" },
  { value: "next_dynamic_sync", label: "Next dynamic sync" },
  { value: "next_auto_sync", label: "Next auto sync" },
  { value: "subscribers", label: "Subscribers" },
]

/** The Channels tab's Sort menu; Subscribers only when the setting shows them. */
export function SortMenu({
  sortBy,
  onSortByChange,
  sortDirection,
  onToggleSortDirection,
  showSubscribers,
}: {
  sortBy: ChannelGridSortOption
  onSortByChange: (value: ChannelGridSortOption) => void
  sortDirection: "asc" | "desc"
  onToggleSortDirection: () => void
  showSubscribers: boolean
}) {
  return (
    <SortPicker
      options={SORT_OPTIONS.filter(
        (option) => showSubscribers || option.value !== "subscribers",
      )}
      value={sortBy}
      onChange={onSortByChange}
      direction={sortDirection}
      onToggleDirection={onToggleSortDirection}
      testId="channel-sort"
    />
  )
}

/** The two AI prompt settings, and how many of them are on. */
export function AiContextPill({
  includeBio,
  onIncludeBioChange,
  includeTags,
  onIncludeTagsChange,
}: {
  includeBio: boolean
  onIncludeBioChange: (value: boolean) => void
  includeTags: boolean
  onIncludeTagsChange: (value: boolean) => void
}) {
  const on = Number(includeBio) + Number(includeTags)
  const check = (
    label: string,
    checked: boolean,
    onChange: (value: boolean) => void,
  ) => (
    <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-app-ink/5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-app-ink"
      />
      {label}
    </label>
  )
  return (
    <BarPopover
      align="end"
      trigger={
        <button
          type="button"
          data-testid="channel-ai-context"
          data-active={on > 0}
          className={pillClass(on > 0)}
        >
          <Sparkles size={12} /> AI context
          {on > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {on}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      <BarHeading>What AI prompts read about each channel</BarHeading>
      {check("Channel bio", includeBio, onIncludeBioChange)}
      {check("Current tags", includeTags, onIncludeTagsChange)}
    </BarPopover>
  )
}

const SIZES: { zoom: CardZoom; label: string; Icon: typeof Grid3x3 }[] = [
  { zoom: -2, label: "Tiles", Icon: Grid3x3 },
  { zoom: -1, label: "Compact cards", Icon: LayoutGrid },
  { zoom: 0, label: "Cards", Icon: Grid2x2 },
  { zoom: 1, label: "Detailed cards", Icon: LayoutList },
]

/** The card zoom setting as a visible four-way switch. */
export function CardSizeSwitch({
  zoom,
  onZoomChange,
}: {
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
}) {
  return (
    <fieldset
      aria-label="Card size"
      className="m-0 inline-flex items-center gap-0.5 rounded-lg border border-app-ink/10 bg-app-muted/50 p-0.5"
    >
      {SIZES.map(({ zoom: size, label, Icon }) => (
        <TgIconButton
          key={size}
          aria-label={label}
          tooltip={label}
          aria-pressed={zoom === size}
          onClick={() => onZoomChange(size)}
          className={
            zoom === size
              ? "bg-app-ink text-app-bg hover:bg-app-ink hover:text-app-bg"
              : undefined
          }
        >
          <Icon size={13} />
        </TgIconButton>
      ))}
    </fieldset>
  )
}

/** A layout setting as an on/off pill. */
export function BarToggle({
  on,
  onClick,
  label,
  title,
  testId,
}: {
  on: boolean
  onClick: () => void
  label: string
  title: string
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-semibold ${
        on
          ? "border-app-ink/50 bg-app-ink/10 text-app-ink"
          : "border-app-ink/10 text-app-ink/50 hover:text-app-ink"
      }`}
    >
      <span
        aria-hidden
        className={`h-1.5 w-1.5 rounded-full ${on ? "bg-green-500" : "bg-app-ink/25"}`}
      />
      {label}
    </button>
  )
}

/**
 * Sync all, which asks first with the count it will send. While its job runs
 * the button is Stop sync, which stops at once: stopping keeps what already
 * synced, so it needs no confirmation.
 */
export function SyncAllButton({
  channels,
  onSync,
  running,
  onStop,
  disabled,
  loading,
}: {
  channels: Channel[]
  onSync: () => void
  /** A Sync All job is running, so the button stops it. */
  running: boolean
  onStop: () => void
  disabled: boolean
  loading: boolean
}) {
  const [asking, setAsking] = useState(false)
  if (running) {
    return (
      <TgButton
        type="button"
        size="sm"
        variant="secondary"
        onClick={onStop}
        data-testid="channel-sync-all-stop"
        className="h-9"
      >
        <Square size={11} className="fill-current" />
        Stop sync
      </TgButton>
    )
  }
  return (
    <>
      <TgButton
        type="button"
        size="sm"
        onClick={() => setAsking(true)}
        disabled={disabled}
        loading={loading}
        className="h-9"
      >
        <RefreshCw size={12} />
        Sync all
      </TgButton>
      <TgConfirmDialog
        open={asking}
        onOpenChange={setAsking}
        title="Sync All Channels?"
        description={syncAllConfirmation(channels).description}
        confirmLabel="Sync"
        confirmTestId="channel-sync-all-confirm"
        onConfirm={() => {
          setAsking(false)
          onSync()
        }}
      />
    </>
  )
}
