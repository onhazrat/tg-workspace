/**
 * PROTOTYPE A, "Command bar". Every filter is a dropdown on one row; the second
 * row swaps between the active-filter summary and the selection toolbar, so the
 * section is two rows tall whatever you are doing, and sticks to the top.
 */
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Filter,
  Hash,
  Languages,
  Layers,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Snowflake,
  Sun,
  Tag,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { TgInput } from "@/components/ui/tg-input"
import { CARD_ZOOM_LEVELS, type CardZoom } from "@/lib/channels/card-zoom"
import {
  getChannelNamesInGroup,
  getChannelNamesWithTag,
} from "@/lib/channels/channel-grid-chips"
import { cn } from "@/lib/utils"
import { Check, CheckRow, Pop, PopLabel } from "./Pop"
import {
  type ChannelControlsProps,
  chipSelection,
  sortLabel,
  sortOptionsFor,
} from "./types"

const trigger =
  "inline-flex h-9 items-center gap-1.5 rounded-lg border border-app-ink/10 bg-app-muted/50 px-3 text-[11px] font-semibold text-app-ink/80 hover:border-app-ink/25 hover:text-app-ink data-[state=open]:border-app-ink/40"
const activeTrigger = "border-app-ink/50 bg-app-ink/10 text-app-ink"
const barButton =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[11px] font-semibold text-app-ink/80 hover:bg-app-ink/10 hover:text-app-ink disabled:opacity-40"

