/**
 * PROTOTYPE B, "Tabbed deck". The chip walls stay visible chips, but only one
 * drawer is open at a time (Groups, Tags, Sort & view, AI context), and the
 * group filter is an explicit toggle instead of cmd-click. Selection turns on
 * an inverted, sticky action strip.
 */
import {
  ArrowDown,
  ArrowUp,
  Filter,
  Layers,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Tag,
  X,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { ChannelTagChips } from "@/components/channel-grid/ChannelTagChips"
import { TgButton } from "@/components/ui/tg-button"
import { TgSelectionChip } from "@/components/ui/tg-chips"
import { TgInput } from "@/components/ui/tg-input"
import { getChannelNamesInGroup } from "@/lib/channels/channel-grid-chips"
import { cn } from "@/lib/utils"
import {
  type ChannelControlsProps,
  chipSelection,
  sortOptionsFor,
} from "./types"
import { ZoomStepper } from "./VariantA"

type Drawer = "groups" | "tags" | "view" | "ai"

const tabClass = (open: boolean) =>
  cn(
    "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-[11px] font-bold transition-colors",
    open
      ? "bg-app-ink text-app-bg"
      : "text-app-ink/60 hover:bg-app-ink/5 hover:text-app-ink",
  )

const inverseButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-bg/80 hover:bg-app-bg/15 hover:text-app-bg disabled:opacity-40"

export const VariantB: React.FC<ChannelControlsProps> = (p) => {
  const [drawer, setDrawer] = useState<Drawer | null>("groups")
  const toggle = (d: Drawer) => setDrawer((cur) => (cur === d ? null : d))
  const selectedCount = p.selectedChannels.size

  return (
    <>
      <div className="rounded-xl border border-app-ink/10 bg-app-card shadow-sm">
        {/* Row 1: primary actions */}
        <div className="flex flex-wrap items-center gap-2 p-3">
          <form
            className="relative min-w-[220px] flex-1"
            id="tour-add-channel"
            onSubmit={(e) => {
              e.preventDefault()
              p.onAddChannel()
            }}
          >
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-bold text-app-ink/40">
              @
            </span>
            <TgInput
              variant="muted"
              value={p.inlineChannelName}
              onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
              placeholder="Follow a channel"
              className="h-9 py-0 pl-8 pr-16"
            />
            <TgButton
              type="submit"
              size="sm"
              disabled={!p.inlineChannelName.trim()}
              className="absolute inset-y-1 right-1 h-auto px-3"
            >
              Add
            </TgButton>
          </form>
          <div className="relative min-w-[220px] flex-[2]">
            <Search
              size={14}
              className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
            />
            <TgInput
              variant="muted"
              value={p.channelSearch}
              onChange={(e) => p.onChannelSearchChange(e.target.value)}
              placeholder="Search channels"
              className="h-9 py-0 pl-9"
            />
          </div>
          <TgButton
            variant="secondary"
            size="sm"
            className="h-9 gap-1.5"
            onClick={p.onScrapeSelected}
            disabled={p.isScrapeSelectedDisabled}
            loading={p.isScraping}
          >
            <RefreshCw size={13} />
            Sync selected
          </TgButton>
          <TgButton
            size="sm"
            className="h-9 gap-1.5"
            onClick={p.onScrapeAll}
            disabled={p.isScrapeAllDisabled}
            loading={p.isScraping}
          >
            <RefreshCw size={13} />
            Sync all
          </TgButton>
        </div>

        {/* Row 2: drawer tabs + status */}
        <div className="flex flex-wrap items-center gap-1 border-t border-app-ink/10 px-3 py-2">
          <button
            type="button"
            className={tabClass(drawer === "groups")}
            onClick={() => toggle("groups")}
          >
            <Layers size={12} /> Groups
            <span className="opacity-50">{p.groups.length}</span>
          </button>
          <button
            type="button"
            className={tabClass(drawer === "tags")}
            onClick={() => toggle("tags")}
          >
            <Tag size={12} /> Tags
            <span className="opacity-50">
              {p.visibleTags.length + p.pseudoTagChips.length}
            </span>
          </button>
          <button
            type="button"
            className={tabClass(drawer === "view")}
            onClick={() => toggle("view")}
          >
            Sort & view
          </button>
          <button
            type="button"
            className={tabClass(drawer === "ai")}
            onClick={() => toggle("ai")}
          >
            AI context
            {(p.includeChannelBioInPrompt || p.includeChannelTagsInPrompt) && (
              <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
            )}
          </button>
          <div className="ml-auto flex items-center gap-3 text-[11px] font-semibold text-app-ink/60">
            <span>
              {p.isFilteringActive
                ? `Showing ${p.filteredCount} of ${p.totalCount}`
                : `${p.totalCount} channels`}
            </span>
            <span className="flex items-center gap-1">
              Select
              <button
                type="button"
                onClick={p.onSelectAll}
                className="rounded px-1.5 py-0.5 text-app-ink hover:bg-app-ink/10"
              >
                all
              </button>
              <button
                type="button"
                onClick={p.onUnselectAll}
                className="rounded px-1.5 py-0.5 text-app-ink hover:bg-app-ink/10"
              >
                none
              </button>
              <button
                type="button"
                onClick={p.onRevertSelection}
                disabled={p.isRevertDisabled}
                className="rounded px-1.5 py-0.5 text-app-ink hover:bg-app-ink/10 disabled:opacity-40"
              >
                invert
              </button>
            </span>
          </div>
        </div>

        {/* Drawer */}
        {drawer && (
          <div className="border-t border-app-ink/10 bg-app-muted/30 px-3 py-3">
            {drawer === "groups" && (
              <div className="flex flex-wrap gap-2">
                {p.groups.map((g) => {
                  const names = getChannelNamesInGroup(p.channels, g.id)
                  const s = chipSelection(names, p.selectedChannels)
                  const filtering = p.activeGroupFilter === g.id
                  return (
                    <span key={g.id} className="inline-flex">
                      <TgSelectionChip
                        state={s.state}
                        onClick={() => p.onToggleGroupSelection(g.id)}
                        className="rounded-r-none"
                      >
                        <Layers size={10} />
                        {g.name}
                        <span className="text-[8px] opacity-60">
                          {s.selectedCount}/{s.total}
                        </span>
                      </TgSelectionChip>
                      <button
                        type="button"
                        title={
                          filtering ? "Show all groups" : "Show only this group"
                        }
                        onClick={() =>
                          p.onSetGroupFilter(filtering ? "" : g.id)
                        }
                        className={cn(
                          "-ml-px grid w-7 place-items-center rounded-r-full border",
                          filtering
                            ? "border-indigo-500 bg-indigo-500 text-white"
                            : "border-app-ink/10 bg-app-muted text-app-ink/40 hover:text-app-ink",
                        )}
                      >
                        <Filter size={10} />
                      </button>
                    </span>
                  )
                })}
              </div>
            )}
            {drawer === "tags" && (
              <div className="space-y-3">
                <TgInput
                  variant="muted"
                  value={p.tagSearch}
                  onChange={(e) => p.onTagSearchChange(e.target.value)}
                  placeholder="Filter tags"
                  data-testid="channel-tag-search"
                  className="h-8 max-w-xs py-0 text-[11px]"
                />
                <ChannelTagChips
                  channels={p.channels}
                  selectedChannels={p.selectedChannels}
                  visibleTags={p.visibleTags}
                  pseudoTagChips={p.pseudoTagChips}
                  onToggleTag={p.onToggleTag}
                />
              </div>
            )}
            {drawer === "view" && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-[10px] font-bold uppercase tracking-widest text-app-ink/45">
                    Sort
                  </span>
                  {sortOptionsFor(p.showChannelSubscribers).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() => p.onSortByChange(o.value)}
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[10px] font-semibold",
                        p.sortBy === o.value
                          ? "border-app-ink bg-app-ink text-app-bg"
                          : "border-app-ink/10 hover:border-app-ink/30",
                      )}
                    >
                      {o.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={p.onToggleSortDirection}
                    className="inline-flex items-center gap-1 rounded-full border border-app-ink/10 px-2.5 py-1 text-[10px] font-semibold hover:border-app-ink/30"
                  >
                    {p.sortDirection === "asc" ? (
                      <ArrowUp size={11} />
                    ) : (
                      <ArrowDown size={11} />
                    )}
                    {p.sortDirection === "asc" ? "Ascending" : "Descending"}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[11px] font-semibold">
                  {p.allLanguages.length > 0 && (
                    <label className="flex items-center gap-2">
                      Language
                      <select
                        value={p.selectedLanguageFilter}
                        onChange={(e) =>
                          p.onLanguageFilterChange(e.target.value)
                        }
                        className="h-7 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px]"
                      >
                        <option value="">All</option>
                        {p.allLanguages.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={p.groupBySelection}
                      onChange={p.onToggleGroupBySelection}
                      className="accent-app-ink"
                    />
                    Selected first, frozen last
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={p.showSortRank}
                      onChange={(e) => p.onShowSortRankChange(e.target.checked)}
                      data-testid="channel-show-sort-rank"
                      className="accent-app-ink"
                    />
                    Show sort rank
                  </label>
                  <span className="flex items-center gap-2">
                    Card size
                    <ZoomStepper zoom={p.zoom} onZoomChange={p.onZoomChange} />
                  </span>
                </div>
              </div>
            )}
            {drawer === "ai" && (
              <div className="grid gap-2 sm:grid-cols-2">
                <AiToggle
                  checked={p.includeChannelBioInPrompt}
                  onChange={p.onIncludeChannelBioInPromptChange}
                  title="Include channel bio"
                  body="Adds each channel's Telegram description to AI prompts."
                />
                <AiToggle
                  checked={p.includeChannelTagsInPrompt}
                  onChange={p.onIncludeChannelTagsInPromptChange}
                  title="Include current tags"
                  body="Adds each channel's current tags to AI prompts."
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selection strip */}
      {selectedCount > 0 && (
        <div className="sticky top-2 z-20 -mt-4 flex flex-wrap items-center gap-1 rounded-xl bg-app-ink px-3 py-2 text-app-bg shadow-lg">
          <button
            type="button"
            onClick={p.onUnselectAll}
            className="mr-1 inline-flex h-8 items-center gap-1.5 rounded-md bg-app-bg/15 px-2.5 text-[11px] font-bold"
          >
            <X size={12} /> {selectedCount} selected
          </button>
          <span className="flex items-center gap-1 text-[11px] text-app-bg/70">
            keep first
            <input
              type="number"
              min={1}
              value={p.trimCount}
              onChange={(e) => p.onTrimCountChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && p.onTrimSelection()}
              data-testid="channel-trim-count"
              aria-label="Trim selection count"
              className="h-7 w-12 rounded bg-app-bg/15 text-center text-app-bg outline-none"
            />
            <button
              type="button"
              className={inverseButton}
              onClick={p.onTrimSelection}
              disabled={p.isTrimDisabled}
              data-testid="channel-trim-button"
            >
              Trim
            </button>
          </span>
          <div className="mx-1 h-5 w-px bg-app-bg/20" />
          <button
            type="button"
            className={inverseButton}
            onClick={p.onRequestFreeze}
          >
            Freeze
          </button>
          <button
            type="button"
            className={inverseButton}
            onClick={p.onRequestUnfreeze}
          >
            Unfreeze
          </button>
          <div className="mx-1 h-5 w-px bg-app-bg/20" />
          <span className="flex items-center gap-1">
            <select
              value={p.bulkTargetGroupId}
              onChange={(e) => p.onBulkTargetGroupIdChange(e.target.value)}
              className="h-8 rounded-md bg-app-bg/15 px-2 text-[11px] text-app-bg"
            >
              {p.groups.map((g) => (
                <option key={g.id} value={g.id} className="text-black">
                  {g.name}
                  {g.isDefault ? " (default)" : ""}
                </option>
              ))}
            </select>
            <button
              type="button"
              className={inverseButton}
              onClick={p.onApplyMoveToGroup}
            >
              Move
            </button>
          </span>
          <div className="mx-1 h-5 w-px bg-app-bg/20" />
          <span className="flex items-center gap-1">
            <input
              value={p.bulkTagInput}
              onChange={(e) => p.onBulkTagInputChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && p.onBulkAddTag()}
              placeholder="tag"
              data-testid="bulk-add-tag-input"
              className="h-8 w-28 rounded-md bg-app-bg/15 px-2 text-[11px] text-app-bg outline-none placeholder:text-app-bg/40"
            />
            <button
              type="button"
              title="Add tag to selected"
              className={inverseButton}
              onClick={p.onBulkAddTag}
              disabled={!p.bulkTagInput.trim()}
            >
              <Plus size={12} />
            </button>
            <input
              value={p.bulkRemoveTagInput}
              onChange={(e) => p.onBulkRemoveTagInputChange(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && p.onBulkRemoveTag()}
              placeholder="tag"
              data-testid="bulk-remove-tag-input"
              className="h-8 w-28 rounded-md bg-app-bg/15 px-2 text-[11px] text-app-bg outline-none placeholder:text-app-bg/40"
            />
            <button
              type="button"
              title="Remove tag from selected"
              className={inverseButton}
              onClick={p.onBulkRemoveTag}
              disabled={!p.bulkRemoveTagInput.trim()}
            >
              <Minus size={12} />
            </button>
          </span>
          <button
            type="button"
            onClick={p.onRequestDelete}
            className="ml-auto inline-flex h-8 items-center rounded-md bg-red-500 px-3 text-[11px] font-bold text-white hover:bg-red-600"
          >
            Delete
          </button>
        </div>
      )}
    </>
  )
}

const AiToggle: React.FC<{
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  body: string
}> = ({ checked, onChange, title, body }) => (
  <label
    className={cn(
      "flex cursor-pointer gap-3 rounded-lg border p-3",
      checked ? "border-app-ink/40 bg-app-card" : "border-app-ink/10",
    )}
  >
    <input
      type="checkbox"
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="mt-0.5 accent-app-ink"
    />
    <span>
      <span className="block text-[12px] font-bold">{title}</span>
      <span className="block text-[11px] text-app-ink/60">{body}</span>
    </span>
  </label>
)
