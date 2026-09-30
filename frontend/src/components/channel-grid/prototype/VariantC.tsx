/**
 * PROTOTYPE C, "Sentence + action rail". What you see reads as one sentence of
 * inline selects; groups and tags are a single-line quick-select strip; the
 * action rail is always present (disabled at zero) so nothing jumps when the
 * selection changes, and a meter shows how much of the grid is selected.
 */
import {
  ArrowDown,
  ArrowUp,
  Layers,
  Minus,
  Plus,
  RefreshCw,
  Scissors,
  Settings2,
  Snowflake,
  Sun,
  Tag,
  Trash2,
} from "lucide-react"
import type React from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgSelectionChip } from "@/components/ui/tg-chips"
import {
  getChannelNamesInGroup,
  getChannelNamesWithTag,
} from "@/lib/channels/channel-grid-chips"
import { cn } from "@/lib/utils"
import { Check, Pop, PopLabel } from "./Pop"
import {
  type ChannelControlsProps,
  chipSelection,
  sortOptionsFor,
} from "./types"
import { InlineField, ZoomStepper } from "./VariantA"

const inlineSelect =
  "mx-1 inline-flex h-7 cursor-pointer appearance-none items-center rounded-md border-b-2 border-app-ink/30 bg-app-ink/5 px-2 text-[13px] font-bold text-app-ink outline-none hover:border-app-ink"
const rail =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-ink/80 hover:bg-app-ink/10 hover:text-app-ink disabled:pointer-events-none disabled:opacity-35"