export const VariantA: React.FC<ChannelControlsProps> = (p) => {
  const selectedCount = p.selectedChannels.size
  const groupName = (id: string) =>
    p.groups.find((g) => g.id === id)?.name ?? id
  const languageName = (code: string) =>
    p.allLanguages.find((l) => l.code === code)?.name ?? code
  const tagName = (id: string) =>
    p.pseudoTagChips.find((c) => c.id === id)?.label ?? id
  const [sortQuery, setSortQuery] = useState("")
  const without = (list: string[], id: string) => list.filter((x) => x !== id)

  return (
    <div className="sticky top-0 z-20 rounded-xl border border-app-ink/10 bg-app-card/95 shadow-sm backdrop-blur">
      {/* Row 1: find, filter, view, follow, sync */}
      <div className="flex flex-wrap items-center gap-2 p-3">
        <div className="relative min-w-[200px] flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute inset-y-0 left-3 my-auto text-app-ink/40"
          />
          <TgInput
            variant="muted"
            value={p.channelSearch}
            onChange={(e) => p.onChannelSearchChange(e.target.value)}
            placeholder="Search channels…"
            className="h-9 py-0 pl-9"
          />
        </div>

        <FacetMenu
          icon={<Layers size={13} />}
          label="Groups"
          filterLabel={groupName}
          noun="group"
          rows={p.groups.map((g) => ({
            id: g.id,
            label: g.name,
            hint: g.isDefault ? "default" : undefined,
            names: getChannelNamesInGroup(p.channels, g.id),
          }))}
          selectedChannels={p.selectedChannels}
          activeFilters={p.groupFilters}
          onToggleSelect={p.onToggleGroupSelection}
          onFiltersChange={p.onGroupFiltersChange}
        />
        <FacetMenu
          icon={<Tag size={13} />}
          label="Tags"
          filterLabel={tagName}
          noun="tag"
          search={{ value: p.tagSearch, onChange: p.onTagSearchChange }}
          rows={[
            ...p.visibleTags.map((tag) => ({
              id: tag,
              label: tag,
              names: getChannelNamesWithTag(p.channels, tag),
            })),
            ...p.pseudoTagChips.map((chip) => ({
              id: chip.id,
              label: chip.label,
              title: chip.tooltip,
              section: "Derived",
              names: chip.channelNames,
            })),
          ]}
          selectedChannels={p.selectedChannels}
          activeFilters={p.tagFilters}
          onToggleSelect={p.onToggleTag}
          onFiltersChange={p.onTagFiltersChange}
        />
        {p.allLanguages.length > 0 && (
          <FacetMenu
            icon={<Languages size={13} />}
            label="Languages"
            filterLabel={languageName}
            noun="language"
            rows={p.allLanguages.map((l) => ({
              id: l.code,
              label: l.name,
              hint: l.code,
              names: p.channels
                .filter((c) => c.language === l.code)
                .map((c) => c.name),
            }))}
            selectedChannels={p.selectedChannels}
            activeFilters={p.languageFilters}
            onToggleSelect={p.onToggleLanguageSelection}
            onFiltersChange={p.onLanguageFiltersChange}
          />
        )}

        <div className="flex">
          <Pop
            trigger={
              <button type="button" className={cn(trigger, "rounded-r-none")}>
                {sortLabel(p.sortBy)}
                <ChevronDown size={12} className="opacity-50" />
              </button>
            }
            className="w-56"
          >
            <TgInput
              autoFocus
              variant="muted"
              value={sortQuery}
              onChange={(e) => setSortQuery(e.target.value)}
              placeholder="Search sort options…"
              className="mb-1 h-8 py-0 text-[11px]"
            />
            <PopLabel>Sort by</PopLabel>
            {sortOptionsFor(p.showChannelSubscribers)
              .filter((o) =>
                o.label.toLowerCase().includes(sortQuery.trim().toLowerCase()),
              )
              .map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => p.onSortByChange(o.value)}
                  className={cn(
                    "block w-full rounded-md px-2 py-1.5 text-left text-[11px] font-semibold hover:bg-app-ink/5",
                    p.sortBy === o.value && "bg-app-ink/10",
                  )}
                >
                  {o.label}
                </button>
              ))}
          </Pop>
          <button
            type="button"
            onClick={p.onToggleSortDirection}
            title={p.sortDirection === "asc" ? "Ascending" : "Descending"}
            className={cn(trigger, "-ml-px rounded-l-none px-2")}
          >
            {p.sortDirection === "asc" ? (
              <ArrowUp size={13} />
            ) : (
              <ArrowDown size={13} />
            )}
          </button>
        </div>

        <Pop
          align="end"
          trigger={
            <button type="button" className={trigger} aria-label="View">
              <Settings2 size={13} />
              View
            </button>
          }
          className="w-64"
        >
          <PopLabel>Layout</PopLabel>
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
            Show sort rank on cards
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

        <div className="mx-1 h-6 w-px bg-app-ink/10" />

        <Pop
          align="end"
          trigger={
            <TgButton variant="secondary" size="sm" className="h-9 gap-1.5">
              <Plus size={13} />
              Follow
            </TgButton>
          }
          className="w-72"
        >
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              p.onAddChannel()
            }}
          >
            <TgInput
              autoFocus
              variant="muted"
              value={p.inlineChannelName}
              onChange={(e) => p.onInlineChannelNameChange(e.target.value)}
              placeholder="@telegram_channel"
              className="h-9 py-0"
            />
            <TgButton
              type="submit"
              size="sm"
              className="h-9"
              disabled={!p.inlineChannelName.trim()}
            >
              Add
            </TgButton>
          </form>
        </Pop>
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

      {/* Row 2: summary when idle, toolbar when something is selected */}
      <div className="flex min-h-11 flex-wrap items-center gap-1 border-t border-app-ink/10 px-3 py-1.5">
        {selectedCount === 0 ? (
          <>
            <span className="mr-2 text-[11px] font-semibold text-app-ink/60">
              {p.isFilteringActive
                ? `${p.filteredCount} of ${p.totalCount} channels`
                : `${p.totalCount} channels`}
            </span>
            {p.groupFilters.map((id) => (
              <FilterPill
                key={`g-${id}`}
                onClear={() =>
                  p.onGroupFiltersChange(without(p.groupFilters, id))
                }
              >
                Group: {groupName(id)}
              </FilterPill>
            ))}
            {p.tagFilters.map((id) => (
              <FilterPill
                key={`t-${id}`}
                onClear={() => p.onTagFiltersChange(without(p.tagFilters, id))}
              >
                Tag: {tagName(id)}
              </FilterPill>
            ))}
            {p.languageFilters.map((code) => (
              <FilterPill
                key={`l-${code}`}
                onClear={() =>
                  p.onLanguageFiltersChange(without(p.languageFilters, code))
                }
              >
                Language: {languageName(code)}
              </FilterPill>
            ))}
            {p.channelSearch && (
              <FilterPill onClear={() => p.onChannelSearchChange("")}>
                “{p.channelSearch}”
              </FilterPill>
            )}
            <div className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className={barButton}
                onClick={p.onSelectAll}
              >
                Select all
              </button>
              <button
                type="button"
                className={barButton}
                onClick={p.onRevertSelection}
                disabled={p.isRevertDisabled}
              >
                Invert
              </button>
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={p.onUnselectAll}
              title="Clear selection"
              className="mr-1 inline-flex h-7 items-center gap-1.5 rounded-md bg-app-ink px-2.5 text-[11px] font-bold text-app-bg"
            >
              {selectedCount} selected <X size={12} />
            </button>
            <button type="button" className={barButton} onClick={p.onSelectAll}>
              All
            </button>
            <button
              type="button"
              className={barButton}
              onClick={p.onRevertSelection}
              disabled={p.isRevertDisabled}
            >
              Invert
            </button>
            <div className="flex items-center gap-1 rounded-md border border-app-ink/10 pl-2">
              <span className="text-[10px] font-semibold text-app-ink/50">
                Keep first
              </span>
              <input
                type="number"
                min={1}
                value={p.trimCount}
                onChange={(e) => p.onTrimCountChange(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && p.onTrimSelection()}
                data-testid="channel-trim-count"
                className="h-7 w-12 bg-transparent text-center text-[11px] outline-none"
                aria-label="Trim selection count"
              />
              <button
                type="button"
                className={cn(barButton, "h-7")}
                onClick={p.onTrimSelection}
                disabled={p.isTrimDisabled}
                data-testid="channel-trim-button"
              >
                Trim
              </button>
            </div>

            <div className="mx-1 h-5 w-px bg-app-ink/10" />

            <button
              type="button"
              className={barButton}
              onClick={p.onScrapeSelected}
              disabled={p.isScrapeSelectedDisabled}
            >
              <RefreshCw size={12} /> Sync
            </button>
            <button
              type="button"
              className={barButton}
              onClick={p.onRequestFreeze}
            >
              <Snowflake size={12} /> Freeze
            </button>
            <button
              type="button"
              className={barButton}
              onClick={p.onRequestUnfreeze}
            >
              <Sun size={12} /> Unfreeze
            </button>
            <Pop
              trigger={
                <button type="button" className={barButton}>
                  <Layers size={12} /> Move to group
                  <ChevronDown size={11} className="opacity-50" />
                </button>
              }
              className="w-60"
            >
              <PopLabel>Move {selectedCount} channels to</PopLabel>
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
                <button type="button" className={barButton}>
                  <Hash size={12} /> Tags
                  <ChevronDown size={11} className="opacity-50" />
                </button>
              }
              className="w-64"
            >
              <PopLabel>Add to {selectedCount} channels</PopLabel>
              <InlineField
                value={p.bulkTagInput}
                onChange={p.onBulkTagInputChange}
                onSubmit={p.onBulkAddTag}
                placeholder="Tag to add"
                button="Add"
                testId="bulk-add-tag"
              />
              <PopLabel>Remove from {selectedCount} channels</PopLabel>
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
                barButton,
                "ml-auto text-red-500 hover:bg-red-500/10 hover:text-red-500",
              )}
              onClick={p.onRequestDelete}
            >
              <Trash2 size={12} /> Delete
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const FilterPill: React.FC<{
  children: React.ReactNode
  onClear: () => void
}> = ({ children, onClear }) => (
  <span className="inline-flex h-6 items-center gap-1 rounded-full border border-app-ink/15 bg-app-ink/5 pl-2.5 pr-1 text-[10px] font-semibold">
    {children}
    <button
      type="button"
      onClick={onClear}
      className="grid h-4 w-4 place-items-center rounded-full hover:bg-app-ink/15"
    >
      <X size={10} />
    </button>
  </span>
)

export const ZoomStepper: React.FC<{
  zoom: CardZoom
  onZoomChange: (zoom: CardZoom) => void
}> = ({ zoom, onZoomChange }) => (
  <div className="flex items-center gap-1">
    <button
      type="button"
      aria-label="Compact cards"
      disabled={zoom <= CARD_ZOOM_LEVELS[0]}
      onClick={() => onZoomChange((zoom - 1) as CardZoom)}
      className="grid h-6 w-6 place-items-center rounded hover:bg-app-ink/10 disabled:opacity-30"
    >
      <ZoomOut size={12} />
    </button>
    <span className="w-4 text-center text-[10px] tabular-nums">{zoom}</span>
    <button
      type="button"
      aria-label="Detailed cards"
      disabled={zoom >= CARD_ZOOM_LEVELS[CARD_ZOOM_LEVELS.length - 1]}
      onClick={() => onZoomChange((zoom + 1) as CardZoom)}
      className="grid h-6 w-6 place-items-center rounded hover:bg-app-ink/10 disabled:opacity-30"
    >
      <ZoomIn size={12} />
    </button>
  </div>
)

export const InlineField: React.FC<{
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  placeholder: string
  button: string
  testId?: string
}> = ({ value, onChange, onSubmit, placeholder, button, testId }) => (
  <form
    className="flex gap-1.5 px-1"
    onSubmit={(e) => {
      e.preventDefault()
      onSubmit()
    }}
  >
    <TgInput
      variant="muted"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      data-testid={testId && `${testId}-input`}
      className="h-8 py-0 text-[11px]"
    />
    <TgButton
      type="submit"
      size="sm"
      variant="secondary"
      disabled={!value.trim()}
      data-testid={testId && `${testId}-button`}
    >
      {button}
    </TgButton>
  </form>
)

type FacetRow = {
  id: string
  label: string
  names: string[]
  hint?: string
  title?: string
  section?: string
}