export const VariantC: React.FC<ChannelControlsProps> = (p) => {
  const selectedCount = p.selectedChannels.size
  const none = selectedCount === 0
  const pct = p.totalCount ? (selectedCount / p.totalCount) * 100 : 0

  return (
    <>
      <div className="rounded-t-xl border border-b-0 border-app-ink/10 bg-app-card shadow-sm">
        {/* Header: count + follow */}
        <div className="flex flex-wrap items-end justify-between gap-3 px-4 pt-4">
          <div>
            <div className="text-[22px] font-black leading-none tabular-nums">
              {p.totalCount}
              <span className="ml-2 text-[12px] font-semibold text-app-ink/50">
                channels followed
                {p.isFilteringActive && ` · ${p.filteredCount} shown`}
              </span>
            </div>
          </div>
          <form
            id="tour-add-channel"
            className="flex items-center gap-1.5"
            onSubmit={(e) => {
              e.preventDefault()
              p.onAddChannel()
            }}
          >
            <span className="text-[12px] font-bold text-app-ink/40">@</span>
            <input
              value={p.inlineChannelName}
              onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
              placeholder="follow a channel"
              className="h-8 w-48 border-b border-app-ink/20 bg-transparent text-[12px] outline-none focus:border-app-ink"
            />
            <TgButton
              type="submit"
              size="sm"
              variant="secondary"
              disabled={!p.inlineChannelName.trim()}
            >
              Follow
            </TgButton>
          </form>
        </div>

        {/* The sentence */}
        <div className="flex flex-wrap items-center gap-y-2 px-4 py-3 text-[13px] text-app-ink/60">
          Showing channels
          <input
            value={p.channelSearch}
            onChange={(e) => p.onChannelSearchChange(e.target.value)}
            placeholder="named anything"
            className={cn(
              inlineSelect,
              "w-40 placeholder:font-semibold placeholder:text-app-ink/35",
            )}
          />
          in
          <select
            value={p.activeGroupFilter}
            onChange={(e) => p.onSetGroupFilter(e.target.value)}
            className={inlineSelect}
          >
            <option value="">any group</option>
            {p.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
          {p.allLanguages.length > 0 && (
            <>
              written in
              <select
                value={p.selectedLanguageFilter}
                onChange={(e) => p.onLanguageFilterChange(e.target.value)}
                className={inlineSelect}
              >
                <option value="">any language</option>
                {p.allLanguages.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </>
          )}
          , by
          <select
            value={p.sortBy}
            onChange={(e) =>
              p.onSortByChange(e.target.value as typeof p.sortBy)
            }
            className={inlineSelect}
          >
            {sortOptionsFor(p.showChannelSubscribers).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label.toLowerCase()}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={p.onToggleSortDirection}
            className={cn(inlineSelect, "gap-1")}
          >
            {p.sortDirection === "asc" ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )}
            {p.sortDirection === "asc" ? "ascending" : "descending"}
          </button>
          <Pop
            align="end"
            trigger={
              <button
                type="button"
                className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-app-ink/10 px-2.5 text-[11px] font-semibold hover:border-app-ink/30"
              >
                <Settings2 size={13} /> Display
              </button>
            }
            className="w-64"
          >
            <PopLabel>Grid</PopLabel>
            <Check
              checked={p.groupBySelection}
              onChange={() => p.onToggleGroupBySelection()}
            >
              Selected first, frozen last
            </Check>
            <Check
              checked={p.showSortRank}
              onChange={p.onShowSortRankChange}
              testId="channel-show-sort-rank"
            >
              Show sort rank
            </Check>
            <div className="flex items-center justify-between px-2 py-1.5 text-[11px] font-semibold">
              Card size
              <ZoomStepper zoom={p.zoom} onZoomChange={p.onZoomChange} />
            </div>
            <PopLabel>AI prompt context</PopLabel>
            <Check
              checked={p.includeChannelBioInPrompt}
              onChange={p.onIncludeChannelBioInPromptChange}
            >
              Include channel bio
            </Check>
            <Check
              checked={p.includeChannelTagsInPrompt}
              onChange={p.onIncludeChannelTagsInPromptChange}
            >
              Include current tags
            </Check>
          </Pop>
        </div>

        {/* Quick select strip: one line, scrolls sideways */}
        <div className="flex items-center gap-2 border-t border-app-ink/10 bg-app-muted/30 px-4 py-2">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-app-ink/45">
            Quick select
          </span>
          <input
            value={p.tagSearch}
            onChange={(e) => p.onTagSearchChange(e.target.value)}
            placeholder="filter tags"
            data-testid="channel-tag-search"
            className="h-7 w-28 shrink-0 rounded-md border border-app-ink/10 bg-app-card px-2 text-[11px] outline-none"
          />
          <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
            {p.groups.map((g) => {
              const s = chipSelection(
                getChannelNamesInGroup(p.channels, g.id),
                p.selectedChannels,
              )
              return (
                <TgSelectionChip
                  key={g.id}
                  state={s.state}
                  onClick={(e) =>
                    e.metaKey || e.ctrlKey
                      ? p.onSetGroupFilter(
                          p.activeGroupFilter === g.id ? "" : g.id,
                        )
                      : p.onToggleGroupSelection(g.id)
                  }
                  className={cn(
                    "shrink-0",
                    p.activeGroupFilter === g.id && "ring-2 ring-indigo-500/40",
                  )}
                >
                  <Layers size={10} />
                  {g.name}
                  <span className="text-[8px] opacity-60">
                    {s.selectedCount}/{s.total}
                  </span>
                </TgSelectionChip>
              )
            })}
            <span className="mx-1 w-px shrink-0 bg-app-ink/15" />
            {p.visibleTags.map((tag) => {
              const s = chipSelection(
                getChannelNamesWithTag(p.channels, tag),
                p.selectedChannels,
              )
              return (
                <TgSelectionChip
                  key={tag}
                  state={s.state}
                  onClick={() => p.onToggleTag(tag)}
                  className="shrink-0"
                >
                  <Tag size={10} />
                  {tag}
                  <span className="text-[8px] opacity-60">
                    {s.selectedCount}/{s.total}
                  </span>
                </TgSelectionChip>
              )
            })}
            {p.pseudoTagChips.map((chip) => {
              const s = chipSelection(chip.channelNames, p.selectedChannels)
              const Icon = chip.icon
              return (
                <TgSelectionChip
                  key={chip.id}
                  state={s.state}
                  title={chip.tooltip}
                  onClick={() => p.onToggleTag(chip.id)}
                  className="shrink-0 border-dashed"
                >
                  <Icon size={10} />
                  {chip.label}
                  <span className="text-[8px] opacity-60">
                    {s.selectedCount}/{s.total}
                  </span>
                </TgSelectionChip>
              )
            })}
          </div>
        </div>
      </div>
      {/* Action rail: always here, disabled at zero. A sibling of the card so it can stick. */}
      <div className="sticky top-0 z-20 -mt-6 flex flex-wrap items-center gap-1 rounded-b-xl border border-app-ink/10 bg-app-card px-4 py-2 shadow-sm">
        <div className="mr-2 flex items-center gap-2">
          <div className="h-1.5 w-24 overflow-hidden rounded-full bg-app-ink/10">
            <div
              className="h-full bg-app-ink transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[11px] font-bold tabular-nums">
            {selectedCount}
            <span className="font-semibold text-app-ink/45">
              /{p.totalCount}
            </span>
          </span>
        </div>
        <button type="button" className={rail} onClick={p.onSelectAll}>
          All
        </button>
        <button
          type="button"
          className={rail}
          onClick={p.onUnselectAll}
          disabled={none}
        >
          None
        </button>
        <button
          type="button"
          className={rail}
          onClick={p.onRevertSelection}
          disabled={p.isRevertDisabled}
        >
          Invert
        </button>
        <Pop
          trigger={
            <button type="button" className={rail} disabled={none}>
              <Scissors size={12} /> Trim
            </button>
          }
          className="w-60"
        >
          <PopLabel>Keep the first N selected, by current sort</PopLabel>
          <form
            className="flex gap-1.5 px-1"
            onSubmit={(e) => {
              e.preventDefault()
              p.onTrimSelection()
            }}
          >
            <input
              type="number"
              min={1}
              value={p.trimCount}
              onChange={(e) => p.onTrimCountChange(e.target.value)}
              data-testid="channel-trim-count"
              aria-label="Trim selection count"
              className="h-8 w-20 rounded-md border border-app-ink/15 bg-app-card px-2 text-[11px]"
            />
            <TgButton
              type="submit"
              size="sm"
              disabled={p.isTrimDisabled}
              data-testid="channel-trim-button"
            >
              Trim
            </TgButton>
          </form>
        </Pop>

        <div className="mx-1 h-5 w-px bg-app-ink/10" />

        <button
          type="button"
          className={rail}
          onClick={p.onScrapeSelected}
          disabled={p.isScrapeSelectedDisabled}
        >
          <RefreshCw size={12} /> Sync
        </button>
        <button
          type="button"
          className={rail}
          onClick={p.onRequestFreeze}
          disabled={none}
        >
          <Snowflake size={12} /> Freeze
        </button>
        <button
          type="button"
          className={rail}
          onClick={p.onRequestUnfreeze}
          disabled={none}
        >
          <Sun size={12} /> Unfreeze
        </button>
        <Pop
          trigger={
            <button type="button" className={rail} disabled={none}>
              <Layers size={12} /> Move
            </button>
          }
          className="w-60"
        >
          <PopLabel>Move {selectedCount} to group</PopLabel>
          {p.groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => p.onBulkTargetGroupIdChange(g.id)}
              className={cn(
                "block w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold hover:bg-app-ink/5",
                p.bulkTargetGroupId === g.id && "bg-app-ink/10",
              )}
            >
              {g.name}
              {g.isDefault ? " (default)" : ""}
            </button>
          ))}
          <TgButton
            size="sm"
            className="mt-2 w-full"
            onClick={p.onApplyMoveToGroup}
          >
            Move
          </TgButton>
        </Pop>
        <Pop
          trigger={
            <button type="button" className={rail} disabled={none}>
              <Plus size={12} />
              <Minus size={12} className="-ml-1" /> Tag
            </button>
          }
          className="w-64"
        >
          <PopLabel>Add a tag to {selectedCount}</PopLabel>
          <InlineField
            value={p.bulkTagInput}
            onChange={p.onBulkTagInputChange}
            onSubmit={p.onBulkAddTag}
            placeholder="Tag to add"
            button="Add"
            testId="bulk-add-tag"
          />
          <PopLabel>Remove a tag from {selectedCount}</PopLabel>
          <InlineField
            value={p.bulkRemoveTagInput}
            onChange={p.onBulkRemoveTagInputChange}
            onSubmit={p.onBulkRemoveTag}
            placeholder="Tag to remove"
            button="Remove"
            testId="bulk-remove-tag"
          />
        </Pop>
        <button
          type="button"
          className={cn(
            rail,
            "text-red-500 hover:bg-red-500/10 hover:text-red-500",
          )}
          onClick={p.onRequestDelete}
          disabled={none}
        >
          <Trash2 size={12} /> Delete
        </button>

        <TgButton
          size="sm"
          className="ml-auto h-8 gap-1.5"
          onClick={p.onScrapeAll}
          disabled={p.isScrapeAllDisabled}
          loading={p.isScraping}
        >
          <RefreshCw size={12} /> Sync all
        </TgButton>
      </div>
    </>
  )
}