/**
 * One dropdown per facet (group, tag, language), all alike: search, tick to
 * select every channel in the row, funnel to show only that row.
 */
const FacetMenu: React.FC<{
  icon: React.ReactNode
  label: string
  filterLabel: (id: string) => string
  noun: string
  rows: FacetRow[]
  selectedChannels: Set<string>
  activeFilters: string[]
  onToggleSelect: (id: string) => void
  onFiltersChange: (ids: string[]) => void
  /** Controlled search; the menu keeps its own when absent. */
  search?: { value: string; onChange: (value: string) => void }
}> = (m) => {
  const [localQuery, setLocalQuery] = useState("")
  const query = m.search ? m.search.value : localQuery
  const setQuery = m.search ? m.search.onChange : setLocalQuery
  // A controlled search is already applied upstream (the tag list is filtered).
  const rows = m.search
    ? m.rows
    : m.rows.filter((r) =>
        `${r.label} ${r.hint ?? ""}`
          .toLowerCase()
          .includes(query.trim().toLowerCase()),
      )
  const selectedInFacet = m.rows.filter((r) =>
    r.names.some((n) => m.selectedChannels.has(n)),
  ).length

  return (
    <Pop
      trigger={
        <button
          type="button"
          className={cn(trigger, m.activeFilters.length > 0 && activeTrigger)}
        >
          {m.icon}
          {m.activeFilters.length === 1
            ? m.filterLabel(m.activeFilters[0])
            : m.activeFilters.length > 1
              ? `${m.activeFilters.length} ${m.label.toLowerCase()}`
              : m.label}
          {selectedInFacet > 0 && (
            <span className="rounded-full bg-app-ink/15 px-1.5 text-[9px] tabular-nums">
              {selectedInFacet}
            </span>
          )}
          <ChevronDown size={12} className="opacity-50" />
        </button>
      }
      className="w-80"
    >
      <TgInput
        autoFocus
        variant="muted"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${m.label.toLowerCase()}…`}
        data-testid={m.noun === "tag" ? "channel-tag-search" : undefined}
        className="mb-1 h-8 py-0 text-[11px]"
      />
      <div className="flex items-center justify-between px-2 pb-1 pt-2 text-[9px] font-bold uppercase tracking-widest text-app-ink/45">
        <span>Tick selects · funnels show only</span>
        <span>selected / total</span>
      </div>
      {m.activeFilters.length > 0 && (
        <button
          type="button"
          onClick={() => m.onFiltersChange([])}
          className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-semibold text-app-ink/60 hover:bg-app-ink/5 hover:text-app-ink"
        >
          <X size={10} /> Clear {m.activeFilters.length} funnel
          {m.activeFilters.length > 1 ? "s" : ""}
        </button>
      )}
      {rows.length === 0 && (
        <div className="px-2 py-3 text-[11px] text-app-ink/50">
          No {m.noun} matches “{query}”
        </div>
      )}
      {rows.map((r, i) => {
        const s = chipSelection(r.names, m.selectedChannels)
        const filtering = m.activeFilters.includes(r.id)
        const newSection = r.section && r.section !== rows[i - 1]?.section
        return (
          <div key={r.id}>
            {newSection && <PopLabel>{r.section}</PopLabel>}
            <CheckRow
              state={s.state}
              title={r.title}
              onClick={() => m.onToggleSelect(r.id)}
              trailing={
                <>
                  <span className="text-[10px] tabular-nums text-app-ink/50">
                    <span
                      className={cn(
                        s.selectedCount > 0 && "font-bold text-app-ink",
                      )}
                    >
                      {s.selectedCount}
                    </span>
                    /{s.total}
                  </span>
                  <button
                    type="button"
                    title={
                      filtering ? `Show every ${m.noun}` : "Show only this"
                    }
                    aria-label={
                      filtering
                        ? `Show every ${m.noun}`
                        : `Show only ${r.label}`
                    }
                    aria-pressed={filtering}
                    onClick={() =>
                      m.onFiltersChange(
                        filtering
                          ? m.activeFilters.filter((x) => x !== r.id)
                          : [...m.activeFilters, r.id],
                      )
                    }
                    className={cn(
                      "mr-1 grid h-6 w-6 place-items-center rounded",
                      filtering
                        ? "bg-app-ink text-app-bg"
                        : "text-app-ink/40 opacity-0 hover:bg-app-ink/10 group-hover:opacity-100",
                    )}
                  >
                    <Filter size={11} />
                  </button>
                </>
              }
            >
              {r.label}
              {r.hint && (
                <span className="ml-1.5 text-app-ink/40">{r.hint}</span>
              )}
            </CheckRow>
          </div>
        )
      })}
    </Pop>
  )
}
